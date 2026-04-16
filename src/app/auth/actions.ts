"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function signup(formData: FormData) {
  const supabase = await createClient();

  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  const { error } = await supabase.auth.signUp({
    email,
    password,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/", "layout");
  redirect("/mypage");
}

export async function login(formData: FormData) {
  const supabase = await createClient();

  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/", "layout");
  redirect("/");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/");
}

export async function updateProfile(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const age = parseInt(formData.get("age") as string) || null;
  const gender = formData.get("gender") as string;
  const occupation = formData.get("occupation") as string;
  const interestsRaw = formData.get("interests") as string;
  const strengthsRaw = formData.get("strengths") as string;

  const interests = interestsRaw
    ? interestsRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const strengths = strengthsRaw
    ? strengthsRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  await supabase
    .from("profiles")
    .update({ age, gender, occupation, interests, strengths })
    .eq("id", user.id);

  revalidatePath("/mypage");
}

export async function deleteRecipient(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const recipientId = formData.get("recipientId") as string;

  await supabase
    .from("recipients")
    .delete()
    .eq("id", recipientId)
    .eq("user_id", user.id);

  revalidatePath("/mypage");
}

export async function updateRecipient(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const recipientId = formData.get("recipientId") as string;
  const nickname = formData.get("nickname") as string;
  const relationship = formData.get("relationship") as string;
  const age = parseInt(formData.get("age") as string) || null;
  const gender = formData.get("gender") as string;
  const occupation = formData.get("occupation") as string;
  const interestsRaw = formData.get("interests") as string;
  const strengthsRaw = formData.get("strengths") as string;

  const interests = interestsRaw
    ? interestsRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const strengths = strengthsRaw
    ? strengthsRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  await supabase
    .from("recipients")
    .update({ nickname, relationship, age, gender, occupation, interests, strengths })
    .eq("id", recipientId)
    .eq("user_id", user.id);

  revalidatePath("/mypage");
}
