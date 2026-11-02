-- Skyland Hammurabi reception table planner
-- Tables, guests, room features (dance floor, bar...), settings, and a photo bucket.

create table if not exists public.seating_tables (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  capacity integer not null default 10 check (capacity between 1 and 30),
  x double precision not null default 50,   -- centre, % of room width
  y double precision not null default 50,   -- centre, % of room height
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.guests (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  table_id uuid references public.seating_tables(id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists guests_table_id_idx on public.guests(table_id);

create table if not exists public.venue_items (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  kind text not null default 'other',
  x double precision not null default 40,   -- top-left, % of room width
  y double precision not null default 40,   -- top-left, % of room height
  w double precision not null default 15,
  h double precision not null default 12,
  created_at timestamptz not null default now()
);

create table if not exists public.app_settings (
  key text primary key,
  value text
);

-- Never seat more guests than a table has seats.
create or replace function public.enforce_table_capacity()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  cap integer;
  cnt integer;
begin
  if new.table_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.table_id is not distinct from old.table_id then
    return new;
  end if;
  select capacity into cap from public.seating_tables where id = new.table_id for update;
  select count(*) into cnt from public.guests where table_id = new.table_id;
  if cnt >= cap then
    raise exception 'Table is full (% of % seats taken)', cnt, cap;
  end if;
  return new;
end;
$$;

drop trigger if exists guests_capacity on public.guests;
create trigger guests_capacity
  before insert or update of table_id on public.guests
  for each row execute function public.enforce_table_capacity();

-- Simple shared access: anyone with the app link can view and edit the plan.
alter table public.seating_tables enable row level security;
alter table public.guests enable row level security;
alter table public.venue_items enable row level security;
alter table public.app_settings enable row level security;

create policy "planner access" on public.seating_tables for all to anon, authenticated using (true) with check (true);
create policy "planner access" on public.guests for all to anon, authenticated using (true) with check (true);
create policy "planner access" on public.venue_items for all to anon, authenticated using (true) with check (true);
create policy "planner access" on public.app_settings for all to anon, authenticated using (true) with check (true);

-- Live updates so everyone sees changes instantly.
alter publication supabase_realtime add table
  public.seating_tables, public.guests, public.venue_items, public.app_settings;

-- Floor plan / venue photos.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('venue-photos', 'venue-photos', true, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do nothing;

create policy "venue photos upload" on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'venue-photos');

-- Starting layout matching the Skyland Hammurabi room: 24 tables of 10.
-- DJ at one end of the dance floor, the couple's table at the other.
-- Entrance side: tables 1-11, split by the corridor. Far side: tables 12-24, no split.
insert into public.seating_tables (name, capacity, x, y, sort_order) values
  ('Table 1', 10, 9, 12, 1),
  ('Table 2', 10, 21, 12, 2),
  ('Table 3', 10, 33, 12, 3),
  ('Table 4', 10, 9, 33, 4),
  ('Table 5', 10, 21, 33, 5),
  ('Table 6', 10, 33, 33, 6),
  ('Table 7', 10, 9, 67, 7),
  ('Table 8', 10, 21, 67, 8),
  ('Table 9', 10, 33, 67, 9),
  ('Table 10', 10, 9, 88, 10),
  ('Table 11', 10, 21, 88, 11),
  ('Table 12', 10, 67, 10, 12),
  ('Table 13', 10, 79, 10, 13),
  ('Table 14', 10, 91, 10, 14),
  ('Table 15', 10, 67, 30, 15),
  ('Table 16', 10, 79, 30, 16),
  ('Table 17', 10, 91, 30, 17),
  ('Table 18', 10, 67, 50, 18),
  ('Table 19', 10, 79, 50, 19),
  ('Table 20', 10, 91, 50, 20),
  ('Table 21', 10, 67, 70, 21),
  ('Table 22', 10, 79, 70, 22),
  ('Table 23', 10, 91, 70, 23),
  ('Table 24', 10, 91, 90, 24);

insert into public.venue_items (label, kind, x, y, w, h) values
  ('DJ', 'other', 41, 2, 18, 8),
  ('Rebecca & Steve', 'stage', 38, 89, 24, 9),
  ('Dance Floor', 'dance', 42, 13, 16, 73),
  ('Corridor', 'dance', 9, 45, 33, 10),
  ('Entrance', 'entrance', 1, 41, 8, 18);
