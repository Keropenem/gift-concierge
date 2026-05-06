-- ENN MVP: データベーススキーマ
-- 要件定義書 Section 8 準拠

-- ============================================
-- profiles テーブル（Supabase Auth の users を拡張）
-- ============================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  age integer,
  gender text,
  occupation text,
  interests text[] default '{}',
  strengths text[] default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- RLS（Row Level Security）有効化
alter table public.profiles enable row level security;

-- 自分のプロフィールのみ読み書き可能
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

-- ============================================
-- sessions テーブル（チャットセッション）
-- ============================================
create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  messages jsonb default '[]',
  profile_input jsonb default '{}',
  target_input jsonb default '{}',
  analysis_result jsonb default '{}',
  created_at timestamptz default now()
);

alter table public.sessions enable row level security;

-- 会員: 自分のセッションのみ閲覧可能
create policy "Users can view own sessions"
  on public.sessions for select
  using (auth.uid() = user_id);

-- 未会員: API経由でのみアクセス（service_role key使用）
create policy "Users can insert sessions"
  on public.sessions for insert
  with check (true);

create policy "Users can update own sessions"
  on public.sessions for update
  using (auth.uid() = user_id or user_id is null);

-- ============================================
-- click_logs テーブル
-- ============================================
create table if not exists public.click_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  session_id uuid references public.sessions(id) on delete cascade,
  product_name text not null,
  product_url text not null,
  clicked_at timestamptz default now()
);

alter table public.sessions enable row level security;

-- 会員のクリック履歴のみ
create policy "Users can view own click logs"
  on public.click_logs for select
  using (auth.uid() = user_id);

create policy "Anyone can insert click logs"
  on public.click_logs for insert
  with check (true);

-- ============================================
-- updated_at 自動更新トリガー
-- ============================================
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger on_profiles_updated
  before update on public.profiles
  for each row
  execute function public.handle_updated_at();

-- ============================================
-- 新規ユーザー登録時にprofilesを自動作成
-- ============================================
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();
