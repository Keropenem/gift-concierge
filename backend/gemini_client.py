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

# テキスト中のURL抽出用
URL_IN_TEXT_PATTERN = re.compile(r'https?://[^\s<>"\')\]]+')

# 文末の【公式販売サイト】セクションを除去（カードに表示するので本文からは不要）
TRAILING_URL_PATTERN = re.compile(
    r"\n*【公式(?:販売)?サイト】\s*\n?https?://[^\s]+\s*$",
    re.MULTILINE,
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


def _try_parse_json_array(text: str) -> list[dict]:
    """テキストからJSON配列を抽出する（<<<ITEMS>>>デリミタなしのフォールバック）"""
    # ```json ... ``` ブロックを探す
    code_block = re.search(r"```(?:json)?\s*(\[.*?\])\s*```", text, re.DOTALL)
    if code_block:
        try:
            items = json.loads(code_block.group(1))
            if isinstance(items, list) and items:
                return items
        except json.JSONDecodeError:
            pass

    # 素の JSON 配列 [ ... ] を探す
    bracket = re.search(r"\[\s*\{.*?\}\s*\]", text, re.DOTALL)
    if bracket:
        try:
            items = json.loads(bracket.group(0))
            if isinstance(items, list) and items:
                return items
        except json.JSONDecodeError:
            pass

    return []


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


def _clean_reply_text(text: str) -> str:
    """表示用テキストから【公式販売サイト】URLセクションや生URLを除去する"""
    cleaned = TRAILING_URL_PATTERN.sub("", text)
    # 単独行のURLも除去（カードに表示するので本文には不要）
    cleaned = re.sub(r"^\s*https?://[^\s]+\s*$", "", cleaned, flags=re.MULTILINE)
    return cleaned.strip()


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

        # リダイレクトでトップページに飛ばされたかチェック
        from urllib.parse import urlparse
        orig_path = urlparse(url).path.rstrip("/")
        final_path = urlparse(final_url).path.rstrip("/")
        redirected_to_home = (
            orig_path and len(orig_path) > 3
            and (not final_path or len(final_path) <= 3)
        )

        is_product = bool(
            status == 200
            and not redirected_to_home
            and not _is_homepage_url(final_url)
        )

        if redirected_to_home:
            logger.info(f"URL redirected to homepage: {url} → {final_url}")

        return {
            "accessible": True,
            "status_code": status,
            "final_url": final_url,
            "page_title": title[:200],
            "og_image_url": og_image,
            "is_product_page": is_product,
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


async def _verify_and_enrich(items: list[dict]) -> list[dict]:
    """
    全商品URLを並行検証し、OG画像と実価格をセットする。
    検証失敗でもアイテムは消さない（product_urlを空にするだけ）。
    search_keyword が残るので「検索する」ボタンは常に表示される。
    """
    tasks = []
    has_url = []
    for i, item in enumerate(items):
        url = item.get("product_url", "")
        if url and url.startswith("http"):
            tasks.append(verify_product_url(url))
            has_url.append(i)

    if not tasks:
        return items

    results = await asyncio.gather(*tasks, return_exceptions=True)

    for idx, result in zip(has_url, results):
        item = items[idx]
        if isinstance(result, Exception):
            logger.warning(f"URL verification error for {item.get('name', '?')}: {result}")
            item["product_url"] = ""
            continue

        if result.get("accessible") and result.get("is_product_page"):
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
                item["price_min"] = int(actual_price)
                item["price_max"] = int(result.get("high_price") or actual_price)
                logger.info(
                    f"Price update for {item.get('name', '?')}: "
                    f"{actual_price} {result.get('currency', '')}"
                )
        else:
            # 検証NG → URLだけ消す（アイテム自体は残す）
            logger.info(
                f"Invalid URL for {item.get('name', '?')}: "
                f"{item.get('product_url', '')} → clearing URL"
            )
            item["product_url"] = ""

    return items


def _inject_urls_from_text(items: list[dict], raw_text: str) -> list[dict]:
    """
    モデルのテキストからURLを正規表現で抽出し、URLが空のアイテムに注入する。
    Google Search grounding 有効時、モデルはテキスト中に実URLを含むことがある。
    抽出モデル(Phase 2)がこれを拾い損ねた場合のフォールバック。
    """
    urls = URL_IN_TEXT_PATTERN.findall(raw_text)
    if not urls:
        return items

    # Google検索リダイレクトやGemini内部URLは除外
    product_urls = [
        u for u in urls
        if not u.startswith("https://vertexaisearch.cloud.google.com")
        and not u.startswith("https://www.google.com")
        and "googleapis.com" not in u
    ]

    if not product_urls:
        return items

    logger.info(f"Found {len(product_urls)} URLs in raw text: {product_urls}")

    # URLが空のアイテムに順番に割り当て
    url_idx = 0
    for item in items:
        if not item.get("product_url") and url_idx < len(product_urls):
            item["product_url"] = product_urls[url_idx]
            logger.info(f"Injected URL for {item.get('name', '?')}: {product_urls[url_idx]}")
            url_idx += 1

    return items


URL_FINDER_PROMPT = """以下の各商品について、商品の詳細ページ（購入ページ）のURLを見つけてください。

ルール:
- ブランドのトップページやホームページではなく、その商品そのもののページを見つけること
- 優先順位: 公式オンラインショップの商品ページ > 楽天/Amazon等の個別商品ページ > レビュー記事
- ブランドのトップページ（例: https://brand.com/ ）は絶対に出すな
- 各商品につき1行、URLだけを出力。余計な説明は不要。
- 見つからなければ「NOT_FOUND」と出力

商品リスト:
"""


def _is_homepage_url(url: str) -> bool:
    """URLがトップページ/ホームページかどうかを判定する"""
    if not url:
        return True
    from urllib.parse import urlparse
    parsed = urlparse(url)
    path = parsed.path.rstrip("/")
    # パスが空、または /en, /ja のような短い言語コードのみ
    if not path or len(path) <= 3:
        return True
    return False


async def _find_product_urls(items: list[dict], model_name: str) -> list[dict]:
    """
    各商品の名前・ブランドを使って、Google Searchで商品詳細ページのURLを探す。
    ホームページURLしかない、またはURLが空のアイテムが対象。
    """
    targets = []
    target_indices = []
    for i, item in enumerate(items):
        url = item.get("product_url", "")
        if not url or _is_homepage_url(url):
            name = item.get("name", "")
            keyword = item.get("search_keyword", name)
            if keyword:
                targets.append(keyword)
                target_indices.append(i)

    if not targets:
        return items

    query = URL_FINDER_PROMPT
    for j, keyword in enumerate(targets, 1):
        query += f"{j}. {keyword}\n"

    logger.info(f"Finding product URLs for {len(targets)} items...")

    try:
        response = await client.aio.models.generate_content(
            model=model_name,
            contents=[
                types.Content(
                    role="user",
                    parts=[types.Part(text=query)],
                )
            ],
            config=types.GenerateContentConfig(
                temperature=0.1,
                tools=[GOOGLE_SEARCH_TOOL],
            ),
        )
        result_text = response.text
        logger.info(f"URL finder response: {result_text[:500]}")

        # レスポンスからURLを行ごとに抽出
        lines = [line.strip() for line in result_text.strip().split("\n") if line.strip()]
        found_urls = []
        for line in lines:
            urls_in_line = URL_IN_TEXT_PATTERN.findall(line)
            if urls_in_line:
                found_urls.append(urls_in_line[0])
            elif "NOT_FOUND" in line:
                found_urls.append("")

        # 見つかったURLをアイテムに割り当て
        for j, idx in enumerate(target_indices):
            if j < len(found_urls) and found_urls[j]:
                old_url = items[idx].get("product_url", "")
                new_url = found_urls[j]
                if not _is_homepage_url(new_url):
                    items[idx]["product_url"] = new_url
                    logger.info(
                        f"URL finder: {items[idx].get('name', '?')}: "
                        f"{old_url or '(none)'} → {new_url}"
                    )

    except Exception as e:
        logger.warning(f"URL finder failed: {e}")

    return items


EXTRACTION_PROMPT = """以下のギフト提案テキストから商品情報を抽出し、JSON配列として出力してください。

出力ルール:
- <<<ITEMS>>> と <<<END_ITEMS>>> で囲む
- 各商品について以下のフィールドを必ず含める
- product_url はテキスト中に明示的なURL（https://...）がある場合、そのURLをそのまま使え。「【公式販売サイト】 https://...」形式で書かれたURLも含む。URLが見つからなければ空文字 "" にしろ。推測するな。
- search_keyword はブランド名+商品名の日本語検索キーワード（必須）

<<<ITEMS>>>
[
  {
    "id": 1,
    "name": "正確な商品名",
    "category": "カテゴリ",
    "type": "タイプ",
    "price_min": 数値,
    "price_max": 数値,
    "reasoning": "テキストから要約した理由1〜2文",
    "tip": "ワンポイント1文",
    "product_url": "",
    "search_keyword": "ブランド名 商品名"
  }
]
<<<END_ITEMS>>>

テキストのみ出力。余計な説明は不要。

提案テキスト:
"""


async def _extract_items_from_text(text: str, model_name: str) -> list[dict]:
    """
    Google Search なしの別リクエストで、提案テキストから <<<ITEMS>>> JSON を抽出する。
    <<<ITEMS>>>デリミタが無い場合もJSON配列を直接パースするフォールバックあり。
    """
    try:
        response = await client.aio.models.generate_content(
            model=model_name,
            contents=[
                types.Content(
                    role="user",
                    parts=[types.Part(text=EXTRACTION_PROMPT + text)],
                )
            ],
            config=types.GenerateContentConfig(temperature=0.1),
        )
        extraction_text = response.text
        logger.info(f"Extraction response (first 300): {extraction_text[:300]}")

        # まず <<<ITEMS>>> デリミタで試す
        result = parse_response(extraction_text)
        if result["items"]:
            logger.info(f"Extracted {len(result['items'])} items via delimiter")
            return result["items"]

        # フォールバック: デリミタなしの JSON 配列を直接パース
        items = _try_parse_json_array(extraction_text)
        if items:
            logger.info(f"Extracted {len(items)} items via JSON fallback")
            return items

        logger.warning("Extraction returned no parseable items")
        return []
    except Exception as e:
        logger.error(f"Item extraction failed: {e}")
        return []


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
    検証・自己補正機能を含むフロー:
    1. 生成
    2. URL検証（_verify_and_enrich）
    3. URLが無効な場合は、エラーメッセージを加えて再生成ループ（最大3回）
    """
    base_contents = _build_contents(history, user_message)

    last_error = None
    MAX_VALIDATION_RETRIES = 3

    for model_name in MODEL_CANDIDATES:
        try:
            logger.info(f"Trying model: {model_name}")

            config = types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT,
                temperature=0.7,
                tools=[GOOGLE_SEARCH_TOOL],
            )

            contents = list(base_contents)  # コピーして使う

            for attempt in range(MAX_VALIDATION_RETRIES):
                logger.info(f"--- Attempt {attempt + 1}/{MAX_VALIDATION_RETRIES} for {model_name} ---")

                response = await client.aio.models.generate_content(
                    model=model_name,
                    contents=contents,
                    config=config,
                )

                try:
                    reply_text = response.text
                except (AttributeError, ValueError):
                    reply_text = "申し訳ありません。問題が発生しました。もう一度お試しください。"
                    return {"reply": reply_text, "items": [], "raw_reply": reply_text}

                logger.info(f"Response (first 200): {reply_text[:200]}")

                result = parse_response(reply_text)

                # Phase 2: <<<ITEMS>>> がなく長文 → 抽出リクエスト（Search OFF）
                if not result["items"] and len(reply_text) > 200:
                    logger.info(
                        f"Long response ({len(reply_text)} chars) without <<<ITEMS>>>. "
                        "Extracting items via separate request."
                    )
                    result["items"] = await _extract_items_from_text(reply_text, model_name)

                # ヒアリング中（items なし）→ テキストのみ返す
                if not result["items"]:
                    logger.info("No items (hearing phase)")
                    return {**result, "reply": _clean_reply_text(result["reply"]), "raw_reply": reply_text}

                # テキスト中のURLをアイテムに注入（抽出モデルが見逃した場合）
                result["items"] = _inject_urls_from_text(result["items"], reply_text)

                # Phase 3: 商品ページURL探索（ホームページURLや空URLの補完）
                result["items"] = await _find_product_urls(result["items"], model_name)

                # Phase 4: URL検証 + OG画像/価格抽出
                # ※ _verify_and_enrich はin-place修正するので、先にオリジナルURLを保存
                orig_urls = [item.get("product_url", "") for item in result["items"]]

                logger.info(f"Verifying {len(result['items'])} items...")
                enriched_items = await _verify_and_enrich(result["items"])

                # 確認: 元々URLがなかったのか、それとも検証で弾かれた（空にされた）のか
                invalid_count = 0
                error_msg = ""
                for orig_url, enriched in zip(orig_urls, enriched_items):
                    final_url = enriched.get("product_url", "")
                    
                    if not final_url:
                        invalid_count += 1
                        if not orig_url:
                            error_msg = "システムエラー: 商品のURLが出力されていません。必ずGoogle検索で実際の公式販売ページ等を見つけ、そのURLを文章の最後に「【公式販売サイト】 https://...」のように記載してください。推測は厳禁です。\n"
                        else:
                            error_msg = f"システムエラー: 前回提案したURL ({orig_url}) はリンク切れかアクセス不可（404等）でした。別の実在する商品を探すか、正しいURLを見つけて、最初から提案し直してください。\n"
                        
                        error_msg += "【重要】ユーザーにはこのエラーを見せません。新しい文章の冒頭で絶対に謝罪したり、システムエラーについて言及したりしないでください。エラーなど無かったかのように、いきなり自然な商品提案の文章（導入部分）から書き始めてください。"

                if invalid_count == 0:
                    # 全て検証成功
                    result["items"] = enriched_items
                    return {**result, "reply": _clean_reply_text(result["reply"]), "raw_reply": reply_text}

                if attempt < MAX_VALIDATION_RETRIES - 1:
                    logger.warning(f"Found {invalid_count} invalid URLs. Retrying: {error_msg}")
                    # ユーザーには見せず、システムからAIへ修正要求
                    contents.append(types.Content(
                        role="model",
                        parts=[types.Part(text=reply_text)]
                    ))
                    contents.append(types.Content(
                        role="user",
                        parts=[types.Part(text=error_msg)]
                    ))
                else:
                    logger.warning("Max validation retries reached. Returning gracefully.")
                    result["items"] = enriched_items
                    return {**result, "reply": _clean_reply_text(result["reply"]), "raw_reply": reply_text}

        except Exception as e:
            last_error = e
            logger.warning(f"Model {model_name} failed: {type(e).__name__}: {e}")
            continue

    logger.error(f"All models failed. Last error: {last_error}")
    raise last_error
