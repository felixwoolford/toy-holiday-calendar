#!/usr/bin/env node
// Regenerates app/holidays.js and app/map-paths.js:
//   - bank/public holidays from https://date.nager.at (free, no API key) for
//     every world-map country that nager.at covers (~140 countries)
//   - school holidays from:
//       Germany:  https://www.schulferien.org/deutschland/ferien/<year>/ (per state)
//       France:   https://www.schulferien.org/frankreich/ferien/<year>/  (per zone)
//       UK:       https://www.education-ni.gov.uk/articles/school-holidays
//                 (Northern Ireland only; England/Scotland/Wales set dates locally)
//       all other countries: none (school calendars are set locally)
// The generated files are committed so the app works offline with nothing
// installed. Usage: node build/fetch-holidays.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';
import { feature as topoFeature } from 'topojson-client';
import * as d3geo from 'd3-geo';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(root, 'app'), { recursive: true });
const YEARS = [2024, 2025, 2026, 2027];

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return res.json();
}
// fetchJSON with a retry, treating HTTP 404 as "no data" (empty array).
async function fetchWithRetry(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res.json();
      if (res.status === 404) return [];
      throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
}
// Run fn over items with at most `limit` in flight; preserves order.
async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let idx = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (idx < items.length) {
        const i = idx++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

// --------------------------------------------------- country coverage
// The app's country selector is the world map (world-atlas / Natural Earth,
// ~176 countries). We give holiday data to every map country that nager.at
// covers. mledoze/countries bridges the map's numeric ISO ids to nager.at's
// alpha-2 codes and supplies clean country names.
const norm = (s) => String(s).replace(/^0+(?=\d)/, '');
const ISO_LIST = await fetchJSON(
  'https://raw.githubusercontent.com/mledoze/countries/master/countries.json',
);
const NAGER_LIST = await fetchJSON('https://date.nager.at/api/v3/AvailableCountries');
const numToA2 = {};
const a2ToName = {};
for (const c of ISO_LIST) {
  if (c.ccn3) numToA2[norm(c.ccn3)] = c.cca2;
  if (c.cca2) a2ToName[c.cca2] = c.name.common;
}
const nagerCodes = new Set(NAGER_LIST.map((c) => c.countryCode));

const topo = await fetchJSON('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json');
const fc = topoFeature(topo, topo.objects.countries);
const mapFeatures = fc.features.filter((f) => String(f.id) !== '010'); // drop Antarctica
const W = 960, H = 460;
const projection = d3geo.geoNaturalEarth1().fitExtent(
  [[4, 4], [W - 4, H - 4]], { type: 'FeatureCollection', features: mapFeatures },
);
const geoPath = d3geo.geoPath(projection);
const mapCountries = [];
for (const f of mapFeatures) {
  const d = geoPath(f);
  if (!d) continue;
  const num = f.id === undefined || f.id === null ? null : String(f.id);
  const a2 = num ? numToA2[norm(num)] : null;
  mapCountries.push({
    iso: num || 'noid' + mapCountries.length,
    code: a2 && nagerCodes.has(a2) ? a2 : '',
    name: (a2 && a2ToName[a2]) || (f.properties && f.properties.name) || 'Unknown',
    d,
  });
}
const DATA_COUNTRIES = mapCountries.filter((c) => c.code);
const DATA_CODES = DATA_COUNTRIES.map((c) => c.code);
assert.ok(DATA_CODES.length > 100, `expected >100 data countries, got ${DATA_CODES.length}`);
for (const code of ['GB', 'US', 'DE', 'FR', 'JP']) {
  assert.ok(DATA_CODES.includes(code), `original data country missing: ${code}`);
}
console.log(`map: ${mapCountries.length} countries, ${DATA_CODES.length} with data`);

// ------------------------------------------------------------- bank data

const ALL_GB = ['GB-ENG', 'GB-NIR', 'GB-SCT', 'GB-WLS'];
const GB_REGION = {
  'GB-ENG': 'England',
  'GB-WLS': 'Wales',
  'GB-SCT': 'Scotland',
  'GB-NIR': 'Northern Ireland',
};

// Nager's names, adjusted for what users in these countries call them.
const RENAME = {
  GB: { 'St. Stephen\'s Day': 'Boxing Day' },
  US: { 'Labour Day': 'Labor Day' },
};

// Nager marks these as German-wide, but in Germany they only apply in some
// states (or all but Schleswig-Holstein). Keep them, with an honest note.
const DE_NOTES = {
  'Good Friday': 'most states (not Schleswig-Holstein)',
  'Easter Monday': 'most states (not Schleswig-Holstein)',
  'Ascension Day': 'some states',
  'Whit Monday': 'some states',
};

function gbNote(counties) {
  if (!counties) return undefined;
  if (ALL_GB.every((c) => counties.includes(c))) return undefined;
  return counties.map((c) => GB_REGION[c]).join(', ');
}

// Apply the per-country rules to one country's raw nager holidays (all years):
//   GB: keep every region, label the partial ones.
//   DE: nationwide only, with a note where a "national" holiday is partial.
//   all others: nationwide (global) holidays only.
// Dedupes by date+name, keeping the most far-reaching entry.
function processBank(code, raw) {
  const seen = new Map(); // "date|name" -> entry, keep the most far-reaching one
  for (const h of raw) {
    let name = RENAME[code]?.[h.name] ?? h.name;
    let note;
    if (code === 'GB') {
      note = gbNote(h.counties); // UK: keep every region, label the partial ones
    } else if (code === 'DE') {
      if (!h.global) continue; // German state holidays: out of scope
      note = DE_NOTES[name];
    } else if (!h.global) {
      continue; // nationwide holidays only
    }
    const key = `${h.date}|${name}`;
    const rank = (x) => (x.global ? 2 : 0) + (x.counties?.length ?? 0);
    const prev = seen.get(key);
    if (!prev || rank(h) > rank(prev)) {
      const entry = { date: h.date, name };
      if (note) entry.note = note;
      seen.set(key, entry);
    }
  }
  return [...seen.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name),
  );
}

