#!/usr/bin/env node
// Regenerates app/holidays.js:
//   - bank/public holidays from https://date.nager.at (free, no API key)
//   - school holidays from:
//       Germany:  https://www.schulferien.org/deutschland/ferien/<year>/ (per state)
//       France:   https://www.schulferien.org/frankreich/ferien/<year>/  (per zone)
//       UK:       https://www.education-ni.gov.uk/articles/school-holidays
//                 (Northern Ireland only; England/Scotland/Wales set dates locally)
//       US, Japan: none (set by local school districts / municipalities)
// The generated file is committed so the app works offline with nothing installed.
// Usage: node build/fetch-holidays.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(root, 'app'), { recursive: true });
const YEARS = [2024, 2025, 2026, 2027];
const COUNTRY_CODES = ['GB', 'US', 'DE', 'FR', 'JP'];

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

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return res.json();
}

function gbNote(counties) {
  if (!counties) return undefined;
  if (ALL_GB.every((c) => counties.includes(c))) return undefined;
  return counties.map((c) => GB_REGION[c]).join(', ');
}

const bank = {};
for (const code of COUNTRY_CODES) {
  const seen = new Map(); // "date|name" -> entry, keep the most far-reaching one
  for (const year of YEARS) {
    for (const h of await fetchJSON(
      `https://date.nager.at/api/v3/PublicHolidays/${year}/${code}`,
    )) {
      let name = RENAME[code]?.[h.name] ?? h.name;
      let note;
      if (code === 'GB') {
        note = gbNote(h.counties); // UK: keep every region, label the partial ones
      } else if (code === 'DE') {
        if (!h.global) continue; // German state holidays: out of scope for now
        note = DE_NOTES[name];
      } else if (!h.global) {
        continue; // US/FR/JP: nationwide holidays only
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
  }
  bank[code] = [...seen.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name),
  );
  console.log(`bank ${code}: ${bank[code].length}`);
}

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

const school = {
  GB: await fetchNISchool(),
  US: [], // set by each local school district
  DE: await fetchDESchool(),
  FR: await fetchFRSchool(),
  JP: [], // set by each municipality
};
for (const code of COUNTRY_CODES) {
  school[code].sort(
    (a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end) ||
      a.name.localeCompare(b.name) || a.region.localeCompare(b.region),
  );
  console.log(`school ${code}: ${school[code].length}`);
}

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
for (const code of COUNTRY_CODES) {
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
  US: 'In the US, school calendars are set by each local school district, so no school-holiday data is shown.',
  JP: 'In Japan, school holidays are set by each municipality, so no school-holiday data is shown.',
  FR: 'The French school calendar for 2027/28 is not published yet, so autumn and Christmas 2027 are missing.',
};

// ------------------------------------------------------- generated module

const data = {};
for (const code of COUNTRY_CODES) data[code] = { bank: bank[code], school: school[code] };

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

  var COUNTRIES = [
    { code: 'GB', name: 'United Kingdom' },
    { code: 'US', name: 'United States' },
    { code: 'DE', name: 'Germany' },
    { code: 'FR', name: 'France' },
    { code: 'JP', name: 'Japan' }
  ];

  // Shown in the detail panel where school data is missing or partial.
  var SCHOOL_NOTES = __NOTES__;

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
    holidaysForDate: holidaysForDate,
    schoolHolidaysInRange: schoolHolidaysInRange,
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
// Do not edit by hand - rerun the build script to refresh.
`;

writeFileSync(
  join(root, 'app', 'holidays.js'),
  header + apiSource
    .replace('__DATA__', JSON.stringify(data, null, 1))
    .replace('__NOTES__', JSON.stringify(SCHOOL_NOTES, null, 1)),
);
console.log(`wrote ${join(root, 'app', 'holidays.js')}`);
