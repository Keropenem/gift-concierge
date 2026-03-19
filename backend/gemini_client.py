import asyncio
import json
import logging
import os
import re
from urllib.request import Request, urlopen

from dotenv import load_dotenv
from google import genai
from google.genai import types

from .prompts import SYSTEM_PROMPT

load_dotenv()

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("gift-concierge")

api_key = os.getenv("GEMINI_API_KEY")
logger.info(f"API key loaded: {'Yes' if api_key else 'No'}")

client = genai.Client(api_key=api_key)

MODEL_CANDIDATES = [
    "gemini-3-flash-preview",
    "gemini-2.5-flash",
]

GOOGLE_SEARCH_TOOL = types.Tool(google_search=types.GoogleSearch())

ITEMS_PATTERN = re.compile(
    r"<<<ITEMS>>>\s*(.*?)\s*<<<END_ITEMS>>>",
    re.DOTALL,
)

OG_IMAGE_PATTERN = re.compile(
    r'<meta[^>]+(?:property|name)=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']'
    r'|<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\']og:image["\']',
    re.IGNORECASE,
)

TITLE_PATTERN = re.compile(r"<title[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)

# 価格抽出用パターン
PRICE_META_PATTERN = re.compile(
    r'<meta[^>]+(?:property|name)=["\'](?:product:price:amount|og:price:amount)["\'][^>]+content=["\']([^"\']+)["\']'
    r'|<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\'](?:product:price:amount|og:price:amount)["\']',
    re.IGNORECASE,
)

CURRENCY_META_PATTERN = re.compile(
    r'<meta[^>]+(?:property|name)=["\'](?:product:price:currency|og:price:currency)["\'][^>]+content=["\']([^"\']+)["\']'
    r'|<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\'](?:product:price:currency|og:price:currency)["\']',
    re.IGNORECASE,
)

JSON_LD_PATTERN = re.compile(
    r"<script[^>]+type=[\"']application/ld\+json[\"'][^>]*>(.*?)</script>",
    re.DOTALL | re.IGNORECASE,
)


def parse_response(text: str) -> dict:
    """AIの返答からテキストとITEMS JSONを分離する"""
    match = ITEMS_PATTERN.search(text)

    if match:
        items_json = match.group(1).strip()
        reply = ITEMS_PATTERN.sub("", text).strip()

        try:
            items = json.loads(items_json)
        except json.JSONDecodeError as e:
            logger.warning(f"ITEMS JSON parse error: {e}")
            logger.debug(f"Raw ITEMS: {items_json[:500]}")
            items = []

        return {"reply": reply, "items": items}

    return {"reply": text.strip(), "items": []}


# ── 価格抽出 ──

def _extract_price_from_jsonld(data) -> dict:
    """JSON-LD構造化データからProduct価格を抽出する"""
    if isinstance(data, list):
        for item in data:
            result = _extract_price_from_jsonld(item)
            if result:
                return result
        return {}

    if not isinstance(data, dict):
        return {}

    # @graph 配列を展開
    if data.get("@graph"):
        return _extract_price_from_jsonld(data["@graph"])

    # Product型を探す
    dtype = data.get("@type", "")
    if isinstance(dtype, list):
        dtype = dtype[0] if dtype else ""
    if dtype not in ("Product", "IndividualProduct"):
        return {}

    offers = data.get("offers", {})
    if isinstance(offers, list):
        offers = offers[0] if offers else {}
    # AggregateOffer の場合
    if isinstance(offers, dict) and offers.get("@type") == "AggregateOffer":
        low = offers.get("lowPrice")
        high = offers.get("highPrice")
        currency = offers.get("priceCurrency", "")
        if low is not None:
            try:
                result = {
                    "price": float(str(low).replace(",", "")),
                    "currency": currency,
                }
                if high is not None:
                    result["high_price"] = float(str(high).replace(",", ""))
                return result
            except ValueError:
                pass

    price = offers.get("price") or offers.get("lowPrice")
    currency = offers.get("priceCurrency", "")

    if price is not None:
        try:
            result = {
                "price": float(str(price).replace(",", "")),
                "currency": currency,
            }
            high = offers.get("highPrice")
            if high is not None:
                result["high_price"] = float(str(high).replace(",", ""))
            return result
        except ValueError:
            pass

    return {}


def _extract_price_from_html(html: str) -> dict:
    """HTMLから価格情報を抽出する（JSON-LD → metaタグの優先順）"""
    # 1. JSON-LD structured data
    for match in JSON_LD_PATTERN.finditer(html):
        try:
            data = json.loads(match.group(1))
            price_info = _extract_price_from_jsonld(data)
            if price_info:
                logger.debug(f"Price from JSON-LD: {price_info}")
                return price_info
        except json.JSONDecodeError:
            continue

    # 2. product:price:amount / og:price:amount meta tags
    price_match = PRICE_META_PATTERN.search(html)
    if price_match:
        price_str = price_match.group(1) or price_match.group(2)
        try:
            price = float(price_str.replace(",", ""))
            currency = ""
            currency_match = CURRENCY_META_PATTERN.search(html)
            if currency_match:
                currency = currency_match.group(1) or currency_match.group(2)
            logger.debug(f"Price from meta: {price} {currency}")
            return {"price": price, "currency": currency}
        except ValueError:
            pass

    return {}


# ── URL検証（サーバー側で実行） ──

def _verify_url_sync(url: str) -> dict:
    """URLにアクセスして検証結果を返す（同期）。価格・OG画像も抽出する。"""
    try:
        req = Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        })
        with urlopen(req, timeout=8) as resp:
            status = resp.status
            final_url = resp.url
            html = resp.read(100000).decode("utf-8", errors="ignore")

        title_match = TITLE_PATTERN.search(html)
        title = title_match.group(1).strip() if title_match else ""

        og_match = OG_IMAGE_PATTERN.search(html)
        og_image = (og_match.group(1) or og_match.group(2)) if og_match else ""

        # 価格抽出
        price_info = _extract_price_from_html(html)

        return {
            "accessible": True,
            "status_code": status,
            "final_url": final_url,
            "page_title": title[:200],
            "og_image_url": og_image,
            "is_product_page": bool(title and status == 200),
            "price": price_info.get("price"),
            "high_price": price_info.get("high_price"),
            "currency": price_info.get("currency", ""),
        }
    except Exception as e:
        return {
            "accessible": False,
            "error": str(e)[:200],
            "is_product_page": False,
        }