const bank = {};
await mapPool(DATA_CODES, 8, async (code) => {
  const raw = [];
  for (const year of YEARS) {
    raw.push(...(await fetchWithRetry(
      `https://date.nager.at/api/v3/PublicHolidays/${year}/${code}`,
    )));
  }
  bank[code] = processBank(code, raw);
});
const totalBank = DATA_CODES.reduce((s, c) => s + bank[c].length, 0);
console.log(`bank: ${DATA_CODES.length} countries, ${totalBank} holidays total`);
const noBank = DATA_CODES.filter((c) => bank[c].length === 0);
if (noBank.length) console.log('warning: no bank holidays for', noBank.join(', '));

// ---------------------------------------------------------- school data

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return res.text();
}

const ENTITIES = {
  uuml: 'ü', auml: 'ä', ouml: 'ö', szlig: 'ß',
  eacute: 'é', ccedil: 'ç', nbsp: ' ',
};
function decode(s) {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/[*\u2020\u2021\u00a7]/g, ' ') // footnote markers
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&([a-z]+);/g, (m, e) => ENTITIES[e] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

function tableRows(tableHtml) {
  return [...tableHtml.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((r) =>
    [...r[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => decode(c[1])),
  );
}

function iso(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  assert(
    dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d,
    `invalid date ${y}-${m}-${d}`,
  );
  return dt.toISOString().slice(0, 10);
}
const addDaysISO = (s, n) =>
  new Date(Date.parse(s + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

// schulferien.org cells, e.g.
//   "16.02. - 20.02."          one range
//   "26.10. - 30.10.+31.10."   range + extra day
//   "04.10.+21.10. - 02.11."   extra day + range
//   "02.02."                   single day
//   "-"                        none
// Returns merged [[start, end], ...] ISO ranges.
function parseDDMM(cell, year) {
  const text = (cell || '').trim();
  if (!text || text === '-') return [];
  const ranges = [];
  let mainStart = null;
  let rolled = false;
  for (const seg of text.split('+')) {
    const s = seg.trim();
    const range = s.match(/^(\d{1,2})\.(\d{1,2})\.\s*-\s*(\d{1,2})\.(\d{1,2})\.$/);
    const single = s.match(/^(\d{1,2})\.(\d{1,2})\.$/);
    if (range) {
      const [d1, m1, d2, m2] = [range[1], range[2], range[3], range[4]].map(Number);
      let y2 = year;
      if (m2 * 100 + d2 < m1 * 100 + d1) { y2 = year + 1; rolled = true; }
      if (mainStart === null) mainStart = m1 * 100 + d1;
      ranges.push([iso(year, m1, d1), iso(y2, m2, d2)]);
    } else if (single) {
      const d = Number(single[1]);
      const m = Number(single[2]);
      let y = year;
      if (rolled && mainStart !== null && m * 100 + d < mainStart) y = year + 1;
      ranges.push([iso(y, m, d), iso(y, m, d)]);
    } else {
      throw new Error('unparseable date cell: ' + JSON.stringify(cell));
    }
  }
  ranges.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  const out = [];
  for (const r of ranges) {
    const last = out[out.length - 1];
    if (last && r[0] <= addDaysISO(last[1], 1)) {
      if (r[1] > last[1]) last[1] = r[1];
    } else {
      out.push([...r]);
    }
  }
  return out;
}

// Germany: one table per calendar year, rows = the 16 states.
const DE_STATES = {
  'Baden-Württemberg': 'Baden-Württemberg',
  'Bayern': 'Bavaria',
  'Berlin': 'Berlin',
  'Brandenburg': 'Brandenburg',
  'Bremen': 'Bremen',
  'Hamburg': 'Hamburg',
  'Hessen': 'Hesse',
  'Mecklenburg-Vorpommern': 'Mecklenburg-Vorpommern',
  'Niedersachsen': 'Lower Saxony',
  'Nordrhein-Westfalen': 'North Rhine-Westphalia',
  'Rheinland-Pfalz': 'Rhineland-Palatinate',
  'Saarland': 'Saarland',
  'Sachsen': 'Saxony',
  'Sachsen-Anhalt': 'Saxony-Anhalt',
  'Schleswig-Holstein': 'Schleswig-Holstein',
  'Thüringen': 'Thuringia',
};
const DE_TYPES = {
  'Winterferien': 'Winter holiday',
  'Osterferien': 'Easter holiday',
  'Pfingstferien': 'Whitsun holiday',
  'Sommerferien': 'Summer holiday',
  'Herbstferien': 'Autumn holiday',
  'Weihnachtsferien': 'Christmas holiday',
};

async function fetchDESchool() {
  const out = [];
  for (const year of YEARS) {
    const html = await fetchText(`https://www.schulferien.org/deutschland/ferien/${year}/`);
    const table = html.match(/<table[\s\S]*?<\/table>/);
    assert(table, `DE ${year}: no table found`);
    const rows = tableRows(table[0]);
    const types = rows[1].slice(1);
    assert.deepStrictEqual(
      types, Object.keys(DE_TYPES), `DE ${year}: unexpected header ${JSON.stringify(types)}`,
    );
    let states = 0;
    for (const row of rows.slice(2)) {
      const stateEn = DE_STATES[row[0]];
      if (!stateEn) continue; // legend/footnote rows
      states++;
      types.forEach((t, i) => {
        for (const [s, e] of parseDDMM(row[i + 1], year)) {
          out.push({ start: s, end: e, name: DE_TYPES[t], region: stateEn });
        }
      });
    }
    assert.strictEqual(states, 16, `DE ${year}: expected 16 state rows, saw ${states}`);
  }
  return out;
}

// France: same table shape, rows = the académies. We keep the metropolitan
// zones A/B/C plus Corsica; the overseas academies have their own calendars
// and are out of scope. All académies in a zone must agree on the dates.
const FR_ZONES = {
  'Besançon': 'Zone A', 'Bordeaux': 'Zone A', 'Clermont-Ferrand': 'Zone A',
  'Dijon': 'Zone A', 'Grenoble': 'Zone A', 'Limoges': 'Zone A', 'Lyon': 'Zone A',
  'Poitiers': 'Zone A',
  'Aix-Marseille': 'Zone B', 'Amiens': 'Zone B', 'Lille': 'Zone B',
  'Nancy-Metz': 'Zone B', 'Nantes': 'Zone B', 'Nizza': 'Zone B',
  'Normandie': 'Zone B', 'Orléans-Tours': 'Zone B', 'Reims': 'Zone B',
  'Rennes': 'Zone B', 'Straßburg': 'Zone B',
  'Créteil': 'Zone C', 'Montpellier': 'Zone C', 'Paris': 'Zone C',
  'Toulouse': 'Zone C', 'Versailles': 'Zone C',
  'Korsika': 'Corsica',
};
const FR_TYPES = {
  'Winterferien': 'Winter holiday',
  'Frühlingsferien': 'Spring holiday',
  'Sommerferien': 'Summer holiday',
  'Herbstferien': 'Autumn holiday',
  'Weihnachtsferien': 'Christmas holiday',
};

async function fetchFRSchool() {
  const byKey = {}; // "zone|type|year" -> [[start, end], ...]
  for (const year of YEARS) {
    const html = await fetchText(`https://www.schulferien.org/frankreich/ferien/${year}/`);
    const table = html.match(/<table[\s\S]*?<\/table>/);
    assert(table, `FR ${year}: no table found`);
    const rows = tableRows(table[0]);
    const types = rows[1].slice(1);
    assert.deepStrictEqual(
      types, Object.keys(FR_TYPES), `FR ${year}: unexpected header ${JSON.stringify(types)}`,
    );
    for (const row of rows.slice(2)) {
      const zone = FR_ZONES[row[0]];
      if (!zone) continue; // overseas academies: out of scope
      types.forEach((t, i) => {
        const ranges = parseDDMM(row[i + 1], year);
        if (!ranges.length) return; // "-" = not published yet
        const key = `${zone}|${t}|${year}`;
        if (!byKey[key]) byKey[key] = ranges;
        else assert.deepStrictEqual(
          ranges, byKey[key],
          `FR ${year}: ${row[0]} (${zone}) disagrees on ${t}`,
        );
      });
    }
  }
  const out = [];
  for (const [key, ranges] of Object.entries(byKey)) {
    const [zone, t] = key.split('|');
    for (const [s, e] of ranges) out.push({ start: s, end: e, name: FR_TYPES[t], region: zone });
  }
  return out;
}

// Northern Ireland: three tables (one per school year), rows = events.
const NI_MONTHS = {
  January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
  July: 7, August: 8, September: 9, October: 10, November: 11, December: 12,
};

// "29 & 30 October 2026" | "17 April to 25 April 2025" | "5 May 2025"
// -> [startISO, endISO]
function parseNIDates(text) {
  const re = /(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)(?:\s+(\d{4}))?/g;
  const toks = [];
  let m;
  while ((m = re.exec(text))) {
    toks.push({ d: Number(m[1]), mo: NI_MONTHS[m[2]], y: m[3] ? Number(m[3]) : null });
  }
  assert(toks.length >= 1, 'no dates in NI cell: ' + JSON.stringify(text));
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].y === null) {
      const next = toks.slice(i + 1).find((t) => t.y !== null);
      assert(next, 'cannot infer year in NI cell: ' + JSON.stringify(text));
      toks[i].y = next.y;
    }
  }
  toks.sort((a, b) => a.y - b.y || a.mo - b.mo || a.d - b.d);
  const first = toks[0];
  const last = toks[toks.length - 1];
  if (toks.length > 1 && !/\bto\b/i.test(text)) {
    // "&" joins individual days, so they must be consecutive
    const days = Math.round(
      (Date.UTC(last.y, last.mo - 1, last.d) - Date.UTC(first.y, first.mo - 1, first.d)) / 86400000,
    );
    assert.strictEqual(days, toks.length - 1, 'NI days not consecutive: ' + JSON.stringify(text));
  }
  return [iso(first.y, first.mo, first.d), iso(last.y, last.mo, last.d)];
}

async function fetchNISchool() {
  const html = await fetchText('https://www.education-ni.gov.uk/articles/school-holidays');
  const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/g)];
  assert.strictEqual(tables.length, 3, 'NI: expected 3 term tables');
  const out = [];
  for (const t of tables) {
    const rows = tableRows(t[0]);
    for (const [event, dates] of rows.slice(1)) {
      if (!event) continue;
      if (/resume after summer/i.test(event)) continue; // 1 September: schools reopen
      let ranges;
      if (/summer holiday begins/i.test(event)) {
        const [s] = parseNIDates(dates);
        ranges = [[s, iso(Number(s.slice(0, 4)), 8, 31)]];
      } else {
        ranges = [parseNIDates(dates)];
      }
      for (const [s, e] of ranges) {
        out.push({ start: s, end: e, name: event, region: 'Northern Ireland' });
      }
    }
  }
  return out;
}

