import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { logout, updateProfile } from "@/app/auth/actions";
import type { Profile } from "@/lib/types";

export default async function MyPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single<Profile>();

  return (
    <div className="flex flex-col flex-1 min-h-screen">
      {/* ナビゲーション */}
      <nav className="flex justify-between items-center p-4 border-b border-border">
        <Link href="/" className="text-xl font-bold tracking-tight">
          Con-TecT
        </Link>
        <form action={logout}>
          <button
            type="submit"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            ログアウト
          </button>
        </form>
      </nav>

      <main className="flex-1 max-w-2xl mx-auto w-full p-6">
        <h2 className="text-xl font-semibold mb-6">マイページ</h2>

        <form action={updateProfile} className="flex flex-col gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              メールアドレス
            </label>
            <input
              type="email"
              value={profile?.email ?? ""}
              disabled
              className="w-full px-3 py-2 border border-input rounded-md bg-muted text-muted-foreground"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="age" className="block text-sm font-medium mb-1">
                年齢
              </label>
              <input
                id="age"
                name="age"
                type="number"
                defaultValue={profile?.age ?? ""}
                min={1}
                max={120}
                className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20"
              />
            </div>
            <div>
              <label htmlFor="gender" className="block text-sm font-medium mb-1">
                性別
              </label>
              <select
                id="gender"
                name="gender"
                defaultValue={profile?.gender ?? ""}
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
              職業
            </label>
            <input
              id="occupation"
              name="occupation"
              type="text"
              defaultValue={profile?.occupation ?? ""}
              className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20"
            />
          </div>

          <div>
            <label htmlFor="interests" className="block text-sm font-medium mb-1">
              関心事
            </label>
            <input
              id="interests"
              name="interests"
              type="text"
              defaultValue={profile?.interests?.join(", ") ?? ""}
              className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20"
              placeholder="カンマ区切りで入力"
            />
          </div>

          <div>
            <label htmlFor="strengths" className="block text-sm font-medium mb-1">
              得意なこと
            </label>
            <input
              id="strengths"
              name="strengths"
              type="text"
              defaultValue={profile?.strengths?.join(", ") ?? ""}
              className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20"
              placeholder="カンマ区切りで入力"
            />
          </div>

          <button
            type="submit"
            className="w-full py-2.5 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity"
          >
            プロフィールを更新
          </button>
        </form>
      </main>
    </div>
  );
}
