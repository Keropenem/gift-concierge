import asyncio
import os
import sys

# Change directory
sys.path.append(os.path.dirname(__file__))

from backend.gemini_client import chat

async def main():
    history = [
        {"role": "user", "parts": ["オーストラリアから帰国に際して、日本の友人にお土産。予算は5000円以内..."]},
    ]
    res = await chat(history, "60代女性で、NGO法人の理事長...")
    print(res)

if __name__ == "__main__":
    asyncio.run(main())
