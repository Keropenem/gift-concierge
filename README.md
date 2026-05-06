# ENN

Context Matching Gift EC Service

贈り手と受け取り手の人生の文脈から「見えない共通点」を見出し、唯一無二のプレゼントを提案するギフトECサービス。

## 技術スタック

- **Frontend**: Next.js + TypeScript + Tailwind CSS + shadcn/ui
- **Backend**: Next.js API Routes
- **DB/Auth**: Supabase (PostgreSQL + Auth)
- **LLM**: Gemini API (Google AI)
- **Hosting**: Vercel

## セットアップ

```bash
# 依存パッケージインストール
npm install

# 環境変数設定
cp .env.local.example .env.local
# .env.local を編集して各種APIキーを設定

# 開発サーバー起動
npm run dev
```

ブラウザで http://localhost:3000 を開く

## 環境変数

| 変数名 | 説明 |
|--------|------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase プロジェクトURL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key |
| `GEMINI_API_KEY` | Google AI (Gemini) APIキー |
