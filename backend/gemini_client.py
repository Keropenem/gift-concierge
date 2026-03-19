import asyncio
import json
import logging
import os
import re
from typing import Optional
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

# 会話: Gemini 3系優先
MODEL_CANDIDATES = [
    "gemini-3-flash-preview",
    "gemini-2.5-flash",
]

GOOGLE_SEARCH_TOOL = types.Tool(google_search=types.GoogleSearch())

# ── Function Calling: 商品URL検証ツール ──
VERIFY_URL_DECL = types.FunctionDeclaration(
    name="verify_product_url",
    description=(
        "商品URLにアクセスし、ページが実在するか検証する。"
        "HTTPステータス、ページタイトル、OG画像URLを返す。"
        "商品を提案する前に必ずこのツールでURLの存在を確認すること。"
    ),
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={
            "url": types.Schema(
                type=types.Type.STRING,
                description="検証する商品ページのURL",
            ),
        },
        required=["url"],
    ),
)

FUNCTION_TOOL = types.Tool(function_declarations=[VERIFY_URL_DECL])

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


# ── URL検証関数（Function Callingから呼ばれる） ──

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


# Function Call ディスパッチャ
FUNCTION_HANDLERS = {
    "verify_product_url": verify_product_url,
}


async def _execute_function_call(fc) -> dict:
    """Function Callを実行して結果を返す"""
    handler = FUNCTION_HANDLERS.get(fc.name)
    if not handler:
        return {"error": f"Unknown function: {fc.name}"}
    try:
        args = dict(fc.args) if fc.args else {}
        return await handler(**args)
    except Exception as e:
        logger.error(f"Function {fc.name} error: {e}")
        return {"error": str(e)[:200]}


# ── OG画像取得（フォールバック用） ──

def _fetch_og_image_sync(url: str) -> Optional[str]:
    """URLからOG画像URLを取得する（同期）"""
    try:
        req = Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        })
        with urlopen(req, timeout=5) as resp:
            html = resp.read(50000).decode("utf-8", errors="ignore")
        match = OG_IMAGE_PATTERN.search(html)
        if match:
            return match.group(1) or match.group(2)
    except Exception as e:
        logger.debug(f"OG image fetch failed for {url}: {e}")
    return None


async def fetch_og_image(url: str) -> Optional[str]:
    """URLからOG画像URLを取得する（非同期）"""
    return await asyncio.to_thread(_fetch_og_image_sync, url)


async def enrich_items_with_images(items: list[dict]) -> list[dict]:
    """各商品アイテムにOG画像URLを追加する（未取得分のみ）"""
    if not items:
        return items

    tasks = []
    for item in items:
        url = item.get("product_url", "")
        if url and url.startswith("http") and not item.get("image_url"):
            tasks.append(fetch_og_image(url))
        else:
            tasks.append(asyncio.sleep(0))  # placeholder

    images = await asyncio.gather(*tasks, return_exceptions=True)

    for item, img in zip(items, images):
        if isinstance(img, str):
            item["image_url"] = img
        elif not item.get("image_url"):
            item["image_url"] = None

    return items


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
    """会話履歴を使ってGeminiとマルチターン対話する（Function Calling + Google Search grounding）"""
    contents = _build_contents(history, user_message)

    last_error = None
    for model_name in MODEL_CANDIDATES:
        # Google Search + Function Calling を試し、互換性エラーなら Function Calling のみにフォールバック
        tool_configs = [
            [GOOGLE_SEARCH_TOOL, FUNCTION_TOOL],
            [FUNCTION_TOOL],
        ]

        for tools in tool_configs:
            try:
                tool_names = []
                for t in tools:
                    if t.google_search:
                        tool_names.append("GoogleSearch")
                    if t.function_declarations:
                        tool_names.append("FunctionCalling")
                logger.info(f"Trying model: {model_name}, tools: {tool_names}")

                config = types.GenerateContentConfig(
                    system_instruction=SYSTEM_PROMPT,
                    temperature=0.8,
                    tools=tools,
                )

                # ── エージェントループ ──
                loop_contents = list(contents)
                MAX_ROUNDS = 10
                response = None

                for round_num in range(MAX_ROUNDS):
                    response = await client.aio.models.generate_content(
                        model=model_name,
                        contents=loop_contents,
                        config=config,
                    )

                    candidate = response.candidates[0]
                    parts = candidate.content.parts
                    function_calls = [p for p in parts if p.function_call]

                    if not function_calls:
                        break  # テキスト応答 → ループ終了

                    logger.info(
                        f"[Round {round_num + 1}] Function calls: "
                        f"{[p.function_call.name for p in function_calls]}"
                    )

                    # モデルの応答を contents に追加
                    loop_contents.append(candidate.content)

                    # 各 Function Call を並行実行
                    fc_tasks = []
                    for part in function_calls:
                        fc = part.function_call
                        logger.info(f"Executing: {fc.name}({fc.args})")
                        fc_tasks.append(_execute_function_call(fc))

                    fc_results = await asyncio.gather(*fc_tasks)

                    # Function Response を user role で追加
                    fc_response_parts = []
                    for part, result in zip(function_calls, fc_results):
                        logger.info(
                            f"Result for {part.function_call.name}: "
                            f"{json.dumps(result, ensure_ascii=False)[:300]}"
                        )
                        fc_response_parts.append(types.Part(
                            function_response=types.FunctionResponse(
                                name=part.function_call.name,
                                response=result,
                            )
                        ))

                    loop_contents.append(
                        types.Content(role="user", parts=fc_response_parts)
                    )

                # 最終応答のテキストを取得
                try:
                    reply_text = response.text
                except (AttributeError, ValueError):
                    logger.warning("No text in final response")
                    reply_text = "申し訳ありません。商品の検証中に問題が発生しました。もう一度お試しください。"

                logger.info(f"Success with model: {model_name}")
                logger.debug(f"Response (first 300): {reply_text[:300]}")

                result = parse_response(reply_text)

                # 商品アイテムがあればOG画像を取得（まだ無い分のみ）
                if result["items"]:
                    result["items"] = await enrich_items_with_images(result["items"])

                return {
                    **result,
                    "raw_reply": reply_text,
                }

            except Exception as e:
                last_error = e
                error_msg = str(e).lower()
                logger.warning(
                    f"Model {model_name} failed: {type(e).__name__}: {e}"
                )
                # Google Search + Function Calling の互換性エラー → Function Calling のみへ
                if "google_search" in error_msg or "incompatible" in error_msg:
                    logger.info("Falling back to Function Calling only")
                    continue
                else:
                    break  # 他のエラーは次のモデルへ

    logger.error(f"All models failed. Last error: {last_error}")
    raise last_error
