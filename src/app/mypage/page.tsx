"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/modal";
import { createClient } from "@/lib/supabase/client";
import type { Profile, Recipient, Memory, RecipientNote, Proposal } from "@/lib/types";

const genderLabel: Record<string, string> = {
  male: "男性",
  female: "女性",
  other: "その他",
  no_answer: "回答しない",
};

export default function MyPage() {
  const router = useRouter();
  const supabase = createClient();

  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal states
  const [memoryModalOpen, setMemoryModalOpen] = useState(false);
  const [recipientModalOpen, setRecipientModalOpen] = useState(false);
  const [recipientDetailId, setRecipientDetailId] = useState<string | null>(null);
  const [recipientNotesModalOpen, setRecipientNotesModalOpen] = useState(false);
  const [recipientProposalsModalOpen, setRecipientProposalsModalOpen] = useState(false);
  const [recipientNotes, setRecipientNotes] = useState<RecipientNote[]>([]);
  const [recipientProposals, setRecipientProposals] = useState<Proposal[]>([]);

  // Profile form state
  const [profileForm, setProfileForm] = useState({ name: "", age: "", gender: "", occupation: "", interests: "" });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState("");

  // Memory add
  const [newMemory, setNewMemory] = useState("");

  // Recipient detail form
  const [recipientForm, setRecipientForm] = useState({ nickname: "", relationship: "", age: "", gender: "", occupation: "", interests: "" });
  const [recipientSaving, setRecipientSaving] = useState(false);

  // --- データ取得 ---
  const fetchAll = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }
    setUserId(user.id);

    const [pRes, rRes, mRes] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).single<Profile>(),
      supabase.from("recipients").select("*").eq("user_id", user.id).order("updated_at", { ascending: false }).returns<Recipient[]>(),
      supabase.from("memories").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).returns<Memory[]>(),
    ]);

    if (pRes.data) {
      setProfile(pRes.data);
      setProfileForm({
        name: pRes.data.name ?? "",
        age: String(pRes.data.age ?? ""),
        gender: pRes.data.gender ?? "",
        occupation: pRes.data.occupation ?? "",
        interests: pRes.data.interests?.join(", ") ?? "",
      });
    }
    setRecipients(rRes.data ?? []);
    setMemories(mRes.data ?? []);
    setLoading(false);
  }, [supabase, router]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // --- プロフィール保存 ---
  const handleProfileSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) return;
    setProfileSaving(true);
    setProfileMsg("");
    const updates: Record<string, unknown> = {};
    updates.name = profileForm.name || null;
    if (profileForm.age) updates.age = Number(profileForm.age);
    else updates.age = null;
    updates.gender = profileForm.gender || null;
    updates.occupation = profileForm.occupation || null;
    updates.interests = profileForm.interests ? profileForm.interests.split(",").map(s => s.trim()).filter(Boolean) : [];

    const { error } = await supabase.from("profiles").update(updates).eq("id", userId);
    setProfileSaving(false);
    setProfileMsg(error ? "保存に失敗しました" : "保存しました");
    if (!error) setTimeout(() => setProfileMsg(""), 2000);
  };

  // --- メモリ CRUD ---
  const handleAddMemory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || !newMemory.trim()) return;
    const { data, error } = await supabase.from("memories").insert({ user_id: userId, content: newMemory.trim(), source: "user" }).select().single<Memory>();
    if (!error && data) {
      setMemories(prev => [data, ...prev]);
      setNewMemory("");
    }
  };

  const handleUpdateMemory = async (id: string, content: string) => {
    const { error } = await supabase.from("memories").update({ content }).eq("id", id);
    if (!error) setMemories(prev => prev.map(m => m.id === id ? { ...m, content } : m));
  };

  const handleDeleteMemory = async (id: string) => {
    const { error } = await supabase.from("memories").delete().eq("id", id);
    if (!error) setMemories(prev => prev.filter(m => m.id !== id));
  };

  // --- 受け手詳細モーダル ---
  const openRecipientDetail = async (recipientId: string) => {
    setRecipientDetailId(recipientId);
    const r = recipients.find(x => x.id === recipientId);
    if (r) {
      setRecipientForm({
        nickname: r.nickname,
        relationship: r.relationship ?? "",
        age: String(r.age ?? ""),
        gender: r.gender ?? "",
        occupation: r.occupation ?? "",
        interests: r.interests?.join(", ") ?? "",
      });
    }
    // ノートと提案履歴を取得
    const [notesRes, proposalsRes] = await Promise.all([
      supabase.from("recipient_notes").select("*").eq("recipient_id", recipientId).order("created_at", { ascending: false }).returns<RecipientNote[]>(),
      supabase.from("proposals").select("*").eq("recipient_id", recipientId).order("created_at", { ascending: false }).returns<Proposal[]>(),
    ]);
    setRecipientNotes(notesRes.data ?? []);
    setRecipientProposals(proposalsRes.data ?? []);
  };

  const handleUpdateRecipient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recipientDetailId) return;
    setRecipientSaving(true);
    const updates: Record<string, unknown> = {
      nickname: recipientForm.nickname,
      relationship: recipientForm.relationship || null,
      age: recipientForm.age ? Number(recipientForm.age) : null,
      gender: recipientForm.gender || null,
      occupation: recipientForm.occupation || null,
      interests: recipientForm.interests ? recipientForm.interests.split(",").map(s => s.trim()).filter(Boolean) : [],
    };
    const { error } = await supabase.from("recipients").update(updates).eq("id", recipientDetailId);
    setRecipientSaving(false);
    if (!error) {
      setRecipients(prev => prev.map(r => r.id === recipientDetailId ? { ...r, ...updates } as Recipient : r));
    }
  };

  const handleDeleteRecipient = async (id: string) => {
    if (!confirm("この相手を削除しますか？")) return;
    const { error } = await supabase.from("recipients").delete().eq("id", id);
    if (!error) {
      setRecipients(prev => prev.filter(r => r.id !== id));
      setRecipientDetailId(null);
    }
  };

  // --- ログアウト ---
  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <span className="text-muted-foreground">読み込み中...</span>
      </div>
    );
  }

  const selectedRecipient = recipients.find(r => r.id === recipientDetailId);

  return (
    <div className="flex flex-col flex-1 min-h-screen">
      {/* ナビゲーション */}
      <nav className="flex justify-between items-center p-4 border-b border-border">
        <Link href="/" className="text-xl font-bold tracking-tight">Con-TecT</Link>
        <div className="flex items-center gap-4">
          <Link href="/chat" className="text-sm text-muted-foreground hover:text-foreground transition-colors">チャット</Link>
          <button onClick={handleLogout} className="text-sm text-muted-foreground hover:text-foreground transition-colors">ログアウト</button>
        </div>
      </nav>

      <main className="flex-1 max-w-2xl mx-auto w-full p-6 space-y-10">
        {/* プロフィール */}
        <section>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-lg font-semibold">あなたのプロフィール</h2>
            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">AIが自動更新</span>
          </div>
          <p className="text-xs text-muted-foreground mb-4">チャットで話した内容からAIが自動的に更新します。ここで手動で修正もできます。</p>

          <form onSubmit={handleProfileSave} className="flex flex-col gap-3">
            <div className="text-xs text-muted-foreground">{profile?.email}</div>

            <div>
              <label htmlFor="name" className="block text-xs font-medium mb-1 text-muted-foreground">お名前</label>
              <input id="name" type="text" value={profileForm.name} onChange={e => setProfileForm(p => ({ ...p, name: e.target.value }))} placeholder="表示名を入力" className="w-full px-3 py-2 text-sm border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="age" className="block text-xs font-medium mb-1 text-muted-foreground">年齢</label>
                <input id="age" type="number" value={profileForm.age} onChange={e => setProfileForm(p => ({ ...p, age: e.target.value }))} min={1} max={120} className="w-full px-3 py-2 text-sm border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20" />
              </div>
              <div>
                <label htmlFor="gender" className="block text-xs font-medium mb-1 text-muted-foreground">性別</label>
                <select id="gender" value={profileForm.gender} onChange={e => setProfileForm(p => ({ ...p, gender: e.target.value }))} className="w-full px-3 py-2 text-sm border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20">
                  <option value="">未設定</option>
                  <option value="male">男性</option>
                  <option value="female">女性</option>
                  <option value="other">その他</option>
                  <option value="no_answer">回答しない</option>
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="occupation" className="block text-xs font-medium mb-1 text-muted-foreground">職業</label>
              <input id="occupation" type="text" value={profileForm.occupation} onChange={e => setProfileForm(p => ({ ...p, occupation: e.target.value }))} className="w-full px-3 py-2 text-sm border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20" />
            </div>

            <div>
              <label htmlFor="interests" className="block text-xs font-medium mb-1 text-muted-foreground">関心事</label>
              <input id="interests" type="text" value={profileForm.interests} onChange={e => setProfileForm(p => ({ ...p, interests: e.target.value }))} className="w-full px-3 py-2 text-sm border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20" placeholder="カンマ区切りで入力" />
            </div>

            <button type="submit" disabled={profileSaving} className="w-full py-2 text-sm bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity disabled:opacity-50">
              {profileSaving ? "保存中..." : "保存"}
            </button>
            {profileMsg && <p className="text-xs text-center text-muted-foreground">{profileMsg}</p>}
          </form>
        </section>

        {/* クイックリンク行 */}
        <section className="flex gap-4">
          <button onClick={() => setMemoryModalOpen(true)} className="flex-1 py-3 px-4 text-sm font-medium border border-border rounded-lg hover:bg-muted/50 transition-colors text-left">
            <span className="block text-base font-semibold">メモリ</span>
            <span className="text-xs text-muted-foreground">{memories.length}件</span>
          </button>
          <button onClick={() => setRecipientModalOpen(true)} className="flex-1 py-3 px-4 text-sm font-medium border border-border rounded-lg hover:bg-muted/50 transition-colors text-left">
            <span className="block text-base font-semibold">贈った相手</span>
            <span className="text-xs text-muted-foreground">{recipients.length}人</span>
          </button>
        </section>
      </main>

      {/* メモリモーダル */}
      <Modal open={memoryModalOpen} onClose={() => setMemoryModalOpen(false)} title={`メモリ (${memories.length}件)`}>
        <p className="text-xs text-muted-foreground mb-4">AIとの会話から自動的に記録された情報です。編集・削除したり、自分で追加もできます。</p>

        <form onSubmit={handleAddMemory} className="flex gap-2 mb-4">
          <input type="text" value={newMemory} onChange={e => setNewMemory(e.target.value)} placeholder="自分で情報を追加...（例: 和食より洋食が好き）" className="flex-1 px-3 py-2 text-sm border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20" />
          <button type="submit" className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity shrink-0">追加</button>
        </form>

        {memories.length === 0 ? (
          <div className="text-center py-6 text-sm text-muted-foreground border border-dashed border-border rounded-lg">
            まだメモリがありません。<br />チャットで相談すると、AIが自動的に情報を記録します。
          </div>
        ) : (
          <div className="space-y-2">
            {memories.map(m => (
              <MemoryRow key={m.id} memory={m} onUpdate={handleUpdateMemory} onDelete={handleDeleteMemory} />
            ))}
          </div>
        )}
      </Modal>

      {/* 受け手一覧モーダル */}
      <Modal open={recipientModalOpen && !recipientDetailId} onClose={() => setRecipientModalOpen(false)} title={`贈った相手 (${recipients.length}人)`}>
        <p className="text-xs text-muted-foreground mb-4">チャットで教えた相手の情報が自動保存されます。クリックで詳細を表示。</p>

        {recipients.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground border border-dashed border-border rounded-lg">
            まだ相手の情報がありません。<br />
            <Link href="/chat" className="text-foreground underline mt-1 inline-block">チャットで相談する</Link>と自動的に保存されます。
          </div>
        ) : (
          <div className="space-y-2">
            {recipients.map(r => (
              <button key={r.id} onClick={() => openRecipientDetail(r.id)} className="w-full text-left p-4 border border-border rounded-lg hover:bg-muted/50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="font-medium">{r.nickname}</span>
                    {r.relationship && <span className="text-xs text-muted-foreground">{r.relationship}</span>}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {r.age && <span>{r.age}歳</span>}
                    {r.gender && <span>{genderLabel[r.gender] ?? r.gender}</span>}
                    {r.occupation && <span>{r.occupation}</span>}
                  </div>
                </div>
                {r.interests && r.interests.length > 0 && (
                  <div className="mt-1 text-xs text-muted-foreground truncate">関心: {r.interests.join(", ")}</div>
                )}
              </button>
            ))}
          </div>
        )}
      </Modal>

      {/* 受け手詳細モーダル — 基本情報 + ボタン */}
      <Modal open={!!recipientDetailId && !recipientNotesModalOpen && !recipientProposalsModalOpen} onClose={() => setRecipientDetailId(null)} title={selectedRecipient?.nickname ?? "詳細"}>
        {selectedRecipient && (
          <div className="space-y-4">
            <form onSubmit={handleUpdateRecipient} className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1 text-muted-foreground">呼び名</label>
                  <input type="text" value={recipientForm.nickname} onChange={e => setRecipientForm(f => ({ ...f, nickname: e.target.value }))} required className="w-full px-3 py-1.5 text-sm border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1 text-muted-foreground">関係性</label>
                  <input type="text" value={recipientForm.relationship} onChange={e => setRecipientForm(f => ({ ...f, relationship: e.target.value }))} className="w-full px-3 py-1.5 text-sm border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1 text-muted-foreground">年齢</label>
                  <input type="number" value={recipientForm.age} onChange={e => setRecipientForm(f => ({ ...f, age: e.target.value }))} min={1} max={120} className="w-full px-3 py-1.5 text-sm border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1 text-muted-foreground">性別</label>
                  <select value={recipientForm.gender} onChange={e => setRecipientForm(f => ({ ...f, gender: e.target.value }))} className="w-full px-3 py-1.5 text-sm border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20">
                    <option value="">未設定</option>
                    <option value="male">男性</option>
                    <option value="female">女性</option>
                    <option value="other">その他</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1 text-muted-foreground">職業</label>
                <input type="text" value={recipientForm.occupation} onChange={e => setRecipientForm(f => ({ ...f, occupation: e.target.value }))} className="w-full px-3 py-1.5 text-sm border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1 text-muted-foreground">関心事</label>
                <input type="text" value={recipientForm.interests} onChange={e => setRecipientForm(f => ({ ...f, interests: e.target.value }))} className="w-full px-3 py-1.5 text-sm border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20" placeholder="カンマ区切り" />
              </div>
              <button type="submit" disabled={recipientSaving} className="w-full py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity disabled:opacity-50">
                {recipientSaving ? "更新中..." : "更新"}
              </button>
            </form>

            {/* サブモーダルへのボタン */}
            <div className="flex gap-2">
              <button
                onClick={() => setRecipientNotesModalOpen(true)}
                className="flex-1 py-2.5 text-sm border border-border rounded-md hover:bg-muted transition-colors"
              >
                AIの記録 ({recipientNotes.length}件)
              </button>
              <button
                onClick={() => setRecipientProposalsModalOpen(true)}
                className="flex-1 py-2.5 text-sm border border-border rounded-md hover:bg-muted transition-colors"
              >
                提案履歴 ({recipientProposals.length}件)
              </button>
            </div>

            <button onClick={() => handleDeleteRecipient(selectedRecipient.id)} className="w-full py-1.5 text-sm text-red-600 border border-red-200 rounded-md hover:bg-red-50 transition-colors">
              この相手を削除
            </button>
          </div>
        )}
      </Modal>

      {/* 受け手 AIメモ モーダル */}
      <Modal open={recipientNotesModalOpen} onClose={() => setRecipientNotesModalOpen(false)} title={`${selectedRecipient?.nickname ?? ""} — AIの記録`}>
        {recipientNotes.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">まだ記録がありません。チャットで相談するとAIが自動的に記録します。</p>
        ) : (
          <div className="space-y-2">
            {recipientNotes.map(note => (
              <div key={note.id} className="flex items-start gap-2 text-sm px-3 py-2 bg-muted/30 rounded-md">
                <span className="text-muted-foreground mt-0.5">&#8226;</span>
                <div className="flex-1">
                  <span>{note.content}</span>
                  <span className="text-[10px] text-muted-foreground ml-2">{new Date(note.created_at).toLocaleDateString("ja-JP")}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* 受け手 提案履歴 モーダル */}
      <Modal open={recipientProposalsModalOpen} onClose={() => setRecipientProposalsModalOpen(false)} title={`${selectedRecipient?.nickname ?? ""} — 提案履歴`}>
        {recipientProposals.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">まだ提案がありません。</p>
        ) : (
          <div className="space-y-3">
            {recipientProposals.map(p => (
              <div key={p.id} className="p-4 border border-border rounded-lg text-sm">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium">{p.product_name}</span>
                  {p.product_price && <span className="text-xs text-muted-foreground">{p.product_price}</span>}
                </div>
                {p.product_description && <p className="text-xs text-muted-foreground mb-1">{p.product_description}</p>}
                {p.narrative && <p className="text-xs text-muted-foreground italic mb-2">{p.narrative}</p>}
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  {p.maker_name && <span>{p.maker_name}</span>}
                  {p.occasion && <span>/ {p.occasion}</span>}
                  <span>{new Date(p.created_at).toLocaleDateString("ja-JP")}</span>
                </div>
                {p.product_url && (
                  <a href={p.product_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline mt-1 inline-block">商品リンク</a>
                )}
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}

// メモリ行コンポーネント（インライン編集）
function MemoryRow({ memory, onUpdate, onDelete }: { memory: Memory; onUpdate: (id: string, content: string) => void; onDelete: (id: string) => void }) {
  const [value, setValue] = useState(memory.content);

  return (
    <div className="group flex items-start gap-2 p-3 border border-border rounded-lg hover:bg-muted/30 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-2">
          <input type="text" value={value} onChange={e => setValue(e.target.value)} className="flex-1 px-2 py-1 text-sm bg-transparent border-0 border-b border-transparent hover:border-input focus:border-input focus:outline-none transition-colors" />
          <button onClick={() => onUpdate(memory.id, value)} className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity">保存</button>
        </div>
        <div className="flex items-center gap-2 mt-1 px-2">
          <span className="text-[10px] text-muted-foreground">{memory.source === "ai" ? "AI" : "手動"}</span>
          <span className="text-[10px] text-muted-foreground">{new Date(memory.created_at).toLocaleDateString("ja-JP")}</span>
        </div>
      </div>
      <button onClick={() => onDelete(memory.id)} className="p-1 text-muted-foreground hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all" title="削除">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 6 6 18" /><path d="m6 6 12 12" />
        </svg>
      </button>
    </div>
  );
}