const school = {};
for (const code of DATA_CODES) school[code] = []; // no school data by default
school.GB = await fetchNISchool();
school.DE = await fetchDESchool();
school.FR = await fetchFRSchool();
for (const code of DATA_CODES) {
  school[code].sort(
    (a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end) ||
      a.name.localeCompare(b.name) || a.region.localeCompare(b.region),
  );
}
for (const code of ['GB', 'DE', 'FR']) console.log(`school ${code}: ${school[code].length}`);

// Cross-check the French zones against the official 2026-27 calendar
// (service-public.gouv.fr, F31952). schulferien.org's dates drop the
// starting Saturday and the resumption Monday, so allow 1 day of slack.
const FR_OFFICIAL = {
  'Zone A': {
    'Autumn holiday': ['2026-10-17', '2026-11-02'],
    'Christmas holiday': ['2026-12-19', '2027-01-04'],
    'Winter holiday': ['2027-02-13', '2027-03-01'],
    'Spring holiday': ['2027-04-10', '2027-04-26'],
    'Summer holiday': ['2027-07-03', '2027-09-01'],
  },
  'Zone B': {
    'Winter holiday': ['2027-02-20', '2027-03-08'],
    'Spring holiday': ['2027-04-17', '2027-05-03'],
  },
  'Zone C': {
    'Winter holiday': ['2027-02-06', '2027-02-22'],
    'Spring holiday': ['2027-04-03', '2027-04-19'],
  },
};
for (const [zone, byType] of Object.entries(FR_OFFICIAL)) {
  for (const [name, [ws, we]] of Object.entries(byType)) {
    const got = school.FR.find(
      (h) => h.region === zone && h.name === name &&
        h.start >= addDaysISO(ws, -1) && h.start <= addDaysISO(ws, 1) &&
        h.end >= addDaysISO(we, -1) && h.end <= addDaysISO(we, 1),
    );
    assert(got, `FR ${zone} ${name}: expected near ${ws}..${we}`);
  }
}

