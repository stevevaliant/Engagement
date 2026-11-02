# Skyland Hammurabi – Reception Table Planner

A simple app to organise the reception seating. Open `index.html` (or the deployed link) on any phone or computer.

## What it does

- **Room map** of the Skyland Hammurabi reception, from the venue photos and hand-drawn plan: the dance floor down the middle with the DJ at one end and Rebecca & Steve's table at the other. The entrance side has 11 tables split by the corridor to the door. The far side has 13 tables. That's 24 tables of 10, and everything can be moved, renamed, added or removed.
- **Tap a table** to see who's sitting there and how many seats are left (10 per table by default).
- **Add guests** one at a time or paste a whole list (one name per line).
- **Add tables** any time with "+ Add table". Change the seats on a single table with − / +.
- **Arrange room** to drag tables and areas so the map matches the real venue. You can also upload a floor plan photo and line the tables up over it.
- **Print list** for venue staff: every table with its guests.
- Tables never go over capacity, both in the app and in the database.

## Storage (Supabase)

Without Supabase details, the app runs in **demo mode** and saves only on the device you're using.

To share one live plan across phones:

1. Run `supabase/migrations/001_seating.sql` in the Supabase SQL editor (creates the tables, the capacity rule, live updates, the `venue-photos` bucket and the starting 24 tables).
2. Put the project URL and publishable (anon) key in `config.js`.

Database tables: `seating_tables`, `guests`, `venue_items`, `app_settings`. Photo bucket: `venue-photos`.

Anyone with the app link can view and edit the plan, so share the link only with people who should.

## Hosting

It's plain HTML, CSS and JavaScript with no build step. Deploy the folder as-is to Vercel, Netlify or GitHub Pages.
