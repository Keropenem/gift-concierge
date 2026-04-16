-- Con-TecT: recipients テーブル
-- 会議で追加された要件: 過去に贈った相手のプロフィールを保存し、再利用可能にする

create table if not exists public.recipients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  nickname text not null,
  relationship text,
  age integer,
  gender text,
  occupation text,
  interests text[] default '{}',
  strengths text[] default '{}',
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists recipients_user_id_idx on public.recipients(user_id);

alter table public.recipients enable row level security;

create policy "Users can view own recipients"
  on public.recipients for select
  using (auth.uid() = user_id);

create policy "Users can insert own recipients"
  on public.recipients for insert
  with check (auth.uid() = user_id);

create policy "Users can update own recipients"
  on public.recipients for update
  using (auth.uid() = user_id);

create policy "Users can delete own recipients"
  on public.recipients for delete
  using (auth.uid() = user_id);

create trigger on_recipients_updated
  before update on public.recipients
  for each row
  execute function public.handle_updated_at();

-- sessions に recipient_id を追加（どの相手への提案かを紐づけ）
alter table public.sessions
  add column if not exists recipient_id uuid references public.recipients(id) on delete set null;
