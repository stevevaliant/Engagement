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

-- Starting layout: 10 tables of 10 around the dance floor. Drag to match the real room.
insert into public.seating_tables (name, capacity, x, y, sort_order) values
  ('Table 1', 10,  9, 26, 1), ('Table 2', 10, 22, 26, 2),
  ('Table 3', 10,  9, 48, 3), ('Table 4', 10, 22, 48, 4),
  ('Table 5', 10,  9, 70, 5), ('Table 6', 10, 22, 70, 6),
  ('Table 7', 10, 68, 26, 7), ('Table 8', 10, 81, 26, 8),
  ('Table 9', 10, 68, 48, 9), ('Table 10', 10, 81, 48, 10);

insert into public.venue_items (label, kind, x, y, w, h) values
  ('Couple''s Table', 'stage', 34, 4, 32, 10),
  ('Dance Floor', 'dance', 36, 34, 24, 30),
  ('DJ', 'other', 70, 4, 10, 10),
  ('Cake & Gifts', 'other', 4, 4, 14, 10),
  ('Bar', 'bar', 90, 58, 8, 28),
  ('Entrance', 'entrance', 42, 90, 16, 8);
