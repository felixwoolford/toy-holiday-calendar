# Holiday map

A tiny self-contained browser applet: open a calendar, pick a day or a range
of days, and see the bank, school and religious holidays on those days for
the UK, US, Germany, France and Japan. A world map lets you narrow the list
to the countries you care about. Built for people who keep getting catch out
by other countries' holidays when booking calls and trips.

## Running it (nothing to install)

1. Copy the `app/` folder somewhere (e.g. the desktop).
2. **Windows:** double-click `app/index.html` — it opens in the default browser (Edge).
3. **Linux:** double-click it in the file manager, or run `xdg-open app/index.html`.

That's all — no internet, no server, no Node/Python. The holiday data
(2024–2028) is baked into `app/holidays.js`.

## Using it

- The calendar opens on the current month with today selected.
- Coloured dots mark days that have holidays (one colour per country).
- The world map is the country selector: every country starts selected, and
  clicking one toggles it. Only the five data countries (UK, US, Germany,
  France, Japan) have holiday data — they're marked with a dark outline. The
  others are still selectable, and the list says plainly that there's no data
  for them. "Select all" and "Clear" reset the whole map.
- Small countries are hard to click on the map, so there's also a **search
  box**: type a name (e.g. "Luxembourg") and tick or untick it from the
  results. It stays in sync with the map.
- Your **country selection is remembered** the next time you open it (via the
  browser's localStorage, which works from a local file). The month and day
  are *not* remembered — those always open on today. If the browser blocks
  storage (some private windows), it simply doesn't remember; nothing breaks.
  "Select all" resets the selection back to every country.
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
- Religious holidays (Easter, Eid, Diwali, Holi, Hanukkah, Rosh Hashanah, Yom
  Kippur, Passover, Vesak) are shown in their own section, with the religion
  named. They're shown generally (worldwide) rather than per country, since
  they aren't bank holidays in most of the five. Moon-dependent dates (Eid,
  Diwali, Holi, Vesak) are flagged "±1 day" — they depend on moon sighting or
  regional custom and can fall a day earlier or later.

## Development (optional)

- `npm i` — installs `playwright-core` (test-only dependency)
- `npm test` — core logic tests (Node's built-in test runner, no extra deps)
- `npm run test:browser` — UI smoke test in headless Chromium
  (`CHROMIUM=/path/to/chromium npm run test:browser`)
- `npm run build:data` — refresh the holiday data and the world map (needs
  internet; regenerates `app/holidays.js` and `app/map-paths.js` — commit the
  result). Bank holidays come from
  [date.nager.at](https://date.nager.at); school holidays from
  [schulferien.org](https://www.schulferien.org) (Germany, France) and
  [education-ni.gov.uk](https://www.education-ni.gov.uk) (Northern Ireland).
  The French zones are cross-checked against the official
  [service-public.gouv.fr](https://www.service-public.gouv.fr) calendar. The
  map is generated from the free
  [world-atlas](https://github.com/topojson/world-atlas) (Natural Earth)
  country shapes, projected with `d3-geo`.

## Known limitations

- Data covers 2024–2028 only (2028 is only covered by German school holidays
  that run into January).
- School holidays: Germany (all 16 states) and France (zones A/B/C + Corsica)
  are complete; the UK is Northern Ireland only; the US and Japan have no
  national school calendar, so the app shows a note instead. The French
  2027/28 calendar is not published yet, so autumn/Christmas 2027 are missing.
- Bank holidays are nationwide: German state holidays (Corpus Christi,
  Reformation Day, …) and US state holidays are not in the data.
- The world map lists every country, but only the five above have holiday
  data; selecting any other country just adds a "no holiday data" note.
- The data source sometimes lists only the observed date when a holiday falls
  on a weekend (e.g. US Independence Day 2026 shows on 3 July).
- Religious dates for 2024–2028 are computed (Easter computus, tabular
  Islamic calendar, Hebrew calendar, and astronomical moon phases for the
  Hindu/Buddhist ones) and cross-checked against published dates. The
  moon-dependent ones are inherently ±1 day: e.g. Diwali can fall on the
  first or second new moon of Oct–Nov depending on region, and Vesak can
  differ by a day between countries (Singapore vs India).
