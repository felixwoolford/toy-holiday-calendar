# Holiday map

A tiny self-contained browser applet: open a calendar, pick a day, and see the
public/bank holidays on that day for the UK, US, Germany, France and Japan.
Built for people who keep getting caught out by other countries' holidays when
booking calls and trips.

## Running it (nothing to install)

1. Copy the `app/` folder somewhere (e.g. the desktop).
2. **Windows:** double-click `app/index.html` — it opens in the default browser (Edge).
3. **Linux:** double-click it in the file manager, or run `xdg-open app/index.html`.

That's all — no internet, no server, no Node/Python. The holiday data
(2024–2027) is baked into `app/holidays.js`.

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

## Development (optional)

- `npm i` — installs `playwright-core` (test-only dependency)
- `npm test` — core logic tests (Node's built-in test runner, no extra deps)
- `npm run test:browser` — UI smoke test in headless Chromium
  (`CHROMIUM=/path/to/chromium npm run test:browser`)
- `npm run build:data` — refresh the holiday data from
  [date.nager.at](https://date.nager.at) (needs internet; regenerates
  `app/holidays.js` — commit the result)

## Known limitations

- Data covers 2024–2027 only.
- Nationwide holidays only: German state holidays (Corpus Christi, Reformation
  Day, …) and US state holidays are not in the data.
- The data source sometimes lists only the observed date when a holiday falls
  on a weekend (e.g. US Independence Day 2026 shows on 3 July).
