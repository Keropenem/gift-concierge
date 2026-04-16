import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI, Type } from "@google/genai";
import { createClient } from "@supabase/supabase-js";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

// service_role keyでRLSをバイパス（サーバー側専用、ブラウザに露出しない）
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

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
- URLは必ず実在するものを提示すること

## 情報の記録
会話からユーザーについて新しく分かったこと（好み、価値観、ライフスタイル、人間関係、エピソードなど）があれば、
save_memories 関数を呼び出して記録してください。構造化されたプロフィール項目だけでなく、
あらゆる有用な情報を自由な文章で記録してください。
例: 「ミニマルなデザインを好む」「犬を2匹飼っている」「モノより体験を重視する」「毎年夏に家族で沖縄旅行をする」`;

const memoriesTool = {
  name: "save_memories",
  description: "会話から分かったユーザーに関する情報を自由形式で記録する。好み・価値観・ライフスタイル・人間関係・エピソードなど、今後のギフト提案に役立つあらゆる情報を保存する。",
  parameters: {
    type: Type.OBJECT,
    properties: {
      memories: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: "記録する情報の配列。1つの情報につき1文で簡潔に。例: [\"ミニマルなデザインを好む\", \"犬を2匹飼っている\"]",
      },
    },
    required: ["memories"],
  },
};

const extractionTool = {
  name: "save_profile_data",
  description: "会話から判明した贈り手と受取り手のプロフィール情報を保存する",
  parameters: {
    type: Type.OBJECT,
    properties: {
      sender_age: { type: Type.INTEGER, description: "贈り手の年齢", nullable: true },
      sender_gender: { type: Type.STRING, description: "贈り手の性別（male/female/other）", nullable: true },
      sender_occupation: { type: Type.STRING, description: "贈り手の職業", nullable: true },
      sender_interests: { type: Type.ARRAY, items: { type: Type.STRING }, description: "贈り手の趣味・関心事", nullable: true },
      sender_strengths: { type: Type.ARRAY, items: { type: Type.STRING }, description: "贈り手の得意なこと", nullable: true },
      recipient_nickname: { type: Type.STRING, description: "受取り手の呼び名", nullable: true },
      recipient_relationship: { type: Type.STRING, description: "関係性", nullable: true },
      recipient_age: { type: Type.INTEGER, description: "受取り手の年齢", nullable: true },
      recipient_gender: { type: Type.STRING, description: "受取り手の性別", nullable: true },
      recipient_occupation: { type: Type.STRING, description: "受取り手の職業", nullable: true },
      recipient_interests: { type: Type.ARRAY, items: { type: Type.STRING }, description: "受取り手の趣味", nullable: true },
      recipient_strengths: { type: Type.ARRAY, items: { type: Type.STRING }, description: "受取り手の得意なこと", nullable: true },
      occasion: { type: Type.STRING, description: "贈り物のきっかけ", nullable: true },
    },
    required: [],
  },
};

// インメモリセッション管理
interface SessionData {
  history: Array<{ role: string; parts: Array<{ text: string }> }>;
  lastAccess: number;
  userId: string | null;
  senderData: Record<string, unknown>;
  recipientData: Record<string, unknown>;
}

const sessions = new Map<string, SessionData>();
const SESSION_TTL = 3600000;

function cleanupSessions() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastAccess > SESSION_TTL) {
      sessions.delete(id);
    }
  }
}

function mergeData(existing: Record<string, unknown>, incoming: Record<string, unknown>): Record<string, unknown> {
  const merged = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (value !== null && value !== undefined) {
      if (Array.isArray(value) && Array.isArray(merged[key])) {
        const existingArr = merged[key] as string[];
        const newItems = (value as string[]).filter((v: string) => !existingArr.includes(v));
        merged[key] = [...existingArr, ...newItems];
      } else {
        merged[key] = value;
      }
    }
  }
  return merged;
}

async function saveToSupabase(userId: string, senderData: Record<string, unknown>, recipientData: Record<string, unknown>) {
  const senderUpdate: Record<string, unknown> = {};
  if (senderData.age) senderUpdate.age = senderData.age;
  if (senderData.gender) senderUpdate.gender = senderData.gender;
  if (senderData.occupation) senderUpdate.occupation = senderData.occupation;
  if (senderData.interests) senderUpdate.interests = senderData.interests;
  if (senderData.strengths) senderUpdate.strengths = senderData.strengths;

  if (Object.keys(senderUpdate).length > 0) {
    await supabase.from("profiles").update(senderUpdate).eq("id", userId);
  }

  if (recipientData.nickname) {
    const { data: existing } = await supabase
      .from("recipients")
      .select("id")
      .eq("user_id", userId)
      .eq("nickname", recipientData.nickname as string)
      .maybeSingle();

    const recipientRow: Record<string, unknown> = { user_id: userId, nickname: recipientData.nickname };
    if (recipientData.relationship) recipientRow.relationship = recipientData.relationship;
    if (recipientData.age) recipientRow.age = recipientData.age;
    if (recipientData.gender) recipientRow.gender = recipientData.gender;
    if (recipientData.occupation) recipientRow.occupation = recipientData.occupation;
    if (recipientData.interests) recipientRow.interests = recipientData.interests;
    if (recipientData.strengths) recipientRow.strengths = recipientData.strengths;

    if (existing) {
      await supabase.from("recipients").update(recipientRow).eq("id", existing.id);
    } else {
      await supabase.from("recipients").insert(recipientRow);
    }
  }
}

async function saveMemories(userId: string, memories: string[]) {
  const rows = memories.map((content) => ({
    user_id: userId,
    content,
    source: "ai",
  }));

  // 重複チェック: 既存のメモリと同じ内容は保存しない
  const { data: existing } = await supabase
    .from("memories")
    .select("content")
    .eq("user_id", userId);

  const existingContents = new Set((existing || []).map((m: { content: string }) => m.content));
  const newRows = rows.filter((r) => !existingContents.has(r.content));

  if (newRows.length > 0) {
    await supabase.from("memories").insert(newRows);
    console.log("Saved memories:", newRows.map((r) => r.content));
  }
}

// 2段階目: 会話から情報を抽出（Function Calling、バックグラウンド）
async function extractFromConversation(
  conversationHistory: Array<{ role: string; parts: Array<{ text: string }> }>,
  session: SessionData
) {
  try {
    const extractionPrompt = [
      ...conversationHistory,
      {
        role: "user" as const,
        parts: [{
          text: "ここまでの会話から判明した情報を記録してください。\n" +
            "1. save_profile_data で贈り手・受取り手の構造化プロフィールを保存\n" +
            "2. save_memories でそれ以外の有用な情報（好み・価値観・ライフスタイル・エピソード等）を自由形式で保存\n" +
            "両方呼び出してください。"
        }],
      },
    ];

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: extractionPrompt,
      config: {
        tools: [{ functionDeclarations: [extractionTool, memoriesTool] }],
      },
    });

    const parts = response.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      if (part.functionCall?.name === "save_profile_data") {
        const args = (part.functionCall.args || {}) as Record<string, unknown>;

        const senderNew: Record<string, unknown> = {};
        if (args.sender_age) senderNew.age = args.sender_age;
        if (args.sender_gender) senderNew.gender = args.sender_gender;
        if (args.sender_occupation) senderNew.occupation = args.sender_occupation;
        if (args.sender_interests) senderNew.interests = args.sender_interests;
        if (args.sender_strengths) senderNew.strengths = args.sender_strengths;
        session.senderData = mergeData(session.senderData, senderNew);

        const recipientNew: Record<string, unknown> = {};
        if (args.recipient_nickname) recipientNew.nickname = args.recipient_nickname;
        if (args.recipient_relationship) recipientNew.relationship = args.recipient_relationship;
        if (args.recipient_age) recipientNew.age = args.recipient_age;
        if (args.recipient_gender) recipientNew.gender = args.recipient_gender;
        if (args.recipient_occupation) recipientNew.occupation = args.recipient_occupation;
        if (args.recipient_interests) recipientNew.interests = args.recipient_interests;
        if (args.recipient_strengths) recipientNew.strengths = args.recipient_strengths;
        if (args.occasion) recipientNew.occasion = args.occasion;
        session.recipientData = mergeData(session.recipientData, recipientNew);

        if (session.userId) {
          await saveToSupabase(session.userId, session.senderData, session.recipientData);
        }
        console.log("Extracted profile data:", JSON.stringify(args));
      }

      if (part.functionCall?.name === "save_memories") {
        const args = (part.functionCall.args || {}) as { memories?: string[] };
        if (args.memories && args.memories.length > 0 && session.userId) {
          await saveMemories(session.userId, args.memories);
        }
      }
    }
  } catch (err) {
    console.error("Extraction error:", err);
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { message, profile, recipient, userId, memories: userMemories } = body;
  const sessionId = request.headers.get("x-session-id") || crypto.randomUUID();

  cleanupSessions();

  if (!sessions.has(sessionId)) {
    const contextParts: string[] = [];

    // メモリを注入
    if (userMemories && Array.isArray(userMemories) && userMemories.length > 0) {
      contextParts.push(
        `【過去の会話から記録された情報】\n` +
        userMemories.map((m: { content: string }) => `- ${m.content}`).join("\n") +
        `\nこの情報を踏まえて提案に活かしてください。`
      );
    }

    if (profile && profile.occupation) {
      contextParts.push(
        `【会員情報】この贈り手は登録済み会員です。以下のプロフィールがあります:\n` +
        `年齢: ${profile.age || "不明"}, 性別: ${profile.gender || "不明"}, 職業: ${profile.occupation || "不明"}\n` +
        `関心事: ${(profile.interests || []).join(", ") || "不明"}, 得意なこと: ${(profile.strengths || []).join(", ") || "不明"}\n` +
        `Step 1はスキップし、Step 2から開始してください。`
      );
    }

    if (recipient) {
      contextParts.push(
        `【受取り手情報】以下の相手への贈り物です:\n` +
        `呼び名: ${recipient.nickname}, 関係性: ${recipient.relationship || "不明"}\n` +
        `年齢: ${recipient.age || "不明"}, 性別: ${recipient.gender || "不明"}, 職業: ${recipient.occupation || "不明"}\n` +
        `関心事: ${(recipient.interests || []).join(", ") || "不明"}, 得意なこと: ${(recipient.strengths || []).join(", ") || "不明"}\n` +
        `Step 2もスキップし、Step 3から開始してください。`
      );
    }

    const firstMessage = contextParts.length > 0
      ? contextParts.join("\n\n") + "\n\n" + message
      : message;

    sessions.set(sessionId, {
      history: [{ role: "user", parts: [{ text: firstMessage }] }],
      lastAccess: Date.now(),
      userId: userId || null,
      senderData: profile || {},
      recipientData: recipient || {},
    });
  } else {
    const session = sessions.get(sessionId)!;
    session.lastAccess = Date.now();
    session.history.push({ role: "user", parts: [{ text: message }] });
  }

  const session = sessions.get(sessionId)!;

  try {
    // 1段階目: 通常の会話（Google Search付き）
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: session.history,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        tools: [{ googleSearch: {} }],
      },
    });

    const reply = response.text ?? "申し訳ありません。回答を生成できませんでした。";

    session.history.push({ role: "model", parts: [{ text: reply }] });

    // 2段階目: 情報抽出（同期実行 — Vercelサーバーレスではバックグラウンド処理が死ぬため）
    if (session.userId) {
      try {
        await extractFromConversation(session.history, session);
      } catch (err) {
        console.error("Extraction error:", err);
      }
    }

    return NextResponse.json({
      reply,
      session_id: sessionId,
    });
  } catch (error) {
    console.error("Gemini API error:", error);
    return NextResponse.json(
      {
        error: "AIの応答中にエラーが発生しました",
        reply: "申し訳ありません。しばらくしてからもう一度お試しください。",
      },
      { status: 502 }
    );
  }
}
