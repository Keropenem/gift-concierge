"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function SignupPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;
    const age = parseInt(formData.get("age") as string) || null;
    const gender = formData.get("gender") as string;
    const occupation = formData.get("occupation") as string;
    const interestsRaw = formData.get("interests") as string;
    const strengthsRaw = formData.get("strengths") as string;

    const supabase = createClient();

    // 1. サインアップ
    const { data, error: signupError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (signupError) {
      setError(signupError.message);
      setLoading(false);
      return;
    }

    // 2. プロフィール更新
    if (data.user) {
      const interests = interestsRaw
        ? interestsRaw.split(",").map((s) => s.trim()).filter(Boolean)
        : [];
      const strengths = strengthsRaw
        ? strengthsRaw.split(",").map((s) => s.trim()).filter(Boolean)
        : [];

      await supabase
        .from("profiles")
        .update({ age, gender, occupation, interests, strengths })
        .eq("id", data.user.id);
    }

    router.push("/mypage");
    router.refresh();
  }

  return (
    <div className="flex flex-col flex-1 items-center justify-center min-h-screen p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="text-2xl font-bold tracking-tight">
            Con-TecT
          </Link>
          <p className="text-sm text-muted-foreground mt-2">
            会員登録
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {error && (
            <div className="p-3 text-sm text-red-600 bg-red-50 rounded-md">
              {error}
            </div>
          )}

          {/* 認証情報 */}
          <div>
            <label htmlFor="email" className="block text-sm font-medium mb-1">
              メールアドレス <span className="text-red-500">*</span>
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium mb-1">
              パスワード <span className="text-red-500">*</span>
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={8}
              className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20"
              placeholder="8文字以上の英数字"
            />
          </div>

          <hr className="my-2" />

          {/* プロフィール情報 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="age" className="block text-sm font-medium mb-1">
                年齢 <span className="text-red-500">*</span>
              </label>
              <input
                id="age"
                name="age"
                type="number"
                required
                min={1}
                max={120}
                className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20"
              />
            </div>
            <div>
              <label htmlFor="gender" className="block text-sm font-medium mb-1">
                性別 <span className="text-red-500">*</span>
              </label>
              <select
                id="gender"
                name="gender"
                required
                className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20"
              >
                <option value="">選択</option>
                <option value="male">男性</option>
                <option value="female">女性</option>
                <option value="other">その他</option>
                <option value="no_answer">回答しない</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="occupation" className="block text-sm font-medium mb-1">
              職業 <span className="text-red-500">*</span>
            </label>
            <input
              id="occupation"
              name="occupation"
              type="text"
              required
              className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20"
              placeholder="例: エンジニア"
            />
          </div>

          <div>
            <label htmlFor="interests" className="block text-sm font-medium mb-1">
              関心事 <span className="text-red-500">*</span>
            </label>
            <input
              id="interests"
              name="interests"
              type="text"
              required
              className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20"
              placeholder="カンマ区切りで入力（例: 料理, 旅行, 写真）"
            />
          </div>

          <div>
            <label htmlFor="strengths" className="block text-sm font-medium mb-1">
              得意なこと <span className="text-red-500">*</span>
            </label>
            <input
              id="strengths"
              name="strengths"
              type="text"
              required
              className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20"
              placeholder="カンマ区切りで入力（例: プログラミング, 絵を描く）"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {loading ? "登録中..." : "会員登録"}
          </button>

          <p className="text-center text-sm text-muted-foreground">
            すでにアカウントをお持ちですか？{" "}
            <Link href="/login" className="text-foreground hover:underline">
              ログイン
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
