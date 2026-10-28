# Holiday map

A tiny self-contained browser applet: open a calendar, pick a day or a range
of days, and see the bank and school holidays on those days for the UK, US,
Germany, France and Japan. Built for people who keep getting caught out by
other countries' holidays when booking calls and trips.

## Running it (nothing to install)

1. Copy the `app/` folder somewhere (e.g. the desktop).
2. **Windows:** double-click `app/index.html` — it opens in the default browser (Edge).
3. **Linux:** double-click it in the file manager, or run `xdg-open app/index.html`.

That's all — no internet, no server, no Node/Python. The holiday data
(2024–2028) is baked into `app/holidays.js`.

## Using it

- The calendar opens on the current month with today selected.
- Coloured dots mark days that have holidays (one colour per country); the
  chips at the top switch countries on/off.
- Click a day to see its holidays. Click a start day and then an end day to
  select a range: the span is highlighted and every holiday in it is listed,
  grouped by date. Clicking a day earlier than the start begins a new
  selection; after a range is set, the next click also starts fresh.
- UK entries are labelled by region where a holiday only applies to part of
  the UK; German entries carry a note where they don't apply nationwide.
- School holidays are listed as date ranges and always carry their region
  (German state, French zone, Northern Ireland); identical breaks are merged
  into one line ("3 regions: …"). Where a country has no school-holiday data
  (US, Japan, and England/Scotland/Wales — set by each local authority), the
  app says so explicitly instead of showing an empty list.

## Development (optional)

- `npm i` — installs `playwright-core` (test-only dependency)
- `npm test` — core logic tests (Node's built-in test runner, no extra deps)
- `npm run test:browser` — UI smoke test in headless Chromium
  (`CHROMIUM=/path/to/chromium npm run test:browser`)
- `npm run build:data` — refresh the holiday data (needs internet; regenerates
  `app/holidays.js` — commit the result). Bank holidays come from
  [date.nager.at](https://date.nager.at); school holidays from
  [schulferien.org](https://www.schulferien.org) (Germany, France) and
  [education-ni.gov.uk](https://www.education-ni.gov.uk) (Northern Ireland).
  The French zones are cross-checked against the official
  [service-public.gouv.fr](https://www.service-public.gouv.fr) calendar.

## Known limitations

- Data covers 2024–2028 only (2028 is only covered by German school holidays
  that run into January).
- School holidays: Germany (all 16 states) and France (zones A/B/C + Corsica)
  are complete; the UK is Northern Ireland only; the US and Japan have no
  national school calendar, so the app shows a note instead. The French
  2027/28 calendar is not published yet, so autumn/Christmas 2027 are missing.
- Bank holidays are nationwide: German state holidays (Corpus Christi,
  Reformation Day, …) and US state holidays are not in the data.
- The data source sometimes lists only the observed date when a holiday falls
  on a weekend (e.g. US Independence Day 2026 shows on 3 July).
