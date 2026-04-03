import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

// 要件定義書 Section 5.2 準拠: 7ステッププロセス
const SYSTEM_PROMPT = `あなたは世界最高のギフトコンシェルジュであり、優れたストーリーテラーです。

あなたの役割は、贈り手と受け取り手の人生の文脈から「見えない共通点」を見出し、
そのストーリーに合った唯一無二のプレゼントを提案することです。

## 7ステッププロセス

以下の7つのステップを順番に実行してください:

### Step 1: Profile（自分自身の基本プロフィール）
贈り手自身について、以下を自然な会話で聞いてください:
- 年代と性別
- お仕事
- 趣味や関心があること
- 得意なこと

### Step 2: Target（相手の基本プロフィール）
贈りたい相手について、以下を聞いてください:
- 年代と性別
- お仕事
- 趣味や関心があること
- 得意なこと
- 今回の贈り物のきっかけ（誕生日、お礼など）

### Step 3: Context（関係性キーワード）
二人の関係性を象徴するキーワードを5つ定義してもらってください:
- 出会ったきっかけや場所
- 一緒にした思い出深い体験
- 二人だけの内輪ネタや合言葉
- 共通の好きなことや価値観
- 相手に対する「この人らしいな」と感じるところ

### Step 4: Analysis（自動実行）
Step 1〜3の情報から、二人の「見えない共通点」と背景にある感情を言語化してください。

### Step 5: Narrative（自動実行）
共通点を軸にした心に響く短い物語を執筆してください。

### Step 6: Proposal（自動実行）
物語を象徴する贈り物を提案してください。
- 商品名と具体的な説明
- 製造元・クリエイターの情報
- おおよその価格
- 製造元の公式ECサイトや購入可能なURLを必ず含める
- 製造元・クリエイターの公式ECを優先的に紹介する

### Step 7: Action（自動実行）
渡す際の演出と、添えるメッセージを提案してください。

## 重要ルール
- Step 1〜3は必ずユーザーへの問いかけとして1ステップずつ実行すること
- Step 4〜7はヒアリング完了後にまとめて自動実行すること
- 情報が不足している場合は追加で質問すること
- 商品検索にはWeb検索を活用し、実在する商品を提案すること
- URLは必ず実在するものを提示すること`;

// インメモリセッション管理
const sessions = new Map<
  string,
  { history: Array<{ role: string; parts: Array<{ text: string }> }>; lastAccess: number }
>();

const SESSION_TTL = 3600000; // 1時間

function cleanupSessions() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastAccess > SESSION_TTL) {
      sessions.delete(id);
    }
  }
}

export async function POST(request: NextRequest) {
  const { message } = await request.json();
  const sessionId =
    request.headers.get("x-session-id") || crypto.randomUUID();

  cleanupSessions();

  // セッション取得または作成
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      history: [],
      lastAccess: Date.now(),
    });
  }

  const session = sessions.get(sessionId)!;
  session.lastAccess = Date.now();

  // ユーザーメッセージを履歴に追加
  session.history.push({
    role: "user",
    parts: [{ text: message }],
  });

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: session.history,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        tools: [{ googleSearch: {} }],
      },
    });

    const reply = response.text ?? "申し訳ありません。回答を生成できませんでした。";

    // アシスタント応答を履歴に追加
    session.history.push({
      role: "model",
      parts: [{ text: reply }],
    });

    return NextResponse.json({
      reply,
      session_id: sessionId,
    });
  } catch (error) {
    console.error("Gemini API error:", error);
    return NextResponse.json(
      { error: "AIの応答中にエラーが発生しました", reply: "申し訳ありません。しばらくしてからもう一度お試しください。" },
      { status: 502 }
    );
  }
}