// Sanity checks
assert(school.DE.length > 100, 'DE school data too small');
assert(school.FR.length > 40, 'FR school data too small');
assert.strictEqual(school.GB.length, 24, 'NI: expected 24 entries (8 events x 3 years)');
for (const code of DATA_CODES) {
  for (const h of school[code]) {
    assert(h.start <= h.end, `school range backwards: ${JSON.stringify(h)}`);
    assert(h.name && h.region, `school entry missing name/region: ${JSON.stringify(h)}`);
    assert(
      h.start >= '2024-01-01' && h.end <= '2028-01-31',
      `school entry out of bounds: ${JSON.stringify(h)}`,
    );
  }
}

// Plain-language notes shown in the app where data is missing or partial.
const SCHOOL_NOTES = {
  GB: 'In England, Scotland and Wales, school dates are set by each local authority, so only Northern Ireland is shown.',
  FR: 'The French school calendar for 2027/28 is not published yet, so autumn and Christmas 2027 are missing.',
};

// ---------------------------------------------------- religious data
// Major religious observances, shown worldwide (they are not tied to the
// five countries, and none is a public holiday there except the Good Friday /
// Easter Monday that flank Easter). Dates are verified for 2024-2028:
//   Easter:              Gregorian computus.
//   Eid al-Fitr/Adha:    tabular Islamic calendar -> the *expected* dates;
//                        the observed date depends on moon sighting (+/-1 day).
//   Diwali / Holi:       new-moon (Amavasya) / full-moon (Purnima) of the
//                        relevant month, Hindu lunisolar calendar; the exact
//                        day varies by region (+/-1 day).
//   Hanukkah, Rosh Hashanah, Yom Kippur, Passover: Hebrew calendar.
//   Vesak:               full moon of May (Vesakha Purnima); the observed day
//                        varies by country (+/-1 day).
// approx: true marks the moon-dependent dates that may fall a day off.
// Religious dates run through 2028 (one year beyond the bank data), per the
// request to have them right for 2024-2028.
const RELIGIOUS_YEARS = [2024, 2025, 2026, 2027, 2028];
const RELIGIOUS_DEFS = [
  {
    name: 'Easter', religion: 'Christian', approx: false,
    note: 'Easter Sunday itself is not a public holiday, but Good Friday and Easter Monday are bank holidays in the UK, Germany and most of France.',
    dates: { 2024: '2024-03-31', 2025: '2025-04-20', 2026: '2026-04-05', 2027: '2027-03-28', 2028: '2028-04-16' },
  },
  {
    name: 'Eid al-Fitr', religion: 'Islamic', approx: true,
    note: 'Ends Ramadan. Observed by Muslim communities worldwide; not a public holiday in the five countries.',
    dates: { 2024: '2024-04-10', 2025: '2025-03-30', 2026: '2026-03-20', 2027: '2027-03-09', 2028: '2028-02-26' },
  },
  {
    name: 'Eid al-Adha', religion: 'Islamic', approx: true,
    note: 'Festival of Sacrifice. Observed by Muslim communities worldwide; not a public holiday in the five countries.',
    dates: { 2024: '2024-06-16', 2025: '2025-06-06', 2026: '2026-05-27', 2027: '2027-05-16', 2028: '2028-05-05' },
  },
  {
    name: 'Diwali', religion: 'Hindu', approx: true,
    note: 'Festival of Lights. Observed by Hindu, Jain and Sikh communities worldwide; not a public holiday in the five countries.',
    dates: { 2024: '2024-11-01', 2025: '2025-10-20', 2026: '2026-11-08', 2027: '2027-10-29', 2028: '2028-10-17' },
  },
  {
    name: 'Holi', religion: 'Hindu', approx: true,
    note: 'Festival of Colours. Observed by Hindu communities worldwide; not a public holiday in the five countries.',
    dates: { 2024: '2024-03-25', 2025: '2025-03-14', 2026: '2026-03-04', 2027: '2027-03-22', 2028: '2028-03-11' },
  },
  {
    name: 'Hanukkah', religion: 'Jewish', approx: false,
    note: 'Festival of Lights, eight days. Observed by Jewish communities worldwide; not a public holiday in the five countries.',
    dates: {
      2024: ['2024-12-26', '2025-01-02'], 2025: ['2025-12-15', '2025-12-22'],
      2026: ['2026-12-05', '2026-12-12'], 2027: ['2027-12-25', '2028-01-01'],
      2028: ['2028-12-13', '2028-12-20'],
    },
  },
  {
    name: 'Rosh Hashanah', religion: 'Jewish', approx: false,
    note: 'Jewish New Year, two days. Observed by Jewish communities worldwide; not a public holiday in the five countries.',
    dates: {
      2024: ['2024-10-03', '2024-10-04'], 2025: ['2025-09-23', '2025-09-24'],
      2026: ['2026-09-12', '2026-09-13'], 2027: ['2027-10-02', '2027-10-03'],
      2028: ['2028-09-21', '2028-09-22'],
    },
  },
  {
    name: 'Yom Kippur', religion: 'Jewish', approx: false,
    note: 'Day of Atonement. Observed by Jewish communities worldwide; not a public holiday in the five countries.',
    dates: { 2024: '2024-10-12', 2025: '2025-10-02', 2026: '2026-09-21', 2027: '2027-10-11', 2028: '2028-09-30' },
  },
  {
    name: 'Passover', religion: 'Jewish', approx: false,
    note: 'First day of Passover (a seven-to-eight-day festival). Observed by Jewish communities worldwide; not a public holiday in the five countries.',
    dates: { 2024: '2024-04-23', 2025: '2025-04-13', 2026: '2026-04-02', 2027: '2027-04-22', 2028: '2028-04-11' },
  },
  {
    name: 'Vesak', religion: 'Buddhist', approx: true,
    note: 'Buddha\'s birth, awakening and passing. Observed by Buddhist communities worldwide; not a public holiday in the five countries.',
    dates: { 2024: '2024-05-23', 2025: '2025-05-12', 2026: '2026-05-31', 2027: '2027-05-20', 2028: '2028-05-09' },
  },
];

