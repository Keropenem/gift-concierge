-- 提案へのユーザーフィードバック
-- フィードバック改善 #4: 3段階リアクション（good/neutral/bad）+ 任意コメント
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  session_id uuid references public.sessions(id) on delete cascade,
  -- assistantメッセージのインデックス（messages配列内の位置）。提案カードごとに1件
  message_index integer not null,
  -- 3段階: 'good' = 😊ニコニコ, 'neutral' = 😐普通, 'bad' = 😞ダメ
  rating text not null check (rating in ('good', 'neutral', 'bad')),
  comment text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  -- 同一メッセージに対する重複FB防止（最新で上書き）
  unique (session_id, message_index)
);

alter table public.feedback enable row level security;

create policy "Users can view own feedback"
  on public.feedback for select
  using (auth.uid() = user_id);

create policy "Users can insert own feedback"
  on public.feedback for insert
  with check (auth.uid() = user_id);

create policy "Users can update own feedback"
  on public.feedback for update
  using (auth.uid() = user_id);

create trigger on_feedback_updated
  before update on public.feedback
  for each row
  execute function public.handle_updated_at();
