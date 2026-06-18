-- 2026 U.S. Open Pool — Supabase schema
-- Paste this entire file into Supabase's SQL Editor and click "Run".
-- Safe to re-run: every statement is guarded.

-- ──────────────────────────────────────────────────────────────────────────────
-- Tables
-- ──────────────────────────────────────────────────────────────────────────────

create table if not exists participants (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  passcode text not null,
  created_at timestamptz default now()
);

-- Any entrant can pick any golfer; duplicates between entrants are fine.
create table if not exists picks (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references participants(id) on delete cascade,
  golfer_id integer not null,
  created_at timestamptz default now()
);

-- If the table was created earlier with the old sniping UNIQUE, drop it.
alter table picks drop constraint if exists picks_golfer_id_key;

create table if not exists results (
  golfer_id integer primary key,
  finish text not null,
  points integer not null,
  updated_at timestamptz default now()
);

create table if not exists settings (
  key text primary key,
  value text not null
);

-- ──────────────────────────────────────────────────────────────────────────────
-- Defaults
-- ──────────────────────────────────────────────────────────────────────────────

-- Cutoff = Thursday 18 June 2026, 7:00 AM ET (11:00 UTC during EDT).
-- Picks are locked after this timestamp.
insert into settings (key, value) values
  ('draft_cutoff', '2026-06-18T11:00:00Z'),
  ('admin_passcode', 'changeme')
on conflict (key) do nothing;

-- ──────────────────────────────────────────────────────────────────────────────
-- Row Level Security — open policies suitable for a trusted family pool.
-- Tighten later if you want stronger admin gating.
-- ──────────────────────────────────────────────────────────────────────────────

alter table participants enable row level security;
alter table picks enable row level security;
alter table results enable row level security;
alter table settings enable row level security;

-- Table-level grants (Supabase auto-grants when you create via the dashboard,
-- but NOT when tables are created via raw SQL — so we do it explicitly here).
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on participants to anon, authenticated;
grant select, insert, update, delete on picks        to anon, authenticated;
grant select, insert, update, delete on results      to anon, authenticated;
grant select, insert, update, delete on settings     to anon, authenticated;

drop policy if exists "read participants" on participants;
drop policy if exists "read picks" on picks;
drop policy if exists "read results" on results;
drop policy if exists "read settings" on settings;
drop policy if exists "insert participants" on participants;
drop policy if exists "insert picks" on picks;
drop policy if exists "delete picks" on picks;
drop policy if exists "insert results" on results;
drop policy if exists "update results" on results;
drop policy if exists "delete results" on results;
drop policy if exists "insert settings" on settings;
drop policy if exists "update settings" on settings;

create policy "read participants" on participants for select using (true);
create policy "read picks" on picks for select using (true);
create policy "read results" on results for select using (true);
create policy "read settings" on settings for select using (true);

create policy "insert participants" on participants for insert with check (true);
create policy "insert picks" on picks for insert with check (true);
create policy "delete picks" on picks for delete using (true);

create policy "insert results" on results for insert with check (true);
create policy "update results" on results for update using (true);
create policy "delete results" on results for delete using (true);

create policy "insert settings" on settings for insert with check (true);
create policy "update settings" on settings for update using (true);

-- ──────────────────────────────────────────────────────────────────────────────
-- Realtime: optional, but lets the leaderboard update live as picks come in.
-- If this errors, you can enable it via the dashboard:
--   Database → Replication → supabase_realtime → toggle picks, results on.
-- ──────────────────────────────────────────────────────────────────────────────

do $$
begin
  begin
    alter publication supabase_realtime add table picks;
  exception when others then null;
  end;
  begin
    alter publication supabase_realtime add table results;
  exception when others then null;
  end;
end $$;
