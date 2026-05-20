"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type HistoryEntry = {
  id: string;
  prompt: string;
  memo: string | null;
  created_at: string;
};

export default function PromptEditorPage() {
  const [prompt, setPrompt] = useState("");
  const [memo, setMemo] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    loadPrompt();
  }, []);

  async function loadPrompt() {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      setError("ログインが必要です");
      setLoading(false);
      return;
    }

    setAuthenticated(true);

    const { data, error: fetchError } = await supabase
      .from("prompt_config")
      .select("prompt")
      .eq("id", 1)
      .single();

    if (fetchError) {
      setError("プロンプトの読み込みに失敗しました: " + fetchError.message);
    } else if (data) {
      setPrompt(data.prompt);
    }

    await loadHistory();
    setLoading(false);
  }

  async function loadHistory() {
    const supabase = createClient();
    const { data } = await supabase
      .from("prompt_history")
      .select("id, prompt, memo, created_at")
      .order("created_at", { ascending: false })
      .limit(30);

    if (data) setHistory(data as HistoryEntry[]);
  }

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError(null);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    const { error: updateError } = await supabase
      .from("prompt_config")
      .update({ prompt, updated_by: user?.id })
      .eq("id", 1);

    if (updateError) {
      setError("保存に失敗しました: " + updateError.message);
      setSaving(false);
      return;
    }

    // 履歴に追加
    const { error: historyError } = await supabase.from("prompt_history").insert({
      prompt,
      memo: memo.trim() || null,
      updated_by: user?.id,
    });

    if (historyError) {
      console.error("[PROMPT] history insert failed:", historyError.message);
    } else {
      setMemo("");
      await loadHistory();
    }

    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
    setSaving(false);
  }

  function handleRestore(entry: HistoryEntry) {
    if (!confirm("この履歴の内容をエディタに復元しますか？（保存はされません）")) return;
    setPrompt(entry.prompt);
    setExpandedId(null);
  }

  async function handleReset() {
    if (!confirm("プロンプトをデフォルトに戻しますか？")) return;

    const defaultPrompt = `あなたは世界最高のギフトコンシェルジュであり、優れたストーリーテラーです。

あなたの役割は、贈り手と受け取り手の人生の文脈から「見えない共通点」を見出し、
そのストーリーに合った唯一無二のプレゼントを提案することです。

## 7ステッププロセス

以下の7つのステップを順番に実行してください:

### Step 1: Profile（自分自身の基本プロフィール）
贈り手自身について、以下を自然な会話で聞いてください:
- 年代と性別
- お仕事
- 趣味や関心があること
- 得意なこと

### Step 2: Target（相手の基本プロフィール）
贈りたい相手について、以下を聞いてください:
- 年代と性別
- お仕事
- 趣味や関心があること
- 得意なこと
- 今回の贈り物のきっかけ（誕生日、お礼など）
- 予算（必ず確認すること。ユーザーが言及していなければ聞くこと）

### Step 3: Context（関係性キーワード）
二人の関係性を象徴するキーワードを5つ定義してもらってください:
- 出会ったきっかけや場所
- 一緒にした思い出深い体験
- 二人だけの内輪ネタや合言葉
- 共通の好きなことや価値観
- 相手に対する「この人らしいな」と感じるところ

### Step 4: Analysis（自動実行）
Step 1〜3の情報から、二人の「見えない共通点」と背景にある感情を言語化してください。

### Step 5: Narrative（自動実行）
共通点を軸にした心に響く短い物語を執筆してください。

### Step 6: Proposal（自動実行）
物語を象徴する贈り物を提案してください。
- 商品名と具体的な説明
- 製造元・クリエイターの情報
- おおよその価格
- 製造元の公式ECサイトや購入可能なURLを必ず含める
- 製造元・クリエイターの公式ECを優先的に紹介する

### Step 7: Action（自動実行）
渡す際の演出と、添えるメッセージを提案してください。

## 重要ルール
- Step 1〜3は必ずユーザーへの問いかけとして1ステップずつ実行すること
- Step 4〜7はヒアリング完了後にまとめて自動実行すること
- 情報が不足している場合は追加で質問すること
- 商品検索にはWeb検索を活用し、実在する商品を提案すること
- URLは必ず実在するものを提示すること`;

    setPrompt(defaultPrompt);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen text-muted-foreground">
        読み込み中...
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <p className="text-muted-foreground">ログインが必要です</p>
        <Link href="/login" className="text-sm bg-primary text-primary-foreground px-4 py-2 rounded-md">
          ログイン
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen">
      <nav className="flex justify-between items-center p-4 border-b border-border">
        <Link href="/" className="text-xl font-bold tracking-tight">
          ENN
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/chat" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            チャット
          </Link>
          <Link href="/mypage" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            マイページ
          </Link>
        </div>
      </nav>

      <main className="flex-1 max-w-4xl mx-auto w-full p-6">
        <div className="mb-6">
          <h2 className="text-xl font-semibold">プロンプト設定</h2>
          <p className="text-sm text-muted-foreground mt-1">
            AIギフトコンシェルジュの振る舞いをカスタマイズできます。
            変更は次の新規チャットから反映されます。
          </p>
        </div>

        {/* 注意書き */}
        <div className="p-3 mb-4 text-sm bg-muted rounded-md text-muted-foreground">
          ここで編集できるのはAIの「コンシェルジュとしての指示」です。
          システムの動作に必要な制約（情報抽出・セキュリティ等）は
          自動的に追加されるため、ここには表示されません。
        </div>

        {error && (
          <div className="p-3 mb-4 text-sm text-red-600 bg-red-50 rounded-md">
            {error}
          </div>
        )}

        {saved && (
          <div className="p-3 mb-4 text-sm text-green-600 bg-green-50 rounded-md">
            保存しました。次の新規チャットから反映されます。
          </div>
        )}

        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="w-full h-[60vh] px-4 py-3 text-sm font-mono border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20 resize-y leading-relaxed"
          placeholder="プロンプトを入力..."
        />

        {/* 変更メモ（履歴に残る） */}
        <div className="mt-4">
          <label className="block text-sm font-medium mb-1">
            変更メモ（任意） — 何を狙った変更か、どんな挙動を期待したかを残しておくと履歴で振り返れます
          </label>
          <input
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="例: Step 3の質問を1つにまとめてユーザー負担を減らす"
            className="w-full px-3 py-2 text-sm border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring/20"
          />
        </div>

        <div className="flex gap-3 mt-4">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2.5 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {saving ? "保存中..." : "保存（履歴にも残す）"}
          </button>
          <button
            onClick={handleReset}
            className="px-6 py-2.5 border border-border rounded-md hover:bg-muted transition-colors text-sm"
          >
            デフォルトに戻す
          </button>
        </div>

        <div className="mt-2 text-xs text-muted-foreground">
          <p>文字数: {prompt.length}</p>
        </div>

        {/* 変更履歴一覧 */}
        <div className="mt-10">
          <h3 className="text-lg font-semibold mb-3">変更履歴</h3>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">まだ履歴がありません。</p>
          ) : (
            <div className="flex flex-col gap-2">
              {history.map((entry) => {
                const isExpanded = expandedId === entry.id;
                return (
                  <div
                    key={entry.id}
                    className="border border-border rounded-md p-3 text-sm"
                  >
                    <div className="flex justify-between items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-muted-foreground">
                          {new Date(entry.created_at).toLocaleString("ja-JP")}
                        </div>
                        {entry.memo && (
                          <div className="mt-1 text-foreground">{entry.memo}</div>
                        )}
                        {!entry.memo && (
                          <div className="mt-1 text-muted-foreground italic">
                            （メモなし）
                          </div>
                        )}
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                          className="text-xs text-muted-foreground hover:underline"
                        >
                          {isExpanded ? "閉じる" : "本文を表示"}
                        </button>
                        <button
                          onClick={() => handleRestore(entry)}
                          className="text-xs text-muted-foreground hover:underline"
                        >
                          エディタに復元
                        </button>
                      </div>
                    </div>
                    {isExpanded && (
                      <pre className="mt-3 p-3 bg-muted rounded text-xs font-mono whitespace-pre-wrap max-h-96 overflow-y-auto">
                        {entry.prompt}
                      </pre>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
