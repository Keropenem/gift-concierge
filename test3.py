import asyncio
import logging

logging.basicConfig(level=logging.DEBUG)

import sys
import os

sys.path.append(os.path.dirname(__file__))

from backend.gemini_client import chat

async def main():
    history = [
        {
            "role": "user",
            "parts": ["オーストラリアから帰国に際して、日本の友人にお土産。予算は5000円以内。"]
        }
    ]
    prompt = "60代女性で、NGO法人の理事長。オーガニックなものを取り入れたり、ヨガやランニングをしたりと、健康的なライフスタイル。少しスピリチュアル。仕事が忙しいながら、趣味の時間や自分のケアのための時間も取る。最近母親の介護が必要になり、そちらも頑張っている。"
    try:
        res = await chat(history, prompt)
        print("====== RESULT ======")
        print(res.get("reply", ""))
        print("====== ITEMS ======")
        for item in res.get("items", []):
            print(f"Name: {item.get('name')}")
            print(f"URL: {item.get('product_url')}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    if sys.platform == 'win32':
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main())
