import asyncio
import json
import logging
import os
import re
import time as _time
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

# ── デバッグモード ──
DEBUG_MODE = os.getenv("GC_DEBUG", "0") == "1"

# SSE用: セッションごとのアクティブなデバッグキュー
# {session_id: asyncio.Queue}
_debug_queues: dict[str, asyncio.Queue] = {}


def set_debug_mode(enabled: bool):
    global DEBUG_MODE
    DEBUG_MODE = enabled


def subscribe_debug(session_id: str) -> asyncio.Queue:
    """セッションのデバッグイベントを購読する"""
    q = asyncio.Queue()
    _debug_queues[session_id] = q
    return q


def unsubscribe_debug(session_id: str):
    """デバッグ購読を解除する"""
    _debug_queues.pop(session_id, None)


class DebugTrace:
    """パイプラインの各ステップを記録するデバッグトレーサー"""

    def __init__(self, session_id: str = ""):
        self.steps: list[dict] = []
        self._start_time = _time.time()
        self._last_step_time = self._start_time
        self._session_id = session_id

    def step(self, name: str, **data):
        """ステップを記録"""
        now = _time.time()
        elapsed = round(now - self._start_time, 2)
        duration = round(now - self._last_step_time, 2)
        self._last_step_time = now
        entry = {"step": name, "elapsed_sec": elapsed, "duration_sec": duration, **data}
        self.steps.append(entry)
        if DEBUG_MODE:
            logger.info(f"[DEBUG TRACE] {name}: {json.dumps(data, ensure_ascii=False, default=str)[:500]}")
            # SSEキューにプッシュ
            q = _debug_queues.get(self._session_id)
            if q:
                try:
                    q.put_nowait(entry)
                except asyncio.QueueFull:
                    pass

    def to_dict(self) -> list[dict]:
        return self.steps

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
            and not _is_category_url(final_url)
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


async def _verify_and_enrich(items: list[dict], trace: DebugTrace = None) -> list[dict]:
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

    if trace:
        trace.step("verify_start",
                    items_with_url=len(has_url),
                    urls_to_verify=[{"idx": i, "name": items[i].get("name", "?"), "url": items[i].get("product_url", "")} for i in has_url])

    if not tasks:
        if trace:
            trace.step("verify_skip", reason="No items have URLs to verify")
        return items

    results = await asyncio.gather(*tasks, return_exceptions=True)

    verify_details = []
    for idx, result in zip(has_url, results):
        item = items[idx]
        detail = {"name": item.get("name", "?"), "original_url": item.get("product_url", "")}

        if isinstance(result, Exception):
            logger.warning(f"URL verification error for {item.get('name', '?')}: {result}")
            item["product_url"] = ""
            detail["result"] = "exception"
            detail["error"] = str(result)[:200]
            verify_details.append(detail)
            continue

        detail["accessible"] = result.get("accessible")
        detail["status_code"] = result.get("status_code")
        detail["final_url"] = result.get("final_url", "")
        detail["is_product_page"] = result.get("is_product_page")

        if result.get("accessible"):
            # OG画像
            og = result.get("og_image_url")
            if og:
                item["image_url"] = og

            if result.get("is_product_page"):
                # 商品ページ確認OK
                item["url_type"] = "product"
                detail["result"] = "product_page"
                actual_price = result.get("price")
                if actual_price:
                    item["actual_price"] = actual_price
                    item["actual_high_price"] = result.get("high_price")
                    item["actual_currency"] = result.get("currency", "")
                    item["price_min"] = int(actual_price)
                    item["price_max"] = int(result.get("high_price") or actual_price)
                    detail["price"] = actual_price
                    logger.info(
                        f"Price update for {item.get('name', '?')}: "
                        f"{actual_price} {result.get('currency', '')}"
                    )
            else:
                # アクセスできるがホームページ等 → 公式サイトとして残す
                item["url_type"] = "official"
                detail["result"] = "official_site"
                logger.info(
                    f"Homepage URL for {item.get('name', '?')}: "
                    f"{item.get('product_url', '')} → keeping as official site"
                )
        else:
            # アクセス不可 → URLを消す
            detail["result"] = "inaccessible"
            detail["error"] = result.get("error", "")
            logger.info(
                f"Inaccessible URL for {item.get('name', '?')}: "
                f"{item.get('product_url', '')} → clearing URL"
            )
            item["product_url"] = ""

        verify_details.append(detail)

    if trace:
        trace.step("verify_result",
                    details=verify_details,
                    items_after=[{
                        "name": it.get("name", "?"),
                        "url": it.get("product_url", ""),
                        "url_type": it.get("url_type", ""),
                    } for it in items])

    return items


