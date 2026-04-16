import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // ログイン済みなら過去のセッションを取得
  let sessions: Array<{ id: string; created_at: string; preview: string; messageCount: number }> = [];
  if (user) {
    const { data } = await supabase
      .from("sessions")
      .select("id, created_at, messages")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(10);

    if (data) {
      sessions = data.map((s: { id: string; created_at: string; messages: Array<{ role: string; parts: Array<{ text: string }> }> }) => {
        const firstUserMsg = s.messages?.find((m: { role: string }) => m.role === "user");
        const preview = firstUserMsg?.parts?.[0]?.text?.substring(0, 60) || "新しい相談";
        return {
          id: s.id,
          created_at: s.created_at,
          preview,
          messageCount: s.messages?.length || 0,
        };
      });
    }
  }

  return (
    <div className="flex flex-col flex-1 items-center justify-center min-h-screen">
      {/* ナビゲーション */}
      <nav className="fixed top-0 w-full flex justify-end p-4 z-10">
        {user ? (
          <div className="flex gap-4">
            <Link
              href="/admin/prompt"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              プロンプト設定
            </Link>
            <Link
              href="/mypage"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              マイページ
            </Link>
          </div>
        ) : (
          <div className="flex gap-4">
            <Link
              href="/login"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              ログイン
            </Link>
            <Link
              href="/signup"
              className="text-sm bg-primary text-primary-foreground px-4 py-1.5 rounded-md hover:opacity-90 transition-opacity"
            >
              会員登録
            </Link>
          </div>
        )}
      </nav>

      {/* メインコンテンツ */}
      <main className="flex flex-col items-center gap-8 w-full max-w-2xl px-4">
        {/* ロゴ */}
        <div className="text-center">
          <h1 className="text-4xl font-bold tracking-tight">Con-TecT</h1>
          <p className="text-sm text-muted-foreground mt-2">
            贈り物は、二人の物語から生まれる
          </p>
        </div>

        {/* 検索窓 */}
        <form action="/chat" className="w-full">
          <div className="relative w-full">
            <input
              name="q"
              type="text"
              placeholder="誰に、どんな贈り物をしたいですか？"
              className="w-full px-6 py-4 text-base border border-border rounded-full shadow-sm hover:shadow-md focus:shadow-md focus:outline-none focus:ring-2 focus:ring-ring/20 transition-shadow"
              autoComplete="off"
            />
            <button
              type="submit"
              className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="送信"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m22 2-7 20-4-9-9-4Z" />
                <path d="M22 2 11 13" />
              </svg>
            </button>
          </div>
        </form>

        {/* 過去の相談一覧 */}
        {sessions.length > 0 && (
          <div className="w-full mt-4">
            <p className="text-xs font-medium text-muted-foreground mb-3">最近の相談</p>
            <div className="flex flex-col gap-1">
              {sessions.map((s) => (
                <Link
                  key={s.id}
                  href={`/chat?resume=${s.id}`}
                  className="flex justify-between items-center px-4 py-2.5 text-sm rounded-lg hover:bg-muted transition-colors"
                >
                  <span className="truncate flex-1 text-foreground">{s.preview}</span>
                  <span className="text-xs text-muted-foreground ml-3 shrink-0">
                    {new Date(s.created_at).toLocaleDateString("ja-JP")}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* フッター */}
      <footer className="fixed bottom-0 w-full flex justify-center gap-6 p-4 text-xs text-muted-foreground">
        <a href="#" className="hover:underline">
          利用規約
        </a>
        <a href="#" className="hover:underline">
          プライバシーポリシー
        </a>
      </footer>
    </div>
  );
}
