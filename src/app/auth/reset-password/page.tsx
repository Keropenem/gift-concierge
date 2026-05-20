"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      setHasSession(!!data.session);
      setAuthChecked(true);
    })();
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const password = formData.get("password") as string;
    const confirm = formData.get("confirm") as string;

    if (password !== confirm) {
      setError("パスワードが一致しません");
      setLoading(false);
      return;
    }
    if (password.length < 8) {
      setError("パスワードは8文字以上にしてください");
      setLoading(false);
      return;
    }

    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setError(updateError.message);
      setLoading(false);
      return;
    }

    setDone(true);
    setLoading(false);
    setTimeout(() => router.push("/"), 2000);
  }

  if (!authChecked) {
    return (
      <div className="flex items-center justify-center h-screen text-muted-foreground">
        読み込み中...
      </div>
    );
  }

  if (!hasSession) {
    return (
      <div className="flex flex-col flex-1 items-center justify-center min-h-screen p-4">
        <div className="w-full max-w-md text-center">
          <Link href="/" className="text-2xl font-bold tracking-tight">
            ENN
          </Link>
          <p className="text-sm text-muted-foreground mt-4 mb-6">
            リセットリンクが無効、または有効期限が切れています。
          </p>
          <Link
            href="/auth/forgot-password"
            className="inline-block px-6 py-2.5 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity"
          >
            もう一度送信する
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 items-center justify-center min-h-screen p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="text-2xl font-bold tracking-tight">
            ENN
          </Link>
          <p className="text-sm text-muted-foreground mt-2">新しいパスワードを設定</p>
        </div>

        {done ? (
          <div className="p-4 text-sm text-green-700 bg-green-50 rounded-md text-center">
            パスワードを更新しました。ホームへ移動します...
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {error && (
              <div className="p-3 text-sm text-red-600 bg-red-50 rounded-md">{error}</div>
            )}

            <div>
              <label htmlFor="password" className="block text-sm font-medium mb-1">
                新しいパスワード
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                minLength={8}
                className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20"
                placeholder="8文字以上"
              />
            </div>

            <div>
              <label htmlFor="confirm" className="block text-sm font-medium mb-1">
                確認のため再入力
              </label>
              <input
                id="confirm"
                name="confirm"
                type="password"
                required
                minLength={8}
                className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {loading ? "更新中..." : "パスワードを更新"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