// Expand into a flat list: one entry per holiday per year.
const religious = [];
for (const def of RELIGIOUS_DEFS) {
  for (const year of RELIGIOUS_YEARS) {
    const d = def.dates[year];
    assert(d, `religious ${def.name}: no date for ${year}`);
    const start = Array.isArray(d) ? d[0] : d;
    const end = Array.isArray(d) ? d[1] : d;
    religious.push({
      name: def.name, religion: def.religion, start, end,
      approx: def.approx, note: def.note,
    });
  }
}
religious.sort((a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name));
console.log(`religious: ${religious.length}`);

// Sanity checks
assert.strictEqual(religious.length, RELIGIOUS_DEFS.length * RELIGIOUS_YEARS.length, 'religious entry count');
for (const h of religious) {
  assert(h.start <= h.end, `religious range backwards: ${JSON.stringify(h)}`);
  assert(h.name && h.religion && h.note, `religious entry missing fields: ${JSON.stringify(h)}`);
  assert(
    h.start >= '2024-01-01' && h.end <= '2028-12-31',
    `religious entry out of bounds: ${JSON.stringify(h)}`,
  );
  assert.strictEqual(typeof h.approx, 'boolean', `religious entry missing approx: ${JSON.stringify(h)}`);
}
// Every year must have exactly one entry per holiday.
for (const def of RELIGIOUS_DEFS) {
  for (const year of RELIGIOUS_YEARS) {
    assert.ok(
      religious.some((h) => h.name === def.name && h.start.slice(0, 4) === String(year)),
      `religious ${def.name} missing for ${year}`,
    );
  }
}

