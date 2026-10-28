#!/usr/bin/env node
// Regenerates app/holidays.js from https://date.nager.at (free, no API key).
// The generated file is committed so the app works offline with nothing installed.
// Usage: node build/fetch-holidays.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(root, 'app'), { recursive: true });
const YEARS = [2024, 2025, 2026, 2027];
const COUNTRY_CODES = ['GB', 'US', 'DE', 'FR', 'JP'];

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

async function fetchHolidays(year, code) {
  const url = `https://date.nager.at/api/v3/PublicHolidays/${year}/${code}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return res.json();
}

function gbNote(counties) {
  if (!counties) return undefined;
  if (ALL_GB.every((c) => counties.includes(c))) return undefined;
  return counties.map((c) => GB_REGION[c]).join(', ');
}

const data = {};
for (const code of COUNTRY_CODES) {
  const seen = new Map(); // "date|name" -> entry, keep the most far-reaching one
  for (const year of YEARS) {
    for (const h of await fetchHolidays(year, code)) {
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
  data[code] = [...seen.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name),
  );
  console.log(`${code}: ${data[code].length} holidays`);
}

const apiSource = `
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof globalThis !== 'undefined') globalThis.Holidays = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DATA = __DATA__;

  var COUNTRIES = [
    { code: 'GB', name: 'United Kingdom' },
    { code: 'US', name: 'United States' },
    { code: 'DE', name: 'Germany' },
    { code: 'FR', name: 'France' },
    { code: 'JP', name: 'Japan' }
  ];

  var BY_DATE = {};
  COUNTRIES.forEach(function (c) {
    (DATA[c.code] || []).forEach(function (h) {
      (BY_DATE[h.date] = BY_DATE[h.date] || []).push({
        country: c.code,
        name: h.name,
        note: h.note
      });
    });
  });

  // Holidays on one day (ISO 'YYYY-MM-DD'), in COUNTRIES order, optionally
  // restricted to the given country codes.
  function holidaysForDate(dateStr, countryCodes) {
    var out = [];
    var list = BY_DATE[dateStr] || [];
    COUNTRIES.forEach(function (c) {
      if (countryCodes && countryCodes.indexOf(c.code) === -1) return;
      list.forEach(function (h) {
        if (h.country !== c.code) return;
        var row = { country: c.code, countryName: c.name, name: h.name };
        if (h.note) row.note = h.note;
        out.push(row);
      });
    });
    return out;
  }

  function hasHoliday(dateStr, countryCodes) {
    return holidaysForDate(dateStr, countryCodes).length > 0;
  }

  // [earliest, latest] year present in DATA.
  function supportedYears() {
    var ys = [];
    Object.keys(DATA).forEach(function (k) {
      DATA[k].forEach(function (h) {
        var y = Number(h.date.slice(0, 4));
        if (ys.indexOf(y) === -1) ys.push(y);
      });
    });
    ys.sort(function (a, b) { return a - b; });
    return ys.length ? [ys[0], ys[ys.length - 1]] : [];
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

  return {
    DATA: DATA,
    COUNTRIES: COUNTRIES,
    holidaysForDate: holidaysForDate,
    hasHoliday: hasHoliday,
    supportedYears: supportedYears,
    calendarMonth: calendarMonth,
    isoDate: isoDate
  };
});
`;

const header = `// Generated by build/fetch-holidays.mjs on ${new Date().toISOString().slice(0, 10)}
// Source: https://date.nager.at (public/bank holidays, worldwide).
// Do not edit by hand - rerun the build script to refresh.
`;

writeFileSync(
  join(root, 'app', 'holidays.js'),
  header + apiSource.replace('__DATA__', JSON.stringify(data, null, 1)),
);
console.log(`wrote ${join(root, 'app', 'holidays.js')}`);
