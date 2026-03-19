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

# 会話: Gemini 3系優先、検索: Google Search tool
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
    """各商品アイテムにOG画像URLを追加する"""
    if not items:
        return items

    tasks = []
    for item in items:
        url = item.get("product_url", "")
        if url and url.startswith("http"):
            tasks.append(fetch_og_image(url))
        else:
            tasks.append(asyncio.sleep(0))  # placeholder

    images = await asyncio.gather(*tasks, return_exceptions=True)

    for item, img in zip(items, images):
        if isinstance(img, str):
            item["image_url"] = img
        else:
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
    """会話履歴を使ってGeminiとマルチターン対話する（Google Search grounding付き）"""
    contents = _build_contents(history, user_message)

    last_error = None
    for model_name in MODEL_CANDIDATES:
        try:
            logger.info(f"Trying model: {model_name}")

            response = await client.aio.models.generate_content(
                model=model_name,
                contents=contents,
                config=types.GenerateContentConfig(
                    system_instruction=SYSTEM_PROMPT,
                    temperature=0.8,
                    tools=[GOOGLE_SEARCH_TOOL],
                ),
            )

            reply_text = response.text
            logger.info(f"Success with model: {model_name}")
            logger.debug(f"Response (first 300): {reply_text[:300]}")

            result = parse_response(reply_text)

            # 商品アイテムがあればOG画像を取得
            if result["items"]:
                result["items"] = await enrich_items_with_images(result["items"])

            return {
                **result,
                "raw_reply": reply_text,
            }

        except Exception as e:
            last_error = e
            logger.warning(f"Model {model_name} failed: {type(e).__name__}: {e}")
            continue

    logger.error(f"All models failed. Last error: {last_error}")
    raise last_error
