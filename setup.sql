-- Proof Duel database setup (secure version: accounts + private photos).
-- Paste all of this into Supabase → SQL Editor → New query, then press Run.
-- It replaces the earlier no-password setup. Any test players, logs and photos are deleted.

-- 0. Remove the old open setup
drop table if exists public.logs cascade;
drop table if exists public.activities cascade;
drop table if exists public.players cascade;
drop function if exists public.is_member() cascade;
drop function if exists public.enforce_two_players() cascade;
drop policy if exists "proofs upload" on storage.objects;
drop policy if exists "proofs read" on storage.objects;
drop policy if exists "proofs delete" on storage.objects;
drop policy if exists "proofs member read" on storage.objects;
drop policy if exists "proofs own upload" on storage.objects;
drop policy if exists "proofs own delete" on storage.objects;

-- 1. Tables. Each player is tied to a real login (auth.users).
create table public.players (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 24),
  emoji text not null default '🌸' check (char_length(emoji) <= 8),
  color text not null default '#e6407e' check (color ~ '^#[0-9a-fA-F]{6}$'),
  joined_at timestamptz not null default now()
);
create unique index players_name_ci on public.players (lower(name));

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  points int not null check (points between 1 and 1000),
  required boolean not null default false,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table public.logs (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  activity_id uuid not null,
  activity_name text not null,
  points int not null check (points between 1 and 1000),
  date date not null,
  photos text[] not null default '{}' check (cardinality(photos) <= 30),
  created_at timestamptz not null default now(),
  unique (player_id, activity_id, date)
);

insert into public.activities (name, points, required, sort)
values ('Sports', 30, true, 1), ('Take vitamins', 5, false, 2);

-- 2. Only two players can ever join this challenge.
create function public.enforce_two_players() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  lock table public.players in exclusive mode;
  if (select count(*) from public.players) >= 2 then
    raise exception 'This challenge already has two players';
  end if;
  return new;
end $$;
create trigger two_players_only before insert on public.players
for each row execute function public.enforce_two_players();

-- "Is the signed-in person one of the two players?"
create function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.players where id = auth.uid());
$$;
revoke all on function public.is_member() from public;
grant execute on function public.is_member() to authenticated;

-- 3. Lock everything down. Signed-out visitors get nothing at all.
revoke all on public.players, public.activities, public.logs from anon;
alter table public.players    enable row level security;
alter table public.activities enable row level security;
alter table public.logs       enable row level security;

-- players: the two of you can see each other; each person creates and edits only their own profile
create policy "players read"   on public.players for select to authenticated using (public.is_member() or id = auth.uid());
create policy "players create" on public.players for insert to authenticated with check (id = auth.uid());
create policy "players edit"   on public.players for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- activities: shared list, only players can see or change it
create policy "activities read"  on public.activities for select to authenticated using (public.is_member());
create policy "activities write" on public.activities for all    to authenticated using (public.is_member()) with check (public.is_member());

-- logs: both players can see all logs; you can only add, change or delete your own
create policy "logs read"   on public.logs for select to authenticated using (public.is_member());
create policy "logs create" on public.logs for insert to authenticated with check (player_id = auth.uid() and public.is_member());
create policy "logs edit"   on public.logs for update to authenticated using (player_id = auth.uid()) with check (player_id = auth.uid());
create policy "logs delete" on public.logs for delete to authenticated using (player_id = auth.uid());

-- 4. Private photo storage: only players can view; you can only upload into and delete from your own folder
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('proofs', 'proofs', false, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "proofs member read" on storage.objects for select to authenticated
  using (bucket_id = 'proofs' and public.is_member());
create policy "proofs own upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'proofs' and public.is_member() and (storage.foldername(name))[1] = auth.uid()::text);
create policy "proofs own delete" on storage.objects for delete to authenticated
  using (bucket_id = 'proofs' and (storage.foldername(name))[1] = auth.uid()::text);

-- 5. Live updates between your two phones
do $$ begin
  begin alter publication supabase_realtime add table public.players;    exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.activities; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.logs;       exception when duplicate_object then null; end;
end $$;
