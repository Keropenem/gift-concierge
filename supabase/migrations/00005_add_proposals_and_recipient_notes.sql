-- 提案履歴テーブル: 誰に何を提案したかを記録
create table if not exists public.proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  session_id uuid references public.sessions(id) on delete set null,
  recipient_id uuid references public.recipients(id) on delete set null,
  product_name text not null,
  product_description text,
  product_url text,
  product_price text,
  maker_name text,
  narrative text,
  occasion text,
  created_at timestamptz default now()
);

create index if not exists proposals_user_id_idx on public.proposals(user_id);
create index if not exists proposals_recipient_id_idx on public.proposals(recipient_id);

alter table public.proposals enable row level security;

create policy "Users can view own proposals" on public.proposals for select using (auth.uid() = user_id);
create policy "Anyone can insert proposals" on public.proposals for insert with check (true);

-- 受け手メモリ: 受け手ごとの自由記述メモ
create table if not exists public.recipient_notes (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.recipients(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  content text not null,
  source text default 'ai',
  created_at timestamptz default now()
);

create index if not exists recipient_notes_recipient_id_idx on public.recipient_notes(recipient_id);

alter table public.recipient_notes enable row level security;

create policy "Users can view own recipient notes" on public.recipient_notes for select using (auth.uid() = user_id);
create policy "Anyone can insert recipient notes" on public.recipient_notes for insert with check (true);
create policy "Users can update own recipient notes" on public.recipient_notes for update using (auth.uid() = user_id);
create policy "Users can delete own recipient notes" on public.recipient_notes for delete using (auth.uid() = user_id);
