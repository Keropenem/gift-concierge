import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const canonicalId = body.canonical_id as string | undefined;
  const memberIds = (body.member_ids as string[] | undefined) ?? [];

  if (!canonicalId || memberIds.length === 0) {
    return NextResponse.json({ error: "canonical_id and member_ids required" }, { status: 400 });
  }

  // 全IDが本人のもので、現状canonical（=正本）であることを確認
  const allIds = [canonicalId, ...memberIds];
  const { data: rows, error: fetchErr } = await supabase
    .from("recipients")
    .select("id, user_id, canonical_recipient_id")
    .in("id", allIds);

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  if (!rows || rows.length !== allIds.length) {
    return NextResponse.json({ error: "some ids not found" }, { status: 400 });
  }

  for (const r of rows) {
    if (r.user_id !== user.id) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (r.canonical_recipient_id !== null) {
      return NextResponse.json({ error: "already merged: " + r.id }, { status: 409 });
    }
  }

  const { error: updateErr } = await supabase
    .from("recipients")
    .update({ canonical_recipient_id: canonicalId })
    .in("id", memberIds);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, merged: memberIds.length });
}