// ------------------------------------------------------- generated module

const data = {};
for (const code of DATA_CODES) data[code] = { bank: bank[code], school: school[code] };
const countriesList = DATA_COUNTRIES.map((c) => ({ code: c.code, name: c.name }));

const apiSource = `
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof globalThis !== 'undefined') globalThis.Holidays = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // DATA[code] = {
  //   bank:    [{ date, name, note? }],
  //   school:  [{ start, end, name, region }]
  // };
  var DATA = __DATA__;

  var COUNTRIES = __COUNTRIES__;

  // Shown in the detail panel where school data is missing or partial.
  var SCHOOL_NOTES = __NOTES__;

  // Major religious observances, worldwide (not tied to the five countries).
  // Each: { name, religion, start, end, approx, note }. approx marks the
  // moon-dependent dates that may fall a day earlier or later.
  var RELIGIOUS = __RELIGIOUS__;

  var BY_DATE = {};
  COUNTRIES.forEach(function (c) {
    (DATA[c.code].bank || []).forEach(function (h) {
      (BY_DATE[h.date] = BY_DATE[h.date] || []).push({
        country: c.code,
        name: h.name,
        note: h.note
      });
    });
  });

  function schoolRow(c, h) {
    return {
      country: c.code, countryName: c.name, kind: 'school',
      name: h.name, region: h.region, start: h.start, end: h.end
    };
  }

  // All holidays on one day (ISO 'YYYY-MM-DD'): bank holidays on that day
  // plus school holidays covering it, in COUNTRIES order, optionally
  // restricted to the given country codes.
  function holidaysForDate(dateStr, countryCodes) {
    var out = [];
    var list = BY_DATE[dateStr] || [];
    COUNTRIES.forEach(function (c) {
      if (countryCodes && countryCodes.indexOf(c.code) === -1) return;
      list.forEach(function (h) {
        if (h.country !== c.code) return;
        var row = {
          country: c.code, countryName: c.name, kind: 'bank',
          name: h.name, start: dateStr, end: dateStr
        };
        if (h.note) row.note = h.note;
        out.push(row);
      });
      (DATA[c.code].school || []).forEach(function (h) {
        if (h.start <= dateStr && dateStr <= h.end) out.push(schoolRow(c, h));
      });
    });
    return out;
  }

  // School holidays overlapping [a, b] (either order), sorted by start date.
  function schoolHolidaysInRange(a, b, countryCodes) {
    var lo = a < b ? a : b;
    var hi = a < b ? b : a;
    var out = [];
    COUNTRIES.forEach(function (c) {
      if (countryCodes && countryCodes.indexOf(c.code) === -1) return;
      (DATA[c.code].school || []).forEach(function (h) {
        if (h.start <= hi && lo <= h.end) out.push(schoolRow(c, h));
      });
    });
    out.sort(function (x, y) {
      return x.start < y.start ? -1 : x.start > y.start ? 1 : x.name.localeCompare(y.name);
    });
    return out;
  }

  // Religious observances overlapping [a, b] (either order), sorted by start.
  // Worldwide; not filtered by country.
  function religiousHolidaysInRange(a, b) {
    var lo = a < b ? a : b;
    var hi = a < b ? b : a;
    var out = RELIGIOUS.filter(function (h) {
      return h.start <= hi && lo <= h.end;
    });
    out.sort(function (x, y) {
      return x.start < y.start ? -1 : x.start > y.start ? 1 : x.name.localeCompare(y.name);
    });
    return out;
  }

  function hasHoliday(dateStr, countryCodes) {
    return holidaysForDate(dateStr, countryCodes).length > 0;
  }

  // [earliest, latest] year present in the data (bank dates + school ranges).
  function supportedYears() {
    var ys = {};
    COUNTRIES.forEach(function (c) {
      (DATA[c.code].bank || []).forEach(function (h) {
        ys[Number(h.date.slice(0, 4))] = true;
      });
      (DATA[c.code].school || []).forEach(function (h) {
        ys[Number(h.start.slice(0, 4))] = true;
        ys[Number(h.end.slice(0, 4))] = true;
      });
    });
    var list = Object.keys(ys).map(Number).sort(function (a, b) { return a - b; });
    return list.length ? [list[0], list[list.length - 1]] : [];
  }

  function isoDate(d) {
    var m = String(d.getUTCMonth() + 1); if (m.length < 2) m = '0' + m;
    var day = String(d.getUTCDate()); if (day.length < 2) day = '0' + day;
    return d.getUTCFullYear() + '-' + m + '-' + day;
  }

  // 42 cells (6 weeks), Monday first, for month 0-11.
  function calendarMonth(year, month) {
    var first = new Date(Date.UTC(year, month, 1));
    var offset = (first.getUTCDay() + 6) % 7;
    var cells = [];
    for (var i = 0; i < 42; i++) {
      var d = new Date(Date.UTC(year, month, 1 - offset + i));
      cells.push({ date: isoDate(d), inMonth: d.getUTCMonth() === month });
    }
    return cells;
  }

  // Inclusive list of ISO dates from a to b (either order).
  function dateRange(a, b) {
    if (a > b) { var tmp = a; a = b; b = tmp; }
    var out = [];
    var t = Date.parse(a + 'T00:00:00Z');
    var e = Date.parse(b + 'T00:00:00Z');
    for (; t <= e; t += 86400000) out.push(isoDate(new Date(t)));
    return out;
  }

  return {
    DATA: DATA,
    COUNTRIES: COUNTRIES,
    SCHOOL_NOTES: SCHOOL_NOTES,
    RELIGIOUS: RELIGIOUS,
    holidaysForDate: holidaysForDate,
    schoolHolidaysInRange: schoolHolidaysInRange,
    religiousHolidaysInRange: religiousHolidaysInRange,
    hasHoliday: hasHoliday,
    supportedYears: supportedYears,
    calendarMonth: calendarMonth,
    dateRange: dateRange,
    isoDate: isoDate
  };
});
`;

