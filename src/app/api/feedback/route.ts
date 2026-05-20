import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type Rating = "good" | "neutral" | "bad";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const body = await request.json();
  const session_id = body.session_id as string | undefined;
  const message_index = body.message_index as number | undefined;
  const rating = body.rating as Rating | undefined;
  const comment = (body.comment as string | undefined) ?? null;

  if (!session_id || typeof message_index !== "number" || !rating) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }
  if (!["good", "neutral", "bad"].includes(rating)) {
    return NextResponse.json({ error: "invalid_rating" }, { status: 400 });
  }

  const { error } = await supabase.from("feedback").upsert(
    {
      user_id: user.id,
      session_id,
      message_index,
      rating,
      comment,
    },
    { onConflict: "session_id,message_index" }
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ feedback: [] });
  }

  const session_id = request.nextUrl.searchParams.get("session_id");
  if (!session_id) {
    return NextResponse.json({ feedback: [] });
  }

  const { data } = await supabase
    .from("feedback")
    .select("message_index, rating, comment")
    .eq("session_id", session_id);

  return NextResponse.json({ feedback: data || [] });
}
