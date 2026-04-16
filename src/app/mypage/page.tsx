import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { logout, updateProfile, deleteRecipient, updateRecipient, deleteMemory, updateMemory, addMemory } from "@/app/auth/actions";
import type { Profile, Recipient, Memory } from "@/lib/types";

const genderLabel: Record<string, string> = {
  male: "男性",
  female: "女性",
  other: "その他",
  no_answer: "回答しない",
};

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

  const { data: recipients } = await supabase
    .from("recipients")
    .select("*")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .returns<Recipient[]>();

  const { data: memories } = await supabase
    .from("memories")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .returns<Memory[]>();

  return (
    <div className="flex flex-col flex-1 min-h-screen">
      <nav className="flex justify-between items-center p-4 border-b border-border">
        <Link href="/" className="text-xl font-bold tracking-tight">
          Con-TecT
        </Link>
        <div className="flex items-center gap-4">
          <Link
            href="/chat"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            チャット
          </Link>
          <form action={logout}>
            <button
              type="submit"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              ログアウト
            </button>
          </form>
        </div>
      </nav>

      <main className="flex-1 max-w-2xl mx-auto w-full p-6 space-y-10">
        {/* あなたのプロフィール */}
        <section>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-lg font-semibold">あなたのプロフィール</h2>
            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
              AIが自動更新
            </span>
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            チャットで話した内容からAIが自動的に更新します。ここで手動で修正もできます。
          </p>

          <form action={updateProfile} className="flex flex-col gap-3">
            <div className="text-xs text-muted-foreground">
              {profile?.email}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="age" className="block text-xs font-medium mb-1 text-muted-foreground">
                  年齢
                </label>
                <input
                  id="age"
                  name="age"
                  type="number"
                  defaultValue={profile?.age ?? ""}
                  min={1}
                  max={120}
                  className="w-full px-3 py-2 text-sm border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20"
                />
              </div>
              <div>
                <label htmlFor="gender" className="block text-xs font-medium mb-1 text-muted-foreground">
                  性別
                </label>
                <select
                  id="gender"
                  name="gender"
                  defaultValue={profile?.gender ?? ""}
                  className="w-full px-3 py-2 text-sm border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20"
                >
                  <option value="">未設定</option>
                  <option value="male">男性</option>
                  <option value="female">女性</option>
                  <option value="other">その他</option>
                  <option value="no_answer">回答しない</option>
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="occupation" className="block text-xs font-medium mb-1 text-muted-foreground">
                職業
              </label>
              <input
                id="occupation"
                name="occupation"
                type="text"
                defaultValue={profile?.occupation ?? ""}
                className="w-full px-3 py-2 text-sm border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20"
              />
            </div>

            <div>
              <label htmlFor="interests" className="block text-xs font-medium mb-1 text-muted-foreground">
                関心事
              </label>
              <input
                id="interests"
                name="interests"
                type="text"
                defaultValue={profile?.interests?.join(", ") ?? ""}
                className="w-full px-3 py-2 text-sm border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20"
                placeholder="カンマ区切りで入力"
              />
            </div>

            <div>
              <label htmlFor="strengths" className="block text-xs font-medium mb-1 text-muted-foreground">
                得意なこと
              </label>
              <input
                id="strengths"
                name="strengths"
                type="text"
                defaultValue={profile?.strengths?.join(", ") ?? ""}
                className="w-full px-3 py-2 text-sm border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20"
                placeholder="カンマ区切りで入力"
              />
            </div>

            <button
              type="submit"
              className="w-full py-2 text-sm bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity"
            >
              保存
            </button>
          </form>
        </section>

        {/* メモリ（AIが学んだこと） */}
        <section>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-lg font-semibold">メモリ</h2>
            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
              {memories?.length ?? 0}件
            </span>
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            AIとの会話から自動的に記録された情報です。編集・削除したり、自分で追加もできます。
          </p>

          {/* 新規追加 */}
          <form action={addMemory} className="flex gap-2 mb-4">
            <input
              name="content"
              type="text"
              placeholder="自分で情報を追加...（例: 和食より洋食が好き）"
              className="flex-1 px-3 py-2 text-sm border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20"
            />
            <button
              type="submit"
              className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity shrink-0"
            >
              追加
            </button>
          </form>

          {(!memories || memories.length === 0) ? (
            <div className="text-center py-6 text-sm text-muted-foreground border border-dashed border-border rounded-lg">
              まだメモリがありません。
              <br />
              チャットで相談すると、AIが自動的に情報を記録します。
            </div>
          ) : (
            <div className="space-y-2">
              {memories.map((m) => (
                <div
                  key={m.id}
                  className="group flex items-start gap-2 p-3 border border-border rounded-lg hover:bg-muted/30 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <form action={updateMemory} className="flex items-start gap-2">
                      <input type="hidden" name="memoryId" value={m.id} />
                      <input
                        name="content"
                        type="text"
                        defaultValue={m.content}
                        className="flex-1 px-2 py-1 text-sm bg-transparent border-0 border-b border-transparent hover:border-input focus:border-input focus:outline-none transition-colors"
                      />
                      <button
                        type="submit"
                        className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        保存
                      </button>
                    </form>
                    <div className="flex items-center gap-2 mt-1 px-2">
                      <span className="text-[10px] text-muted-foreground">
                        {m.source === "ai" ? "AI" : "手動"}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(m.created_at).toLocaleDateString("ja-JP")}
                      </span>
                    </div>
                  </div>
                  <form action={deleteMemory}>
                    <input type="hidden" name="memoryId" value={m.id} />
                    <button
                      type="submit"
                      className="p-1 text-muted-foreground hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                      title="削除"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                      </svg>
                    </button>
                  </form>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 贈った相手リスト */}
        <section>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-lg font-semibold">贈った相手</h2>
            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
              {recipients?.length ?? 0}人
            </span>
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            チャットで教えた相手の情報が自動保存されます。次回は入力不要で相談できます。
          </p>

          {(!recipients || recipients.length === 0) ? (
            <div className="text-center py-8 text-sm text-muted-foreground border border-dashed border-border rounded-lg">
              まだ相手の情報がありません。
              <br />
              <Link href="/chat" className="text-foreground underline mt-1 inline-block">
                チャットで相談する
              </Link>
              と自動的に保存されます。
            </div>
          ) : (
            <div className="space-y-4">
              {recipients.map((r) => (
                <details
                  key={r.id}
                  className="border border-border rounded-lg group"
                >
                  <summary className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors rounded-lg text-sm">
                    <div className="flex items-center gap-3">
                      <span className="font-medium">{r.nickname}</span>
                      {r.relationship && (
                        <span className="text-xs text-muted-foreground">
                          {r.relationship}
                        </span>
                      )}
                      {r.occupation && (
                        <span className="text-xs text-muted-foreground">
                          / {r.occupation}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {r.age && (
                        <span className="text-xs text-muted-foreground">
                          {r.age}歳
                        </span>
                      )}
                      {r.gender && (
                        <span className="text-xs text-muted-foreground">
                          {genderLabel[r.gender] ?? r.gender}
                        </span>
                      )}
                    </div>
                  </summary>

                  <div className="px-4 pb-4 pt-2 border-t border-border">
                    <form action={updateRecipient} className="flex flex-col gap-3">
                      <input type="hidden" name="recipientId" value={r.id} />

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium mb-1 text-muted-foreground">
                            呼び名
                          </label>
                          <input
                            name="nickname"
                            type="text"
                            defaultValue={r.nickname}
                            required
                            className="w-full px-3 py-1.5 text-sm border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium mb-1 text-muted-foreground">
                            関係性
                          </label>
                          <input
                            name="relationship"
                            type="text"
                            defaultValue={r.relationship ?? ""}
                            className="w-full px-3 py-1.5 text-sm border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium mb-1 text-muted-foreground">
                            年齢
                          </label>
                          <input
                            name="age"
                            type="number"
                            defaultValue={r.age ?? ""}
                            min={1}
                            max={120}
                            className="w-full px-3 py-1.5 text-sm border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium mb-1 text-muted-foreground">
                            性別
                          </label>
                          <select
                            name="gender"
                            defaultValue={r.gender ?? ""}
                            className="w-full px-3 py-1.5 text-sm border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20"
                          >
                            <option value="">未設定</option>
                            <option value="male">男性</option>
                            <option value="female">女性</option>
                            <option value="other">その他</option>
                          </select>
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-medium mb-1 text-muted-foreground">
                          職業
                        </label>
                        <input
                          name="occupation"
                          type="text"
                          defaultValue={r.occupation ?? ""}
                          className="w-full px-3 py-1.5 text-sm border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium mb-1 text-muted-foreground">
                          関心事
                        </label>
                        <input
                          name="interests"
                          type="text"
                          defaultValue={r.interests?.join(", ") ?? ""}
                          className="w-full px-3 py-1.5 text-sm border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20"
                          placeholder="カンマ区切りで入力"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium mb-1 text-muted-foreground">
                          得意なこと
                        </label>
                        <input
                          name="strengths"
                          type="text"
                          defaultValue={r.strengths?.join(", ") ?? ""}
                          className="w-full px-3 py-1.5 text-sm border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20"
                          placeholder="カンマ区切りで入力"
                        />
                      </div>

                      <div className="flex gap-2">
                        <button
                          type="submit"
                          className="flex-1 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity"
                        >
                          更新
                        </button>
                      </div>
                    </form>

                    <form action={deleteRecipient} className="mt-2">
                      <input type="hidden" name="recipientId" value={r.id} />
                      <button
                        type="submit"
                        className="w-full py-1.5 text-sm text-red-600 border border-red-200 rounded-md hover:bg-red-50 transition-colors"
                      >
                        この相手を削除
                      </button>
                    </form>
                  </div>
                </details>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