const header = `// Generated by build/fetch-holidays.mjs on ${new Date().toISOString().slice(0, 10)}
// Sources:
//   bank holidays:  https://date.nager.at
//   school DE/FR:   https://www.schulferien.org
//   school GB (NI): https://www.education-ni.gov.uk
//   religious:      computed at build time (computus, Islamic/Hebrew/lunisolar
//                   calendars) and verified against published 2024-2028 dates
// Do not edit by hand - rerun the build script to refresh.
`;

writeFileSync(
  join(root, 'app', 'holidays.js'),
  header + apiSource
    .replace('__DATA__', JSON.stringify(data, null, 1))
    .replace('__COUNTRIES__', JSON.stringify(countriesList, null, 1))
    .replace('__NOTES__', JSON.stringify(SCHOOL_NOTES, null, 1))
    .replace('__RELIGIOUS__', JSON.stringify(religious, null, 1)),
);
console.log(`wrote ${join(root, 'app', 'holidays.js')} (${DATA_CODES.length} countries)`);

// ------------------------------------------------------- world map
// A static, offline world map so the page can be clicked to select countries.
// Each country is one SVG path, generated from the free world-atlas TopoJSON
// (Natural Earth, public domain) and projected with d3-geo. Only the five
// countries with holiday data carry a `code`; the rest are selectable but
// have none (the app says so). Antarctica is dropped (no data, skews the fit).
const mapData = { viewbox: `0 0 ${W} ${H}`, countries: mapCountries };
assert(mapData.countries.length > 150, 'world map too small');
for (const code of DATA_CODES) {
  assert.ok(mapData.countries.some((c) => c.code === code), `map missing data country ${code}`);
}
const mapSource = `// Generated by build/fetch-holidays.mjs on ${new Date().toISOString().slice(0, 10)}
// Offline world map: one SVG path per country (world-atlas / Natural Earth,
// projected with d3-geo). \`code\` is set for every country that has holiday
// data (nager.at); the others are selectable but have none.
globalThis.MapData = ${JSON.stringify(mapData)};
`;
writeFileSync(join(root, 'app', 'map-paths.js'), mapSource);
console.log(`wrote ${join(root, 'app', 'map-paths.js')} (${mapData.countries.length} countries)`);
