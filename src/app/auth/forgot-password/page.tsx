"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const email = formData.get("email") as string;

    const supabase = createClient();
    const redirectTo = `${window.location.origin}/auth/callback?next=/auth/reset-password`;
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });

    if (resetError) {
      setError(resetError.message);
      setLoading(false);
      return;
    }

    setSent(true);
    setLoading(false);
  }

  return (
    <div className="flex flex-col flex-1 items-center justify-center min-h-screen p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="text-2xl font-bold tracking-tight">
            ENN
          </Link>
          <p className="text-sm text-muted-foreground mt-2">パスワードをリセット</p>
        </div>

        {sent ? (
          <div className="flex flex-col gap-4">
            <div className="p-4 text-sm text-green-700 bg-green-50 rounded-md">
              リセット用のリンクをメールに送信しました。受信トレイをご確認ください。
            </div>
            <Link
              href="/login"
              className="text-center text-sm text-muted-foreground hover:underline"
            >
              ログインに戻る
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              登録済みのメールアドレスを入力してください。パスワード再設定用のリンクを送信します。
            </p>

            {error && (
              <div className="p-3 text-sm text-red-600 bg-red-50 rounded-md">{error}</div>
            )}

            <div>
              <label htmlFor="email" className="block text-sm font-medium mb-1">
                メールアドレス
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {loading ? "送信中..." : "リセットリンクを送信"}
            </button>

            <p className="text-center text-sm text-muted-foreground">
              <Link href="/login" className="text-foreground hover:underline">
                ログインに戻る
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
