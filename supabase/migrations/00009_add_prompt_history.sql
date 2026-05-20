-- プロンプト変更履歴（チューニング作業のログ）
-- 会議要望: プロンプト本体 + 任意メモ（何を狙って変更したか）を残す
create table if not exists public.prompt_history (
  id uuid primary key default gen_random_uuid(),
  prompt text not null,
  memo text,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now()
);

alter table public.prompt_history enable row level security;

-- 認証済みユーザーは履歴を読める（チューニング作業は共同で行う前提）
create policy "Authenticated users can read prompt history"
  on public.prompt_history for select
  using (auth.uid() is not null);

create policy "Authenticated users can insert prompt history"
  on public.prompt_history for insert
  with check (auth.uid() is not null);

create index if not exists prompt_history_created_at_idx
  on public.prompt_history (created_at desc);
