-- Proof Duel database setup.
-- Paste all of this into Supabase → SQL Editor → New query, then press Run. Run it once.

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 1 and 24),
  emoji text not null default '🌸',
  color text not null default '#e6407e',
  joined_at timestamptz not null default now()
);

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  points int not null check (points between 1 and 1000),
  required boolean not null default false,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.logs (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  activity_id uuid not null,
  activity_name text not null,
  points int not null,
  date date not null,
  photos text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (player_id, activity_id, date)
);

-- Starting activities
insert into public.activities (name, points, required, sort)
select * from (values ('Sports', 30, true, 1), ('Take vitamins', 5, false, 2)) v(name, points, required, sort)
where not exists (select 1 from public.activities);

-- Access: the app has no passwords (name only), so anyone who has the app's link can use it.
alter table public.players    enable row level security;
alter table public.activities enable row level security;
alter table public.logs       enable row level security;
drop policy if exists "app access" on public.players;
drop policy if exists "app access" on public.activities;
drop policy if exists "app access" on public.logs;
create policy "app access" on public.players    for all to anon using (true) with check (true);
create policy "app access" on public.activities for all to anon using (true) with check (true);
create policy "app access" on public.logs       for all to anon using (true) with check (true);

-- Photo storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('proofs', 'proofs', true, 10485760, array['image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do nothing;
drop policy if exists "proofs upload" on storage.objects;
drop policy if exists "proofs read" on storage.objects;
drop policy if exists "proofs delete" on storage.objects;
create policy "proofs read"   on storage.objects for select to anon using (bucket_id = 'proofs');
create policy "proofs upload" on storage.objects for insert to anon with check (bucket_id = 'proofs');
create policy "proofs delete" on storage.objects for delete to anon using (bucket_id = 'proofs');

-- Live updates between your two phones
do $$ begin
  begin alter publication supabase_realtime add table public.players;    exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.activities; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.logs;       exception when duplicate_object then null; end;
end $$;
