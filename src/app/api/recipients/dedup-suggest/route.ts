import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { clusterDuplicates } from "@/lib/recipientMatcher";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data: recipients, error } = await supabase
    .from("recipients")
    .select("id, nickname, relationship, age, gender, occupation, interests")
    .eq("user_id", user.id)
    .is("canonical_recipient_id", null);

  if (error) {
    console.error("[DEDUP] fetch error:", error.message);
    return NextResponse.json({ error: "fetch failed" }, { status: 500 });
  }

  const clusters = await clusterDuplicates(recipients ?? []);

  // ID → 詳細マップを返却に含める（フロントで表示しやすいように）
  const idToDetail = new Map((recipients ?? []).map((r) => [r.id, r]));
  const enriched = clusters.map((c) => ({
    canonical: idToDetail.get(c.canonical_id) ?? null,
    members: c.member_ids.map((id) => idToDetail.get(id) ?? null).filter(Boolean),
    canonical_id: c.canonical_id,
    member_ids: c.member_ids,
    confidence: c.confidence,
    reasoning: c.reasoning,
  }));

  return NextResponse.json({ clusters: enriched });
}
