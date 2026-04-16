import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ sessions: [] });
  }

  const { data } = await supabase
    .from("sessions")
    .select("id, created_at, messages")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);

  const sessions = (data || []).map((s: { id: string; created_at: string; messages: Array<{ role: string; parts: Array<{ text: string }> }> }) => {
    const firstUserMsg = s.messages?.find((m: { role: string }) => m.role === "user");
    const preview = firstUserMsg?.parts?.[0]?.text?.substring(0, 80) || "新しい相談";
    return {
      id: s.id,
      created_at: s.created_at,
      preview,
      messageCount: s.messages?.length || 0,
    };
  });

  return NextResponse.json({ sessions });
}
