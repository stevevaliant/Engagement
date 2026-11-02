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

-- Starting layout matching the Skyland Hammurabi room: 20 tables of 10.
-- Couple's table and the H stage face each other across the dance floor; a runway leads to the entrance.
insert into public.seating_tables (name, capacity, x, y, sort_order) values
  ('Table 1', 10, 54, 15, 1),
  ('Table 2', 10, 66, 15, 2),
  ('Table 3', 10, 78, 15, 3),
  ('Table 4', 10, 54, 33, 4),
  ('Table 5', 10, 66, 33, 5),
  ('Table 6', 10, 78, 33, 6),
  ('Table 7', 10, 54, 67, 7),
  ('Table 8', 10, 66, 67, 8),
  ('Table 9', 10, 78, 67, 9),
  ('Table 10', 10, 54, 85, 10),
  ('Table 11', 10, 66, 85, 11),
  ('Table 12', 10, 78, 85, 12),
  ('Table 13', 10, 9, 15, 13),
  ('Table 14', 10, 9, 38, 14),
  ('Table 15', 10, 9, 61, 15),
  ('Table 16', 10, 9, 84, 16),
  ('Table 17', 10, 22, 15, 17),
  ('Table 18', 10, 22, 38, 18),
  ('Table 19', 10, 22, 61, 19),
  ('Table 20', 10, 22, 84, 20);

insert into public.venue_items (label, kind, x, y, w, h) values
  ('Couple''s Table', 'stage', 30, 87, 18, 11),
  ('H Stage / DJ', 'other', 32, 2, 14, 9),
  ('Dance Floor', 'dance', 31, 16, 16, 68),
  ('Runway', 'dance', 47, 45, 44, 10),
  ('Entrance', 'entrance', 92, 40, 7, 20),
  ('Bar', 'bar', 87, 2, 12, 18),
  ('Exit', 'entrance', 12, 93, 8, 6);
