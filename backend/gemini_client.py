import json
import os

import google.generativeai as genai
from dotenv import load_dotenv

from .prompts import SYSTEM_PROMPT, build_user_prompt

load_dotenv()

genai.configure(api_key=os.getenv("GEMINI_API_KEY"))

model = genai.GenerativeModel(
    model_name="gemini-2.0-flash",
    system_instruction=SYSTEM_PROMPT,
    generation_config=genai.GenerationConfig(
        response_mime_type="application/json",
        temperature=0.8,
    ),
)


async def suggest_gifts(form_data: dict) -> dict:
    """Gemini APIにリクエストを送り、ギフト提案を取得する"""
    user_prompt = build_user_prompt(form_data)

    response = await model.generate_content_async(user_prompt)

    try:
        result = json.loads(response.text)
    except json.JSONDecodeError:
        result = {
            "suggestions": [],
            "message": "提案の生成に失敗しました。もう一度お試しください。",
        }

    return result
