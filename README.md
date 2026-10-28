# Holiday map

A tiny self-contained browser applet: open a calendar, pick a day or a range
of days, and see the bank, school and religious holidays on those days in
225 countries. A world map (plus a search box) lets you narrow the list to
the countries you care about. Built for people who keep getting caught out
by other countries' holidays when booking calls and trips.

## Running it (nothing to install)

1. Copy the `app/` folder somewhere (e.g. the desktop).
2. **Windows:** double-click `app/index.html` — it opens in the default browser (Edge).
3. **Linux:** double-click it in the file manager, or run `xdg-open app/index.html`.

That's all — no internet, no server, no Node/Python. The holiday data
(2024–2028) is baked into `app/holidays.js`.

## Using it

- The calendar opens on the current month with today selected.
- Coloured dots mark days that have holidays (one colour per country). With
  many countries selected a day can have more dots than fit, so at most 12
  are drawn and a small "+N" chip carries the rest (hover it for the count).
- The world map is the country selector: every country starts selected, and
  clicking one toggles it. 225 countries have holiday data — they're marked
  with a dark outline. The rest (14 entries — mostly territories, plus
  regions like Somaliland and Kosovo) are still selectable, and the list
  says plainly that there's no data for them. "Select all" and "Clear" reset
  the whole map.
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
- With many countries selected, same-named holidays are grouped into one
  expandable line (e.g. "Christmas Day · 128 countries") instead of one row
  per country; groups of up to three countries are open by default.
- UK entries are labelled by region where a holiday only applies to part of
  the UK; German entries carry a note where they don't apply nationwide.
- School holidays are listed as date ranges and always carry their region
  (German state, French zone, Northern Ireland); identical breaks are merged
  into one line ("3 regions: …"). School data exists only for Germany,
  France and Northern Ireland; for every other selected country the app says
  plainly that there's no school-holiday data (one summary line, because most
  countries have no national school calendar — e.g. the US, Japan and
  England/Scotland/Wales set their breaks locally).
- Religious holidays (Easter, Eid, Diwali, Holi, Hanukkah, Rosh Hashanah, Yom
  Kippur, Passover, Vesak) are shown in their own section, with the religion
  named. They're shown generally (worldwide) rather than per country, since
  they aren't bank holidays in most countries. Moon-dependent dates (Eid,
  Diwali, Holi, Vesak) are flagged "±1 day" — they depend on moon sighting or
  regional custom and can fall a day earlier or later.

## Development (optional)

- `npm i` — installs `playwright-core` (test-only dependency)
- `npm test` — core logic tests (Node's built-in test runner, no extra deps)
- `npm run test:browser` — UI smoke test in headless Chromium
  (`CHROMIUM=/path/to/chromium npm run test:browser`)
- `npm run build:data` — refresh the holiday data and the world map (needs
  internet; regenerates `app/holidays.js` and `app/map-paths.js` — commit the
  result). Also needs a uv-managed `.venv` with the
  [`holidays`](https://github.com/vacanza/holidays) package installed
  (`uv venv .venv && uv pip install --python .venv/bin/python holidays`).
  Bank holidays come from three free keyless sources, baked in at build
  time: [date.nager.at](https://date.nager.at) (194 map countries,
  nationwide holidays only), the npm
  [`date-holidays`](https://github.com/mohammadghousey/date-holidays)
  package (10 more: Azerbaijan, Brunei, Fiji, Iran, Israel, Pakistan, Taiwan,
  UAE, Uzbekistan, Western Sahara) and the Python
  [`holidays`](https://github.com/vacanza/holidays) package (21 more, incl.
  India, Saudi Arabia, Thailand, Indonesia, Malaysia). School holidays from
  [schulferien.org](https://www.schulferien.org) (Germany, France) and
  [education-ni.gov.uk](https://www.education-ni.gov.uk) (Northern Ireland).
  The French zones are cross-checked against the official
  [service-public.gouv.fr](https://www.service-public.gouv.fr) calendar. The
  map is generated from the free
  [world-atlas](https://github.com/topojson/world-atlas) (Natural Earth, 50m
  resolution so small countries like Singapore and Malta are on the map)
  country shapes, projected with `d3-geo`.

## Known limitations

- Data covers 2024–2028 only (2028 is only covered by German school holidays
  that run into January).
- School holidays: only Germany (all 16 states), France (zones A/B/C +
  Corsica) and Northern Ireland have data; every other country is covered by
  the "no school-holiday data" note. The French 2027/28 calendar is not
  published yet, so autumn/Christmas 2027 are missing.
- Bank holidays are nationwide: German state holidays (Corpus Christi,
  Reformation Day, …), US state holidays and similar regional days are not in
  the data.
- The world map has 239 entries; 14 of them (territories such as Guam and
  Macau, plus Somaliland, Kosovo, N. Cyprus and similar regions) have no free
  data source; selecting one just adds a "no holiday data" note. Two
  sovereign states — Mauritius and Maldives — are on the map but also lack a
  free source.
- The data source sometimes lists only the observed date when a holiday falls
  on a weekend (e.g. US Independence Day 2026 shows on 3 July).
- Where two sources cover the same moon-dependent holiday they can differ by
  a day (e.g. Eid al-Fitr 2026: 20 March via date-holidays for the UAE,
  21 March via nager.at for Singapore); both dates are shown as the sources
  give them.
- Religious dates for 2024–2028 are computed (Easter computus, tabular
  Islamic calendar, Hebrew calendar, and astronomical moon phases for the
  Hindu/Buddhist ones) and cross-checked against published dates. The
  moon-dependent ones are inherently ±1 day: e.g. Diwali can fall on the
  first or second new moon of Oct–Nov depending on region, and Vesak can
  differ by a day between countries (Singapore vs India).