def _inject_urls_from_text(items: list[dict], raw_text: str, trace: DebugTrace = None) -> list[dict]:
    """
    モデルのテキストからURLを正規表現で抽出し、URLが空のアイテムに注入する。
    Google Search grounding 有効時、モデルはテキスト中に実URLを含むことがある。
    抽出モデル(Phase 2)がこれを拾い損ねた場合のフォールバック。
    """
    urls = URL_IN_TEXT_PATTERN.findall(raw_text)

    # Google検索リダイレクトやGemini内部URLは除外
    product_urls = [
        u for u in urls
        if not u.startswith("https://vertexaisearch.cloud.google.com")
        and not u.startswith("https://www.google.com")
        and "googleapis.com" not in u
    ]

    if trace:
        trace.step("url_injection", raw_urls_found=len(urls), filtered_urls=product_urls)

    if not product_urls:
        return items

    logger.info(f"Found {len(product_urls)} URLs in raw text: {product_urls}")

    # URLが空のアイテムに順番に割り当て
    url_idx = 0
    injected = []
    for item in items:
        if not item.get("product_url") and url_idx < len(product_urls):
            item["product_url"] = product_urls[url_idx]
            injected.append({"name": item.get("name", "?"), "url": product_urls[url_idx]})
            logger.info(f"Injected URL for {item.get('name', '?')}: {product_urls[url_idx]}")
            url_idx += 1

    if trace and injected:
        trace.step("url_injection_result", injected=injected)

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


# カテゴリ/一覧ページのパスパターン
_CATEGORY_PATH_PATTERNS = re.compile(
    r"/(collections|categories|category|catalog|shop|products|search|browse|tag|tags)"
    r"(/[^/]+)?/?$",
    re.IGNORECASE,
)


def _is_category_url(url: str) -> bool:
    """URLがカテゴリ/コレクション一覧ページかどうかを判定する"""
    if not url:
        return False
    from urllib.parse import urlparse
    parsed = urlparse(url)
    path = parsed.path.rstrip("/")
    # /collections/perfumes, /category/gifts 等はカテゴリページ
    if _CATEGORY_PATH_PATTERNS.search(path):
        # ただし /products/specific-item のような個別商品は除外
        # 3セグメント以上（/collections/type/item-slug）はOK
        segments = [s for s in path.split("/") if s]
        if len(segments) <= 2:
            return True
    return False


