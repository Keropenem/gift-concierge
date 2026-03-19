import json
import logging
import os
import re

import google.generativeai as genai
from dotenv import load_dotenv

from .prompts import SYSTEM_PROMPT

load_dotenv()

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("gift-concierge")

api_key = os.getenv("GEMINI_API_KEY")
logger.info(f"API key loaded: {'Yes' if api_key else 'No'}")

genai.configure(api_key=api_key)

MODEL_CANDIDATES = [
    "gemini-3-flash-preview",
    "gemini-2.5-flash",
    "gemini-2.0-flash",
]

ITEMS_PATTERN = re.compile(
    r"<<<ITEMS>>>\s*(.*?)\s*<<<END_ITEMS>>>",
    re.DOTALL,
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


async def chat(history: list[dict], user_message: str) -> dict:
    """会話履歴を使ってGeminiとマルチターン対話する。

    history: [{"role": "user"|"model", "parts": ["text"]}, ...]
    """
    contents = history + [{"role": "user", "parts": [user_message]}]

    last_error = None
    for model_name in MODEL_CANDIDATES:
        try:
            logger.info(f"Trying model: {model_name}")
            model = genai.GenerativeModel(
                model_name=model_name,
                system_instruction=SYSTEM_PROMPT,
                generation_config=genai.GenerationConfig(
                    temperature=0.8,
                ),
            )
            response = await model.generate_content_async(contents)
            reply_text = response.text
            logger.info(f"Success with model: {model_name}")
            logger.debug(f"Response (first 300): {reply_text[:300]}")

            result = parse_response(reply_text)
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
