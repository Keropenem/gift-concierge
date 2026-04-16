import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const { data } = await supabase
    .from("sessions")
    .select("messages")
    .eq("id", id)
    .single();

  if (!data) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }

  return NextResponse.json({ messages: data.messages });
}