async def _find_product_urls(items: list[dict], model_name: str, trace: DebugTrace = None) -> list[dict]:
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

    if trace:
        trace.step("url_finder_start",
                    target_count=len(targets),
                    targets=[{"idx": idx, "keyword": kw} for idx, kw in zip(target_indices, targets)],
                    items_before=[{"name": it.get("name", "?"), "url": it.get("product_url", "")} for it in items])

    if not targets:
        if trace:
            trace.step("url_finder_skip", reason="No targets (all items have product URLs)")
        return items

    query = URL_FINDER_PROMPT
    for j, keyword in enumerate(targets, 1):
        query += f"{j}. {keyword}\n"

    logger.info(f"Finding product URLs for {len(targets)} items...")

    try:
        response = await asyncio.wait_for(
            client.aio.models.generate_content(
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
            ),
            timeout=30,
        )
        result_text = response.text
        logger.info(f"URL finder response: {result_text[:500]}")

        if trace:
            trace.step("url_finder_response", raw_response=result_text[:1000])

        # レスポンスからURLを行ごとに抽出
        lines = [line.strip() for line in result_text.strip().split("\n") if line.strip()]
        found_urls = []
        for line in lines:
            urls_in_line = URL_IN_TEXT_PATTERN.findall(line)
            if urls_in_line:
                found_urls.append(urls_in_line[0])
            elif "NOT_FOUND" in line:
                found_urls.append("")

        if trace:
            trace.step("url_finder_parsed", lines=lines, found_urls=found_urls)

        # 見つかったURLをアイテムに割り当て
        assigned = []
        for j, idx in enumerate(target_indices):
            if j < len(found_urls) and found_urls[j]:
                old_url = items[idx].get("product_url", "")
                new_url = found_urls[j]
                is_bad = _is_homepage_url(new_url) or _is_category_url(new_url)
                if not is_bad:
                    items[idx]["product_url"] = new_url
                    assigned.append({"name": items[idx].get("name", "?"), "old": old_url or "(none)", "new": new_url})
                    logger.info(
                        f"URL finder: {items[idx].get('name', '?')}: "
                        f"{old_url or '(none)'} → {new_url}"
                    )
                elif trace:
                    trace.step("url_finder_rejected", name=items[idx].get("name", "?"), url=new_url, reason="homepage or category page")

        if trace:
            trace.step("url_finder_result",
                        assigned=assigned,
                        items_after=[{"name": it.get("name", "?"), "url": it.get("product_url", "")} for it in items])

    except asyncio.TimeoutError:
        logger.warning("URL finder timed out (30s)")
        if trace:
            trace.step("url_finder_error", error="Timeout after 30 seconds", error_type="TimeoutError")
    except Exception as e:
        logger.warning(f"URL finder failed: {e}")
        if trace:
            trace.step("url_finder_error", error=str(e), error_type=type(e).__name__)

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