async def verify_product_url(url: str) -> dict:
    """URLにアクセスして検証結果を返す（非同期）"""
    return await asyncio.to_thread(_verify_url_sync, url)


async def _verify_items(items: list[dict]) -> tuple[list[dict], list[tuple[dict, dict]]]:
    """
    全商品URLを並行検証し、有効/無効に分類。
    有効分にはOG画像と実際の価格をセットする。
    """
    verified = []
    invalid = []

    tasks = []
    for item in items:
        url = item.get("product_url", "")
        if url and url.startswith("http"):
            tasks.append(verify_product_url(url))
        else:
            async def _no_url():
                return {"accessible": False, "error": "URLが指定されていません"}
            tasks.append(_no_url())

    results = await asyncio.gather(*tasks, return_exceptions=True)

    for item, result in zip(items, results):
        if isinstance(result, Exception):
            invalid.append((item, {"accessible": False, "error": str(result)[:200]}))
        elif result.get("accessible") and result.get("is_product_page"):
            # OG画像
            og = result.get("og_image_url")
            if og:
                item["image_url"] = og

            # 実際の価格で上書き
            actual_price = result.get("price")
            if actual_price:
                item["actual_price"] = actual_price
                item["actual_high_price"] = result.get("high_price")
                item["actual_currency"] = result.get("currency", "")
                # price_min/price_max を実価格で上書き
                item["price_min"] = int(actual_price)
                item["price_max"] = int(result.get("high_price") or actual_price)
                logger.info(
                    f"Price update for {item.get('name', '?')}: "
                    f"{actual_price} {result.get('currency', '')} "
                    f"(model said {item.get('price_min')}〜{item.get('price_max')})"
                )

            verified.append(item)
        else:
            invalid.append((item, result))

    return verified, invalid


def _build_verification_feedback(
    invalid_items: list[tuple[dict, dict]],
    verified_items: list[dict],
) -> str:
    """無効URL + 価格ズレ情報をモデルへのフィードバックメッセージに変換する"""
    lines = []

    if invalid_items:
        lines.append(
            "【システム検証結果】以下の商品URLにアクセスできなかったか、商品ページではありませんでした。"
        )
        lines.append("")
        for item, result in invalid_items:
            name = item.get("name", "不明")
            url = item.get("product_url", "なし")
            error = result.get("error", result.get("page_title", "ページが見つかりません"))
            lines.append(f"- {name}: {url} → {error}")

    if verified_items:
        lines.append("")
        lines.append(f"以下の{len(verified_items)}件は有効でした（そのまま保持してください）:")
        for item in verified_items:
            name = item.get("name", "")
            actual = item.get("actual_price")
            currency = item.get("actual_currency", "")
            if actual:
                lines.append(f"- {name}（実際の価格: {actual} {currency}）")
            else:
                lines.append(f"- {name}")

    if invalid_items:
        lines.append("")
        lines.append(
            "無効だった商品の代わりに、実在する別の商品を検索し直して提案してください。"
            "URLは実際にアクセスできるものだけ使ってください。"
            "価格は商品ページに記載されている実際の価格を使ってください。"
        )

    return "\n".join(lines)


