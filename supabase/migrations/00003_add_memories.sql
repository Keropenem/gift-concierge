-- ENN: memories テーブル
-- AIとの対話から蓄積される自由形式のメモ（ChatGPTのメモリ機能相当）

create table if not exists public.memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  content text not null,
  source text default 'ai',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists memories_user_id_idx on public.memories(user_id);

alter table public.memories enable row level security;

create policy "Users can view own memories"
  on public.memories for select
  using (auth.uid() = user_id);

create policy "Users can insert own memories"
  on public.memories for insert
  with check (auth.uid() = user_id);

create policy "Users can update own memories"
  on public.memories for update
  using (auth.uid() = user_id);

create policy "Users can delete own memories"
  on public.memories for delete
  using (auth.uid() = user_id);

create trigger on_memories_updated
  before update on public.memories
  for each row
  execute function public.handle_updated_at();