async def chat(history: list[dict], user_message: str, session_id: str = "") -> dict:
    """
    検証・自己補正機能を含むフロー:
    1. 生成
    2. URL検証（_verify_and_enrich）
    3. URLが無効な場合は、エラーメッセージを加えて再生成ループ（最大3回）
    """
    trace = DebugTrace(session_id=session_id)
    trace.step("chat_start", message_preview=user_message[:200], history_len=len(history))

    base_contents = _build_contents(history, user_message)

    last_error = None
    def _make_result(result, reply_text):
        """最終結果を構築（デバッグトレース付き）"""
        out = {
            **result,
            "reply": _clean_reply_text(result["reply"]),
            "raw_reply": reply_text,
        }
        if DEBUG_MODE:
            out["_debug"] = trace.to_dict()
        return out

    for model_name in MODEL_CANDIDATES:
        try:
            trace.step("model_try", model=model_name)
            logger.info(f"Trying model: {model_name}")

            config = types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT,
                temperature=0.7,
                tools=[GOOGLE_SEARCH_TOOL],
            )

            contents = list(base_contents)  # コピーして使う

            trace.step("attempt_start", model=model_name)
            logger.info(f"--- Generating with {model_name} ---")

            response = await client.aio.models.generate_content(
                model=model_name,
                contents=contents,
                config=config,
            )

            try:
                reply_text = response.text
            except (AttributeError, ValueError):
                reply_text = "申し訳ありません。問題が発生しました。もう一度お試しください。"
                trace.step("response_error", error="Could not extract text from response")
                return _make_result({"reply": reply_text, "items": []}, reply_text)

            trace.step("generation_done",
                       reply_length=len(reply_text),
                       reply_preview=reply_text[:300],
                       has_items_delimiter="<<<ITEMS>>>" in reply_text,
                       urls_in_text=URL_IN_TEXT_PATTERN.findall(reply_text))

            logger.info(f"Response (first 200): {reply_text[:200]}")

            result = parse_response(reply_text)
            trace.step("parse_response",
                       items_found=len(result["items"]),
                       item_names=[it.get("name", "?") for it in result["items"]],
                       item_urls=[it.get("product_url", "") for it in result["items"]])

            # Phase 2: <<<ITEMS>>> がなく長文 → 抽出リクエスト（Search OFF）
            if not result["items"] and len(reply_text) > 200:
                trace.step("extraction_start", reason=f"Long response ({len(reply_text)} chars) without <<<ITEMS>>>")
                logger.info(
                    f"Long response ({len(reply_text)} chars) without <<<ITEMS>>>. "
                    "Extracting items via separate request."
                )
                result["items"] = await _extract_items_from_text(reply_text, model_name)
                trace.step("extraction_done",
                           items_found=len(result["items"]),
                           item_names=[it.get("name", "?") for it in result["items"]],
                           item_urls=[it.get("product_url", "") for it in result["items"]])

            # ヒアリング中（items なし）→ テキストのみ返す
            if not result["items"]:
                trace.step("hearing_phase", reason="No items found - still in hearing phase")
                logger.info("No items (hearing phase)")
                return _make_result(result, reply_text)

            # テキスト中のURLをアイテムに注入（抽出モデルが見逃した場合）
            result["items"] = _inject_urls_from_text(result["items"], reply_text, trace)

            # Phase 3: 商品ページURL探索（ホームページURLや空URLの補完）
            result["items"] = await _find_product_urls(result["items"], model_name, trace)

            # Phase 4: URL検証 + OG画像/価格抽出
            trace.step("pre_verify",
                       orig_urls=[{"name": it.get("name", "?"), "url": it.get("product_url", "")} for it in result["items"]])

            logger.info(f"Verifying {len(result['items'])} items...")
            enriched_items = await _verify_and_enrich(result["items"], trace)

            # Phase 5: 検証で壊れたURLがあれば、URL Finderで再探索
            broken_items = [
                it for it in enriched_items
                if not it.get("product_url") and it.get("search_keyword")
            ]
            if broken_items:
                trace.step("post_verify_url_finder",
                           reason=f"{len(broken_items)} items lost URLs after verification",
                           items=[it.get("name", "?") for it in broken_items])
                enriched_items = await _find_product_urls(enriched_items, model_name, trace)

                # 再探索で見つかったURLを再検証
                newly_found = [
                    it for it in enriched_items
                    if it.get("product_url") and not it.get("url_type")
                ]
                if newly_found:
                    trace.step("post_verify_recheck",
                               count=len(newly_found),
                               urls=[it.get("product_url", "") for it in newly_found])
                    enriched_items = await _verify_and_enrich(enriched_items, trace)

            # 最終状態を記録
            trace.step("final_state",
                       items=[{
                           "name": it.get("name", "?"),
                           "url": it.get("product_url", ""),
                           "url_type": it.get("url_type", ""),
                           "has_image": bool(it.get("image_url")),
                       } for it in enriched_items])

            # URL無しアイテムがあっても再生成しない（再生成は良いアイテムも捨ててしまう）
            items_without_url = sum(
                1 for it in enriched_items
                if not it.get("product_url") and it.get("search_keyword")
            )
            result["items"] = enriched_items
            status = "success" if items_without_url == 0 else "some_items_without_url"
            trace.step("chat_done", status=status, items_without_url=items_without_url)
            if items_without_url > 0:
                logger.info(f"{items_without_url} items without URL (kept as-is, search button available)")
            return _make_result(result, reply_text)

        except Exception as e:
            last_error = e
            trace.step("model_error", model=model_name, error=str(e)[:300], error_type=type(e).__name__)
            logger.warning(f"Model {model_name} failed: {type(e).__name__}: {e}")
            continue

    trace.step("chat_done", status="all_models_failed")
    logger.error(f"All models failed. Last error: {last_error}")
    raise last_error
