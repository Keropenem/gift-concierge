import asyncio
import logging
import sys
import os

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s:%(message)s')

sys.path.append(os.path.dirname(__file__))

from backend.gemini_client import chat

async def main():
    history = [
        {
            "role": "user",
            "parts": ["オーストラリアから帰国に際して、日本の友人にお土産。予算は5000円以内。"]
        }
    ]
    prompt = "60代女性で、NGO法人の理事長。オーガニックなものを取り入れたり、ヨガやランニングをしたりと、健康的なライフスタイル。少しスピリチュアル。仕事が忙しいながら、趣味の時間や自分のケアのための時間も取る。最近母親の介護が必要になり、そちらも頑張っている。もともとメンターだが、10年以上の付き合いで今や親戚や家族のような存在。共通の趣味はランニングなどだが、一緒に走ったことはない。話題は多岐にわたり、人生や医療関係の相談、最近の報告など、家族のような感じ。困りごとは､多分忙しい中で母親の介護も始めたこと、NPO理事長退任を見据えての引き継ぎをしなければならないが、後進がいないことなど。私は38歳の医師でオーストラリアのシドニーに研究留学に来た。1年留学していた。離婚して単身海外へやって来た。メンターとして、ときに励まし合いながら定期的に連絡を取ってきた。久しぶりの気持ちと、旧交を温める感じ。オーストラリアの自然・エコにフレンドリーなライフスタイルや、その一方で良い感じに力の抜けたワーク・ライフ・バランスの取れた生活など、Cozyな雰囲気が良かったな。"
    
    try:
        res = await chat(history, prompt)
        print("\n\n====== FINAL RESULT ======")
        print(res.get("reply", ""))
        print("====== FINAL ITEMS ======")
        for item in res.get("items", []):
            print(f"Name: {item.get('name')}")
            print(f"URL: {item.get('product_url')}")
            print(f"Price: {item.get('price_min')} {item.get('actual_currency')}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    if sys.platform == 'win32':
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    try:
        asyncio.run(main())
    except RuntimeError as e:
        if str(e) == 'Event loop is closed':
            pass
        else:
            raise
