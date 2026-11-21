-- Proof Duel database setup (secure version 2: name + password accounts, private photos).
-- Paste all of this into Supabase → SQL Editor → New query, then press Run.
-- It replaces any earlier setup. Existing test players, logs and photos are deleted.
--
-- How sign-in works: every phone first gets an anonymous Supabase session (no email).
-- That session can see NOTHING until it proves a player's name + password through the
-- functions below. Passwords are stored only as bcrypt hashes, in a table no one can read.

create extension if not exists pgcrypto with schema extensions;

-- 0. Remove earlier setups
drop table if exists public.logs cascade;
drop table if exists public.activities cascade;
drop table if exists public.devices cascade;
drop table if exists public.player_secrets cascade;
drop table if exists public.players cascade;
drop function if exists public.is_member() cascade;
drop function if exists public.current_player() cascade;
drop function if exists public.enforce_two_players() cascade;
drop function if exists public.create_player(text, text, text, text) cascade;
drop function if exists public.sign_in(text, text) cascade;
drop function if exists public.sign_out() cascade;
drop function if exists public.my_player() cascade;
drop policy if exists "proofs upload" on storage.objects;
drop policy if exists "proofs read" on storage.objects;
drop policy if exists "proofs delete" on storage.objects;
drop policy if exists "proofs member read" on storage.objects;
drop policy if exists "proofs own upload" on storage.objects;
drop policy if exists "proofs own delete" on storage.objects;

-- 1. Tables
create table public.players (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 24),
  emoji text not null default '🌸' check (char_length(emoji) <= 8),
  color text not null default '#e6407e' check (color ~ '^#[0-9a-fA-F]{6}$'),
  avatar text check (avatar is null or char_length(avatar) <= 200),
  joined_at timestamptz not null default now()
);
create unique index players_name_ci on public.players (lower(name));

-- password hashes + lockout counters: RLS on with NO policies = unreadable from the app
create table public.player_secrets (
  player_id uuid primary key references public.players(id) on delete cascade,
  pw_hash text not null,
  failed int not null default 0,
  locked_until timestamptz
);

-- which signed-in phone belongs to which player
create table public.devices (
  uid uuid primary key references auth.users(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  created_at timestamptz not null default now()
);

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

-- 2. Helper: which player is this phone signed in as? (null = nobody)
create function public.current_player() returns uuid
language sql stable security definer set search_path = public as $$
  select player_id from public.devices where uid = auth.uid();
$$;
create function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select public.current_player() is not null;
$$;
create function public.my_player() returns uuid
language sql stable security definer set search_path = public as $$
  select public.current_player();
$$;

-- 3. Create account (max two players ever)
create function public.create_player(p_name text, p_password text, p_emoji text, p_color text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare new_id uuid;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  p_name := btrim(p_name);
  if char_length(p_name) < 1 or char_length(p_name) > 24 then raise exception 'bad_name'; end if;
  if p_password is null or char_length(p_password) < 8 or char_length(p_password) > 72 then raise exception 'weak_password'; end if;
  lock table public.players in exclusive mode;
  if (select count(*) from public.players) >= 2 then raise exception 'challenge_full'; end if;
  if exists (select 1 from public.players where lower(name) = lower(p_name)) then raise exception 'name_taken'; end if;
  insert into public.players (name, emoji, color) values (p_name, coalesce(p_emoji,'🌸'), coalesce(p_color,'#e6407e')) returning id into new_id;
  insert into public.player_secrets (player_id, pw_hash) values (new_id, crypt(p_password, gen_salt('bf', 10)));
  insert into public.devices (uid, player_id) values (auth.uid(), new_id)
    on conflict (uid) do update set player_id = excluded.player_id, created_at = now();
  return new_id;
end $$;

-- 4. Sign in with name + password (locks for 15 minutes after 10 wrong tries)
create function public.sign_in(p_name text, p_password text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare pid uuid; sec public.player_secrets;
begin
  if auth.uid() is null then return 'not_signed_in'; end if;
  select id into pid from public.players where lower(name) = lower(btrim(p_name));
  if pid is null then perform pg_sleep(0.5); return 'wrong'; end if;
  select * into sec from public.player_secrets where player_id = pid for update;
  if sec.locked_until is not null and sec.locked_until > now() then return 'locked'; end if;
  if sec.pw_hash <> crypt(coalesce(p_password,''), sec.pw_hash) then
    update public.player_secrets
       set failed = failed + 1,
           locked_until = case when failed + 1 >= 10 then now() + interval '15 minutes' else null end
     where player_id = pid;
    return 'wrong';
  end if;
  update public.player_secrets set failed = 0, locked_until = null where player_id = pid;
  insert into public.devices (uid, player_id) values (auth.uid(), pid)
    on conflict (uid) do update set player_id = excluded.player_id, created_at = now();
  return 'ok';
end $$;

create function public.sign_out() returns void
language sql security definer set search_path = public as $$
  delete from public.devices where uid = auth.uid();
$$;

revoke all on function public.current_player(), public.is_member(), public.my_player(),
  public.create_player(text,text,text,text), public.sign_in(text,text), public.sign_out() from public, anon;
grant execute on function public.current_player(), public.is_member(), public.my_player(),
  public.create_player(text,text,text,text), public.sign_in(text,text), public.sign_out() to authenticated;

-- 5. Lock everything down
revoke all on public.players, public.player_secrets, public.devices, public.activities, public.logs from anon;
revoke all on public.player_secrets, public.devices from authenticated;
-- signed-in phones may use these tables; the row rules below still decide what they can see or change
grant usage on schema public to authenticated;
grant select, update on public.players to authenticated;
grant select, insert, update, delete on public.activities to authenticated;
grant select, insert, update, delete on public.logs to authenticated;
alter table public.players        enable row level security;
alter table public.player_secrets enable row level security;
alter table public.devices        enable row level security;
alter table public.activities     enable row level security;
alter table public.logs           enable row level security;

create policy "players read" on public.players for select to authenticated using (public.is_member());
create policy "players edit" on public.players for update to authenticated
  using (id = public.current_player()) with check (id = public.current_player());

create policy "activities read"  on public.activities for select to authenticated using (public.is_member());
create policy "activities write" on public.activities for all    to authenticated using (public.is_member()) with check (public.is_member());

create policy "logs read"   on public.logs for select to authenticated using (public.is_member());
create policy "logs create" on public.logs for insert to authenticated with check (player_id = public.current_player());
create policy "logs edit"   on public.logs for update to authenticated using (player_id = public.current_player()) with check (player_id = public.current_player());
create policy "logs delete" on public.logs for delete to authenticated using (player_id = public.current_player());

-- 6. Private photo storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('proofs', 'proofs', false, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "proofs member read" on storage.objects for select to authenticated
  using (bucket_id = 'proofs' and public.is_member());
create policy "proofs own upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'proofs' and (storage.foldername(name))[1] = public.current_player()::text);
create policy "proofs own delete" on storage.objects for delete to authenticated
  using (bucket_id = 'proofs' and (storage.foldername(name))[1] = public.current_player()::text);

-- 7. Live updates between your two phones
do $$ begin
  begin alter publication supabase_realtime add table public.players;    exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.activities; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.logs;       exception when duplicate_object then null; end;
end $$;

-- Done. One setting is needed in Supabase: Authentication → Sign In / Providers →
-- turn ON "Allow anonymous sign-ins" (and keep "Allow new users to sign up" ON).

-- Make the API notice new columns right away
notify pgrst, 'reload schema';
