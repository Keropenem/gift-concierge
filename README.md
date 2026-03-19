# Gift Concierge

大切な人にぴったりのプレゼントを提案するWebアプリ。

## セットアップ

```bash
# 依存パッケージインストール
pip install -r backend/requirements.txt

# APIキー設定
cp .env.example .env
# .env を開いて GEMINI_API_KEY を設定

# サーバー起動
uvicorn backend.main:app --reload

# ブラウザで http://localhost:8000 を開く
```

## Gemini APIキーの取得

1. [Google AI Studio](https://aistudio.google.com/apikey) にアクセス
2. 「Create API Key」でキーを発行
3. `.env` ファイルに貼り付け
