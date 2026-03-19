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


# ── URL検証（サーバー側で実行） ──

def _verify_url_sync(url: str) -> dict:
    """URLにアクセスして検証結果を返す（同期）"""
    try:
        req = Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        })
        with urlopen(req, timeout=8) as resp:
            status = resp.status
            final_url = resp.url
            html = resp.read(50000).decode("utf-8", errors="ignore")

        title_match = TITLE_PATTERN.search(html)
        title = title_match.group(1).strip() if title_match else ""

        og_match = OG_IMAGE_PATTERN.search(html)
        og_image = (og_match.group(1) or og_match.group(2)) if og_match else ""

        return {
            "accessible": True,
            "status_code": status,
            "final_url": final_url,
            "page_title": title[:200],
            "og_image_url": og_image,
            "is_product_page": bool(title and status == 200),
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
    """全商品URLを並行検証し、有効/無効に分類。有効分にはOG画像もセットする。"""
    verified = []
    invalid = []

    tasks = []
    for item in items:
        url = item.get("product_url", "")
        if url and url.startswith("http"):
            tasks.append(verify_product_url(url))
        else:
            # URL無し → 非同期で即座に無効結果を返す
            async def _no_url():
                return {"accessible": False, "error": "URLが指定されていません"}
            tasks.append(_no_url())

    results = await asyncio.gather(*tasks, return_exceptions=True)

    for item, result in zip(items, results):
        if isinstance(result, Exception):
            invalid.append((item, {"accessible": False, "error": str(result)[:200]}))
        elif result.get("accessible") and result.get("is_product_page"):
            # 検証OK → OG画像があればセット
            og = result.get("og_image_url")
            if og:
                item["image_url"] = og
            verified.append(item)
        else:
            invalid.append((item, result))

    return verified, invalid


def _build_verification_feedback(
    invalid_items: list[tuple[dict, dict]],
    verified_items: list[dict],
) -> str:
    """無効URL情報をモデルへのフィードバックメッセージに変換する"""
    lines = [
        "【システム検証結果】以下の商品URLにアクセスできなかったか、商品ページではありませんでした。",
        "",
    ]
    for item, result in invalid_items:
        name = item.get("name", "不明")
        url = item.get("product_url", "なし")
        error = result.get("error", result.get("page_title", "ページが見つかりません"))
        lines.append(f"- {name}: {url} → {error}")

    if verified_items:
        lines.append("")
        lines.append(f"以下の{len(verified_items)}件は有効でした（そのまま保持してください）:")
        for item in verified_items:
            lines.append(f"- {item.get('name', '')}")

    lines.append("")
    lines.append(
        "無効だった商品の代わりに、実在する別の商品を検索し直して提案してください。"
        "URLは実際にアクセスできるものだけ使ってください。"
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
    会話 → 提案があればURLをサーバー側で検証 → 無効なら再提案を依頼するループ。
    Google Search grounding で商品検索し、後検証で存在確認する。
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

                # ヒアリング中（商品提案なし）→ そのまま返す
                if not result["items"]:
                    logger.info("No items in response (hearing phase)")
                    return {**result, "raw_reply": reply_text}

                # ── 商品URLをサーバー側で検証 ──
                logger.info(f"Verifying {len(result['items'])} item URLs...")
                verified, invalid = await _verify_items(result["items"])

                logger.info(
                    f"Verification: {len(verified)} valid, {len(invalid)} invalid"
                )

                if not invalid:
                    # 全URL有効 → 返す
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
