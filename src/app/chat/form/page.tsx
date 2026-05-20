"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Profile, Recipient } from "@/lib/types";

// フォーム式版（#11対応・AB用）: 対話で1問ずつ聞く代わりに、Step 1-3をまとめてフォーム入力
export default function ChatFormPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [selectedRecipientId, setSelectedRecipientId] = useState<string>("");

  // Step 1: 自分の基本情報（ログイン済みなら初期値あり）
  const [senderAge, setSenderAge] = useState("");
  const [senderGender, setSenderGender] = useState("");
  const [senderOccupation, setSenderOccupation] = useState("");
  const [senderInterests, setSenderInterests] = useState("");

  // Step 2: 相手の基本情報
  const [targetNickname, setTargetNickname] = useState("");
  const [targetRelationship, setTargetRelationship] = useState("");
  const [targetAge, setTargetAge] = useState("");
  const [targetGender, setTargetGender] = useState("");
  const [targetOccupation, setTargetOccupation] = useState("");
  const [targetInterests, setTargetInterests] = useState("");
  const [occasion, setOccasion] = useState("");
  const [budget, setBudget] = useState("");

  // Step 3: 関係性キーワード（5つ）
  const [ctx1, setCtx1] = useState("");
  const [ctx2, setCtx2] = useState("");
  const [ctx3, setCtx3] = useState("");
  const [ctx4, setCtx4] = useState("");
  const [ctx5, setCtx5] = useState("");

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      const { data: p } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();
      if (p) {
        setProfile(p);
        if (p.age) setSenderAge(String(p.age));
        if (p.gender) setSenderGender(p.gender);
        if (p.occupation) setSenderOccupation(p.occupation);
        if (p.interests) setSenderInterests((p.interests as string[]).join(", "));
      }

      const { data: rs } = await supabase
        .from("recipients")
        .select("*")
        .eq("user_id", user.id)
        .is("canonical_recipient_id", null)
        .order("updated_at", { ascending: false });
      if (rs) setRecipients(rs);

      setLoading(false);
    })();
  }, []);

  function applyRecipientToForm(recipientId: string) {
    setSelectedRecipientId(recipientId);
    if (!recipientId) {
      setTargetNickname("");
      setTargetRelationship("");
      setTargetAge("");
      setTargetGender("");
      setTargetOccupation("");
      setTargetInterests("");
      return;
    }
    const r = recipients.find((x) => x.id === recipientId);
    if (!r) return;
    setTargetNickname(r.nickname || "");
    setTargetRelationship(r.relationship || "");
    setTargetAge(r.age ? String(r.age) : "");
    setTargetGender(r.gender || "");
    setTargetOccupation(r.occupation || "");
    setTargetInterests((r.interests || []).join(", "));
  }

  function buildInitialMessage(): string {
    const lines: string[] = [];
    lines.push("以下の情報を踏まえてギフトを提案してください。");
    lines.push("");
    lines.push("【私について（贈り手）】");
    if (senderAge) lines.push(`- 年齢: ${senderAge}歳`);
    if (senderGender)
      lines.push(
        `- 性別: ${senderGender === "male" ? "男性" : senderGender === "female" ? "女性" : senderGender}`
      );
    if (senderOccupation) lines.push(`- 職業: ${senderOccupation}`);
    if (senderInterests) lines.push(`- 趣味・関心: ${senderInterests}`);
    lines.push("");
    lines.push("【相手について】");
    if (targetNickname) lines.push(`- 呼び名: ${targetNickname}`);
    if (targetRelationship) lines.push(`- 関係性: ${targetRelationship}`);
    if (targetAge) lines.push(`- 年齢: ${targetAge}歳`);
    if (targetGender)
      lines.push(
        `- 性別: ${targetGender === "male" ? "男性" : targetGender === "female" ? "女性" : targetGender}`
      );
    if (targetOccupation) lines.push(`- 職業: ${targetOccupation}`);
    if (targetInterests) lines.push(`- 趣味・関心: ${targetInterests}`);
    if (occasion) lines.push(`- きっかけ: ${occasion}`);
    if (budget) lines.push(`- 予算: ${budget}`);
    lines.push("");
    lines.push("【関係性キーワード】");
    [ctx1, ctx2, ctx3, ctx4, ctx5].forEach((c, i) => {
      if (c.trim()) lines.push(`${i + 1}. ${c.trim()}`);
    });
    lines.push("");
    lines.push(
      "Step 1〜3の情報は揃っているので、追加質問は最小限にして、Step 4〜7（分析・物語・提案・演出）に進んでください。"
    );
    return lines.join("\n");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!targetNickname.trim()) {
      alert("相手の呼び名（または関係性）は必須です");
      return;
    }
    setSubmitting(true);
    const msg = buildInitialMessage();
    router.push(`/chat?q=${encodeURIComponent(msg)}`);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen text-muted-foreground">
        読み込み中...
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen">
      <header className="flex justify-between items-center px-4 py-3 border-b border-border">
        <Link href="/" className="text-lg font-bold tracking-tight">
          ENN
        </Link>
        <div className="flex items-center gap-3">
          <Link
            href="/chat"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            対話モードに切替
          </Link>
          {profile && (
            <span className="text-xs text-muted-foreground">{profile.email}</span>
          )}
        </div>
      </header>

      <main className="flex-1 max-w-2xl mx-auto w-full p-6">
        <div className="mb-6">
          <h2 className="text-xl font-semibold">フォーム入力モード</h2>
          <p className="text-sm text-muted-foreground mt-1">
            対話で1問ずつ聞かれるのが面倒な方向け。Step 1〜3をまとめて入力できます。
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          {/* Step 1 */}
          <section className="border border-border rounded-md p-4">
            <h3 className="font-medium mb-3">Step 1: あなたについて</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">年齢</label>
                <input
                  type="number"
                  value={senderAge}
                  onChange={(e) => setSenderAge(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">性別</label>
                <select
                  value={senderGender}
                  onChange={(e) => setSenderGender(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20"
                >
                  <option value="">選択</option>
                  <option value="male">男性</option>
                  <option value="female">女性</option>
                  <option value="other">その他</option>
                </select>
              </div>
            </div>
            <div className="mt-3">
              <label className="block text-xs font-medium mb-1">職業</label>
              <input
                type="text"
                value={senderOccupation}
                onChange={(e) => setSenderOccupation(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20"
              />
            </div>
            <div className="mt-3">
              <label className="block text-xs font-medium mb-1">
                趣味・関心（カンマ区切り）
              </label>
              <input
                type="text"
                value={senderInterests}
                onChange={(e) => setSenderInterests(e.target.value)}
                placeholder="例: 旅行, 読書, ワイン"
                className="w-full px-3 py-2 text-sm border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20"
              />
            </div>
          </section>

          {/* Step 2 */}
          <section className="border border-border rounded-md p-4">
            <h3 className="font-medium mb-3">Step 2: 相手について</h3>

            {recipients.length > 0 && (
              <div className="mb-3">
                <label className="block text-xs font-medium mb-1">
                  過去に登録した相手から選ぶ
                </label>
                <select
                  value={selectedRecipientId}
                  onChange={(e) => applyRecipientToForm(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20"
                >
                  <option value="">新しい相手</option>
                  {recipients.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.nickname}
                      {r.relationship ? ` (${r.relationship})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">
                  呼び名 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={targetNickname}
                  onChange={(e) => setTargetNickname(e.target.value)}
                  required
                  placeholder="例: 母、田中さん"
                  className="w-full px-3 py-2 text-sm border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">関係性</label>
                <input
                  type="text"
                  value={targetRelationship}
                  onChange={(e) => setTargetRelationship(e.target.value)}
                  placeholder="例: 母親、上司"
                  className="w-full px-3 py-2 text-sm border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">年齢</label>
                <input
                  type="number"
                  value={targetAge}
                  onChange={(e) => setTargetAge(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">性別</label>
                <select
                  value={targetGender}
                  onChange={(e) => setTargetGender(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20"
                >
                  <option value="">選択</option>
                  <option value="male">男性</option>
                  <option value="female">女性</option>
                  <option value="other">その他</option>
                </select>
              </div>
            </div>
            <div className="mt-3">
              <label className="block text-xs font-medium mb-1">職業</label>
              <input
                type="text"
                value={targetOccupation}
                onChange={(e) => setTargetOccupation(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20"
              />
            </div>
            <div className="mt-3">
              <label className="block text-xs font-medium mb-1">
                趣味・関心（カンマ区切り）
              </label>
              <input
                type="text"
                value={targetInterests}
                onChange={(e) => setTargetInterests(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20"
              />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">
                  贈り物のきっかけ
                </label>
                <input
                  type="text"
                  value={occasion}
                  onChange={(e) => setOccasion(e.target.value)}
                  placeholder="例: 誕生日、母の日"
                  className="w-full px-3 py-2 text-sm border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">予算</label>
                <input
                  type="text"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  placeholder="例: 5,000円以内"
                  className="w-full px-3 py-2 text-sm border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20"
                />
              </div>
            </div>
          </section>

          {/* Step 3 */}
          <section className="border border-border rounded-md p-4">
            <h3 className="font-medium mb-3">Step 3: 二人の関係性を象徴するキーワード</h3>
            <p className="text-xs text-muted-foreground mb-3">
              出会いのきっかけ、思い出の体験、二人だけの内輪ネタ、共通の価値観、
              「この人らしい」と感じるところなど（5つ全部埋めなくてOK）
            </p>
            <div className="flex flex-col gap-2">
              {[
                { value: ctx1, set: setCtx1, ph: "1. 出会ったきっかけや場所" },
                { value: ctx2, set: setCtx2, ph: "2. 一緒にした思い出深い体験" },
                { value: ctx3, set: setCtx3, ph: "3. 二人だけの内輪ネタや合言葉" },
                { value: ctx4, set: setCtx4, ph: "4. 共通の好きなことや価値観" },
                { value: ctx5, set: setCtx5, ph: "5. 「この人らしいな」と感じるところ" },
              ].map((row, i) => (
                <input
                  key={i}
                  type="text"
                  value={row.value}
                  onChange={(e) => row.set(e.target.value)}
                  placeholder={row.ph}
                  className="w-full px-3 py-2 text-sm border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20"
                />
              ))}
            </div>
          </section>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {submitting ? "送信中..." : "この内容でギフトを提案してもらう"}
          </button>
        </form>
      </main>
    </div>
  );
}