def _build_contents(history: list[dict], user_message: str) -> list[types.Content]:
    """会話履歴を新SDK形式に変換する"""
    contents = []
    for msg in history:
        contents.append(types.Content(
            role=msg["role"],
            parts=[types.Part(text=msg["parts"][0])],
        ))
    contents.append(types.Content(
        role="user",
        parts=[types.Part(text=user_message)],
    ))
    return contents


async def chat(history: list[dict], user_message: str) -> dict:
    """
    会話 → 提案があればURLをサーバー側で検証（価格含む） → 無効なら再提案を依頼するループ。
    Google Search grounding で商品検索し、後検証で存在・価格を確認する。
    """
    contents = _build_contents(history, user_message)

    last_error = None
    for model_name in MODEL_CANDIDATES:
        try:
            logger.info(f"Trying model: {model_name}")

            config = types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT,
                temperature=0.8,
                tools=[GOOGLE_SEARCH_TOOL],
            )

            loop_contents = list(contents)
            MAX_VERIFY_ROUNDS = 3
            reply_text = ""

            for verify_round in range(MAX_VERIFY_ROUNDS):
                response = await client.aio.models.generate_content(
                    model=model_name,
                    contents=loop_contents,
                    config=config,
                )

                try:
                    reply_text = response.text
                except (AttributeError, ValueError):
                    reply_text = "申し訳ありません。問題が発生しました。もう一度お試しください。"
                    break

                logger.info(f"[Round {verify_round + 1}] Response (first 200): {reply_text[:200]}")

                result = parse_response(reply_text)

                # ヒアリング中（商品提案なし）
                if not result["items"]:
                    # 長文なのにITEMS JSONが無い → 提案を出したのにJSON形式を忘れている
                    if len(reply_text) > 500 and verify_round < MAX_VERIFY_ROUNDS - 1:
                        logger.warning(
                            f"Long response ({len(reply_text)} chars) without <<<ITEMS>>> JSON. "
                            "Requesting re-output with proper format."
                        )
                        loop_contents.append(
                            types.Content(role="model", parts=[types.Part(text=reply_text)])
                        )
                        loop_contents.append(
                            types.Content(role="user", parts=[types.Part(text=(
                                "【システム】商品を提案する場合は、テキストの最後に必ず "
                                "<<<ITEMS>>> と <<<END_ITEMS>>> で囲んだJSON配列を含めてください。"
                                "JSONが無いと商品カードが表示されません。"
                                "同じ提案内容で構いませんので、正しい形式で再出力してください。"
                            ))])
                        )
                        continue
                    logger.info("No items in response (hearing phase)")
                    return {**result, "raw_reply": reply_text}

                # ── 商品URLをサーバー側で検証（価格も抽出） ──
                logger.info(f"Verifying {len(result['items'])} item URLs...")
                verified, invalid = await _verify_items(result["items"])

                logger.info(
                    f"Verification: {len(verified)} valid, {len(invalid)} invalid"
                )

                if not invalid:
                    # 全URL有効 → 返す（価格は実価格で上書き済み）
                    result["items"] = verified
                    return {**result, "raw_reply": reply_text}

                if verify_round < MAX_VERIFY_ROUNDS - 1:
                    # 無効URLあり → モデルにフィードバックして再提案
                    feedback = _build_verification_feedback(invalid, verified)
                    logger.info(f"Sending verification feedback to model:\n{feedback}")

                    loop_contents.append(
                        types.Content(role="model", parts=[types.Part(text=reply_text)])
                    )
                    loop_contents.append(
                        types.Content(role="user", parts=[types.Part(text=feedback)])
                    )
                else:
                    # 最終ラウンド → 有効な商品のみ返す
                    logger.warning(
                        f"Max verification rounds reached. "
                        f"Returning {len(verified)} valid items, "
                        f"dropping {len(invalid)} invalid."
                    )
                    result["items"] = verified
                    return {**result, "raw_reply": reply_text}

            # ループ正常終了（items無しで抜けた場合）
            result = parse_response(reply_text)
            return {**result, "raw_reply": reply_text}

        except Exception as e:
            last_error = e
            logger.warning(f"Model {model_name} failed: {type(e).__name__}: {e}")
            continue

    logger.error(f"All models failed. Last error: {last_error}")
    raise last_error
