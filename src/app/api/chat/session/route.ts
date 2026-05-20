import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type HistoryMessage = { role: string; parts: Array<{ text: string }> };

// 既存セッション用フォールバック：「【...】」ブロックを除去して末尾の生メッセージだけ返す
function stripSystemContextBlocks(text: string): string {
  // 「【...】...」で始まり、最後の "\n\n" 以降がユーザーの元入力という保存形式に対応
  if (!text.startsWith("【")) return text;
  const lastBreak = text.lastIndexOf("\n\n");
  if (lastBreak === -1) return text;
  return text.slice(lastBreak + 2);
}

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const { data } = await supabase
    .from("sessions")
    .select("messages, profile_input")
    .eq("id", id)
    .single();

  if (!data) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }

  const messages: HistoryMessage[] = (data.messages || []) as HistoryMessage[];
  const originalMessage = (data.profile_input as Record<string, unknown> | null)?._originalMessage as
    | string
    | undefined;

  // 最初のuserメッセージのテキストを「純粋なユーザー入力」に差し替える
  // 優先順位: _originalMessage（新セッション形式） → "【...】" ブロック除去のフォールバック（旧セッション）
  if (messages.length > 0 && messages[0].role === "user" && messages[0].parts?.[0]) {
    const rawText = messages[0].parts[0].text;
    const displayText = originalMessage ?? stripSystemContextBlocks(rawText);
    messages[0] = {
      ...messages[0],
      parts: [{ text: displayText }],
    };
  }

  return NextResponse.json({ messages });
}
