"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { createClient } from "@/lib/supabase/client";
import type { ChatMessage, Profile, Recipient, Memory } from "@/lib/types";

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [selectedRecipient, setSelectedRecipient] = useState<Recipient | null>(null);
  const [showRecipientPicker, setShowRecipientPicker] = useState(false);
  const [userMemories, setUserMemories] = useState<Memory[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [pastSessions, setPastSessions] = useState<Array<{ id: string; created_at: string; preview: string; messageCount: number }>>([]);
  const [showHistory, setShowHistory] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // stateの更新タイミングに依存しないよう、refでも保持
  const profileRef = useRef<Profile | null>(null);
  const userIdRef = useRef<string | null>(null);
  const userMemoriesRef = useRef<Memory[]>([]);

  useEffect(() => {
    loadUserData();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function loadUserData() {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    console.log("[DEBUG] user:", user?.id || "NOT LOGGED IN");

    if (user) {
      setUserId(user.id);
      userIdRef.current = user.id;

      const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

      console.log("[DEBUG] profileData:", JSON.stringify(profileData));
      console.log("[DEBUG] profileError:", profileError?.message || "none");

      if (profileData) {
        setProfile(profileData);
        profileRef.current = profileData;
      }

      const { data: recipientData, error: recipientError } = await supabase
        .from("recipients")
        .select("*")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false });

      console.log("[DEBUG] recipientData:", JSON.stringify(recipientData));
      console.log("[DEBUG] recipientError:", recipientError?.message || "none");

      if (recipientData && recipientData.length > 0) {
        setRecipients(recipientData);
        setShowRecipientPicker(true);
      }

      const { data: memoryData, error: memoryError } = await supabase
        .from("memories")
        .select("*")
        .eq("user_id", user.id);

      console.log("[DEBUG] memoryData:", JSON.stringify(memoryData));
      console.log("[DEBUG] memoryError:", memoryError?.message || "none");

      if (memoryData) {
        setUserMemories(memoryData);
        userMemoriesRef.current = memoryData;
      }

      // 過去のセッション一覧を取得
      const sessionsRes = await fetch(`/api/sessions?userId=${user.id}`);
      const sessionsData = await sessionsRes.json();
      if (sessionsData.sessions) setPastSessions(sessionsData.sessions);
    } else {
      console.log("[DEBUG] user is null — not logged in");
    }

    setInitialized(true);

    const params = new URLSearchParams(window.location.search);

    // セッション再開
    const resumeId = params.get("resume");
    if (resumeId) {
      await resumeSession(resumeId);
      setInitialized(true);
      return;
    }

    const initialQuery = params.get("q");
    if (initialQuery) {
      sendMessage(initialQuery);
    }
  }

  async function sendMessage(text: string) {
    if (!text.trim() || loading) return;

    const userMessage: ChatMessage = {
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setShowRecipientPicker(false);

    try {
      const body: Record<string, unknown> = { message: text };

      // 初回メッセージ時にプロフィール・メモリ情報を添付（refを使ってstate更新タイミングに依存しない）
      if (messages.length === 0) {
        const p = profile || profileRef.current;
        const uid = userId || userIdRef.current;
        const mem = userMemories.length > 0 ? userMemories : userMemoriesRef.current;
        console.log("[DEBUG sendMessage] profile:", JSON.stringify(p));
        console.log("[DEBUG sendMessage] userId:", uid);
        console.log("[DEBUG sendMessage] memories:", mem.length);
        console.log("[DEBUG sendMessage] selectedRecipient:", JSON.stringify(selectedRecipient));
        if (p) body.profile = p;
        if (selectedRecipient) body.recipient = selectedRecipient;
        if (uid) body.userId = uid;
        if (mem.length > 0) body.memories = mem;
        console.log("[DEBUG sendMessage] body keys being sent:", Object.keys(body));
      }

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(sessionId ? { "x-session-id": sessionId } : {}),
        },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (data.session_id) {
        setSessionId(data.session_id);
      }

      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: data.reply,
        timestamp: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch {
      const errorMessage: ChatMessage = {
        role: "assistant",
        content: "申し訳ありません。通信エラーが発生しました。もう一度お試しください。",
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    sendMessage(input);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Ctrl+Enter or Cmd+Enter で送信
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      sendMessage(input);
    }
    // 素のEnterは改行（デフォルト動作のまま）
  }

  function autoResize() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }

  async function resumeSession(sid: string) {
    const res = await fetch(`/api/chat/session?id=${sid}`);
    const data = await res.json();
    if (data.messages) {
      const chatMessages: ChatMessage[] = data.messages.map((m: { role: string; parts: Array<{ text: string }> }, i: number) => ({
        role: m.role === "model" ? "assistant" as const : "user" as const,
        content: m.parts?.[0]?.text || "",
        timestamp: new Date(Date.now() - (data.messages.length - i) * 1000).toISOString(),
      }));
      setMessages(chatMessages);
      setSessionId(sid);
      setShowHistory(false);
      setShowRecipientPicker(false);
    }
  }

  function handleNewChat() {
    setMessages([]);
    setSessionId(null);
    setSelectedRecipient(null);
    if (recipients.length > 0) setShowRecipientPicker(true);
  }

  if (!initialized) {
    return (
      <div className="flex items-center justify-center h-screen text-muted-foreground">
        読み込み中...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen">
      {/* ヘッダー */}
      <header className="flex justify-between items-center px-4 py-3 border-b border-border">
        <Link href="/" className="text-lg font-bold tracking-tight">
          Con-TecT
        </Link>
        <div className="flex items-center gap-3">
          {profile && (
            <span className="text-xs text-muted-foreground">
              {profile.email}
            </span>
          )}
          {pastSessions.length > 0 && (
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              履歴 ({pastSessions.length})
            </button>
          )}
          <Link
            href="/admin/prompt"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            プロンプト設定
          </Link>
          <button
            onClick={handleNewChat}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            新しい相談
          </button>
        </div>
      </header>

      {/* 履歴パネル */}
      {showHistory && (
        <div className="border-b border-border px-4 py-3 max-h-60 overflow-y-auto">
          <div className="max-w-2xl mx-auto">
            <p className="text-xs font-medium text-muted-foreground mb-2">過去の相談</p>
            <div className="flex flex-col gap-1">
              {pastSessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => resumeSession(s.id)}
                  className="flex justify-between items-center px-3 py-2 text-sm text-left rounded-md hover:bg-muted transition-colors"
                >
                  <span className="truncate flex-1">{s.preview}</span>
                  <span className="text-xs text-muted-foreground ml-2 shrink-0">
                    {new Date(s.created_at).toLocaleDateString("ja-JP")} ({s.messageCount}通)
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* チャットメッセージエリア */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-2xl mx-auto flex flex-col gap-4">
          {messages.length === 0 && (
            <div className="text-center text-muted-foreground py-12">
              <p className="text-lg font-medium">ギフトコンシェルジュ</p>
              <p className="text-sm mt-2">
                あなたと大切な方の「見えない共通点」から、
                <br />
                世界にひとつだけの贈り物を提案します。
              </p>

              {/* 会員プロフィール表示 */}
              {profile && profile.occupation && (
                <div className="mt-6 p-4 bg-muted rounded-lg text-left text-sm max-w-md mx-auto">
                  <p className="font-medium text-foreground mb-2">
                    あなたのプロフィール（自動反映されます）
                  </p>
                  <p className="text-muted-foreground">
                    {profile.age && `${profile.age}歳`}
                    {profile.gender && ` / ${profile.gender === "male" ? "男性" : profile.gender === "female" ? "女性" : profile.gender === "other" ? "その他" : ""}`}
                    {profile.occupation && ` / ${profile.occupation}`}
                  </p>
                  {profile.interests && profile.interests.length > 0 && (
                    <p className="text-muted-foreground mt-1">
                      関心: {profile.interests.join(", ")}
                    </p>
                  )}
                </div>
              )}

              {/* 受取り手選択 */}
              {showRecipientPicker && recipients.length > 0 && (
                <div className="mt-4 max-w-md mx-auto">
                  <p className="text-sm font-medium text-foreground mb-3">
                    過去に贈った相手を選ぶ
                  </p>
                  <div className="flex flex-col gap-2">
                    {recipients.map((r) => (
                      <button
                        key={r.id}
                        onClick={() => setSelectedRecipient(
                          selectedRecipient?.id === r.id ? null : r
                        )}
                        className={`p-3 rounded-lg text-left text-sm border transition-colors ${
                          selectedRecipient?.id === r.id
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/50"
                        }`}
                      >
                        <span className="font-medium">{r.nickname}</span>
                        {r.relationship && (
                          <span className="text-muted-foreground ml-2">
                            ({r.relationship})
                          </span>
                        )}
                        {r.occupation && (
                          <span className="text-muted-foreground ml-2">
                            / {r.occupation}
                          </span>
                        )}
                      </button>
                    ))}
                    <button
                      onClick={() => {
                        setSelectedRecipient(null);
                        setShowRecipientPicker(false);
                      }}
                      className="p-3 rounded-lg text-left text-sm border border-dashed border-border hover:border-primary/50 text-muted-foreground transition-colors"
                    >
                      + 新しい相手に贈る
                    </button>
                  </div>
                  {selectedRecipient && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {selectedRecipient.nickname}さんの情報が自動反映されます
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground whitespace-pre-wrap"
                    : "bg-muted text-foreground prose prose-sm prose-neutral max-w-none [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1"
                }`}
              >
                {msg.role === "user" ? (
                  msg.content
                ) : (
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-muted px-4 py-3 rounded-2xl text-sm">
                <span className="inline-flex gap-1">
                  <span className="animate-bounce">.</span>
                  <span className="animate-bounce [animation-delay:0.2s]">.</span>
                  <span className="animate-bounce [animation-delay:0.4s]">.</span>
                </span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* 入力エリア */}
      <div className="border-t border-border px-4 py-3">
        <form
          onSubmit={handleSubmit}
          className="max-w-2xl mx-auto flex items-end gap-2"
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              autoResize();
            }}
            onKeyDown={handleKeyDown}
            placeholder="メッセージを入力...（Ctrl+Enterで送信）"
            disabled={loading}
            rows={1}
            className="flex-1 px-4 py-2.5 border border-input rounded-2xl focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:opacity-50 resize-none overflow-hidden leading-relaxed"
            autoFocus
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="px-5 py-2.5 bg-primary text-primary-foreground rounded-2xl hover:opacity-90 transition-opacity disabled:opacity-50 shrink-0"
          >
            送信
          </button>
        </form>
      </div>
    </div>
  );
}
