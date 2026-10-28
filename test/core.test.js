'use strict';
// Core logic tests: node --test test/
const { test } = require('node:test');
const assert = require('node:assert');
const H = require('../app/holidays.js');

test('bank data integrity: every entry is a valid ISO date inside the covered years', () => {
  const [minY, maxY] = H.supportedYears();
  let count = 0;
  for (const c of H.COUNTRIES) {
    const d = H.DATA[c.code];
    assert.ok(Array.isArray(d.bank), c.code + ' has a bank list');
    assert.ok(d.bank.length > 0, c.code + ' has no bank holidays');
    for (const h of d.bank) {
      count++;
      assert.match(h.date, /^\d{4}-\d{2}-\d{2}$/, `${c.code}: bad date ${h.date}`);
      const dt = new Date(h.date + 'T00:00:00Z');
      assert.ok(!Number.isNaN(dt.getTime()), `${c.code}: unparseable ${h.date}`);
      assert.strictEqual(dt.toISOString().slice(0, 10), h.date, `${c.code}: not a real date ${h.date}`);
      const y = Number(h.date.slice(0, 4));
      assert.ok(y >= minY && y <= maxY, `${c.code}: year out of range ${h.date}`);
      assert.ok(h.name && h.name.length > 0, `${c.code}: missing name ${h.date}`);
    }
  }
  assert.ok(count > 5000, 'suspiciously little data');
});

test('school data integrity: valid ranges, always a region label', () => {
  let count = 0;
  for (const c of H.COUNTRIES) {
    const d = H.DATA[c.code];
    assert.ok(Array.isArray(d.school), c.code + ' has a school list');
    for (const h of d.school) {
      count++;
      assert.match(h.start, /^\d{4}-\d{2}-\d{2}$/, `${c.code}: bad start ${h.start}`);
      assert.match(h.end, /^\d{4}-\d{2}-\d{2}$/, `${c.code}: bad end ${h.end}`);
      assert.ok(h.start <= h.end, `${c.code}: backwards range ${h.start}..${h.end}`);
      assert.ok(h.name && h.name.length > 0, `${c.code}: missing name`);
      assert.ok(h.region && h.region.length > 0, `${c.code}: missing region`);
    }
  }
  assert.ok(count > 400, 'suspiciously little school data');
});

test('supportedYears reflects the data', () => {
  // bank holidays 2024-2027, German Christmas holidays run into January 2028
  assert.deepStrictEqual(H.supportedYears(), [2024, 2028]);
});

test('UK bank holidays (2026)', () => {
  const bank = (d) => H.holidaysForDate(d, ['GB']).filter((h) => h.kind === 'bank');
  const names = (d) => bank(d).map((h) => h.name);
  assert.ok(names('2026-04-06').includes('Easter Monday'));
  assert.ok(names('2026-05-04').includes('Early May Bank Holiday'));
  assert.ok(names('2026-08-31').includes('Summer Bank Holiday'));
  assert.deepStrictEqual(names('2026-12-28'), ['Boxing Day']); // substituted: 26 Dec is a Saturday
  assert.ok(bank('2026-08-03')[0].note === 'Scotland');
});

test('US federal holidays (2026)', () => {
  const bank = (d) => H.holidaysForDate(d, ['US']).filter((h) => h.kind === 'bank');
  const names = (d) => bank(d).map((h) => h.name);
  assert.ok(names('2026-11-26').includes('Thanksgiving Day'));
  assert.ok(names('2026-01-01').includes("New Year's Day"));
  // 4 July 2026 is a Saturday: the source lists the observed date only
  assert.deepStrictEqual(bank('2026-07-03').map((h) => h.name), ['Independence Day']);
  assert.deepStrictEqual(H.holidaysForDate('2026-07-04', ['US']), []);
});

test('German nationwide holidays carry honest notes', () => {
  const de = (d, name) => H.holidaysForDate(d, ['DE']).find(
    (h) => h.kind === 'bank' && h.name === name);
  assert.ok(de('2026-05-01', 'Labour Day'));
  assert.strictEqual(de('2026-04-06', 'Easter Monday').note, 'most states (not Schleswig-Holstein)');
  assert.strictEqual(de('2026-05-14', 'Ascension Day').note, 'some states');
  assert.deepStrictEqual(
    H.holidaysForDate('2026-10-03', ['DE']).filter((h) => h.kind === 'bank').map((h) => h.name),
    ['German Unity Day']);
});

test('French and Japanese holidays', () => {
  assert.deepStrictEqual(
    H.holidaysForDate('2026-07-14', ['FR']).filter((h) => h.kind === 'bank').map((h) => h.name),
    ['Bastille Day']);
  assert.ok(H.holidaysForDate('2026-01-12', ['JP']).some((h) => h.name === 'Coming of Age Day'));
  assert.ok(H.holidaysForDate('2026-11-03', ['JP']).some((h) => h.name === 'Culture Day'));
  // Japan does not observe Christmas, and has no school data
  assert.deepStrictEqual(H.holidaysForDate('2026-12-25', ['JP']), []);
});

test('holidaysForDate: all countries, ordering and filtering', () => {
  const all = H.holidaysForDate('2026-12-25');
  const codes = [...new Set(all.map((h) => h.country))];
  // Christmas is observed in most data countries, but not in Japan
  assert.ok(codes.length > 50, 'many countries observe Christmas');
  for (const c of ['GB', 'US', 'DE', 'FR']) assert.ok(codes.includes(c), c + ' observes Christmas');
  assert.ok(!codes.includes('JP'), 'Japan does not observe Christmas');
  assert.ok(all.every((h) => h.kind === 'bank' || h.kind === 'school'));
  assert.ok(all.every((h) => h.countryName && h.countryName.length > 0), 'rows carry the country name');
  const onlyUs = H.holidaysForDate('2026-11-26', ['US']).filter((h) => h.kind === 'bank');
  assert.deepStrictEqual(onlyUs.map((h) => h.name), ['Thanksgiving Day']);
  // unknown country code is ignored, does not throw
  assert.deepStrictEqual(H.holidaysForDate('2026-11-26', ['XX']), []);
});

test('school holidays are labelled by region, never nationwide', () => {
  // Germany: per state
  const h = H.holidaysForDate('2026-08-10', ['DE']).find(
    (x) => x.kind === 'school' && x.name === 'Summer holiday' && x.region === 'Bavaria');
  assert.ok(h, 'Bavaria summer 2026 covers 10 Aug');
  assert.deepStrictEqual([h.start, h.end], ['2026-08-03', '2026-09-14']);
  // France: per zone
  const fr = H.holidaysForDate('2027-02-15', ['FR']).find(
    (x) => x.kind === 'school' && x.region === 'Zone A');
  assert.ok(fr, 'Zone A winter 2027 covers 15 Feb');
  assert.deepStrictEqual([fr.start, fr.end], ['2027-02-14', '2027-02-28']);
  // UK: Northern Ireland only
  const gb = H.holidaysForDate('2026-12-25', ['GB']).filter((x) => x.kind === 'school');
  assert.ok(gb.length >= 1, 'NI Christmas break covers 25 Dec 2026');
  assert.ok(gb.every((x) => x.region === 'Northern Ireland'));
  const xmas = gb.find((x) => x.name === 'Christmas and New Year');
  assert.deepStrictEqual([xmas.start, xmas.end], ['2026-12-21', '2027-01-01']);
});

test('school data: only GB/DE/FR have it; notes only where data is partial', () => {
  // the original five: only GB (Northern Ireland) has school data
  assert.deepStrictEqual(H.DATA.US.school, []);
  assert.deepStrictEqual(H.DATA.JP.school, []);
  // and the rest of the world: no school data at all
  const withSchool = H.COUNTRIES.filter((c) => H.DATA[c.code].school.length > 0);
  assert.deepStrictEqual(withSchool.map((c) => c.code).sort(), ['DE', 'FR', 'GB']);
  // notes exist only where data is partial (GB: NI only; FR: 2027/28 unpublished);
  // countries with no school data are reported by the app, not by a note
  assert.deepStrictEqual(Object.keys(H.SCHOOL_NOTES).sort(), ['FR', 'GB']);
  assert.match(H.SCHOOL_NOTES.GB, /local authority/);
  assert.ok(H.SCHOOL_NOTES.FR, 'FR note about the unpublished 2027/28 calendar');
  assert.strictEqual(H.SCHOOL_NOTES.DE, undefined);
});

test('schoolHolidaysInRange: overlap, either order, sorted by start', () => {
  const aug = H.schoolHolidaysInRange('2026-08-01', '2026-08-31', ['DE']);
  assert.strictEqual(aug.length, 16, 'all 16 German states are on summer holiday in Aug 2026');
  assert.ok(aug.every((h) => h.name === 'Summer holiday'));
  // a range inside one break returns that break once, with its full dates
  const one = H.schoolHolidaysInRange('2027-02-15', '2027-02-19', ['FR']);
  const za = one.find((h) => h.region === 'Zone A');
  assert.deepStrictEqual([za.start, za.end], ['2027-02-14', '2027-02-28']);
  // either order gives the same result
  assert.strictEqual(
    H.schoolHolidaysInRange('2026-08-31', '2026-08-01', ['DE']).length, aug.length);
  // sorted by start date
  const all = H.schoolHolidaysInRange('2026-01-01', '2026-12-31');
  assert.ok(all.length > 50);
  for (let i = 1; i < all.length; i++) {
    assert.ok(all[i - 1].start <= all[i].start, 'sorted by start');
  }
});

test('hasHoliday', () => {
  assert.ok(H.hasHoliday('2026-12-25'));
  assert.ok(H.hasHoliday('2026-12-25', ['JP']) === false);
  assert.ok(H.hasHoliday('2026-06-17', ['GB']) === false);
  // no bank holiday, but DE school holidays count too
  assert.ok(H.hasHoliday('2026-08-10', ['DE']));
});

test('calendarMonth: 42 Monday-first cells', () => {
  // September 2026 starts on a Tuesday
  const sept = H.calendarMonth(2026, 8);
  assert.strictEqual(sept.length, 42);
  assert.deepStrictEqual(sept[0], { date: '2026-08-31', inMonth: false });
  assert.deepStrictEqual(sept[1], { date: '2026-09-01', inMonth: true });
  assert.deepStrictEqual(sept[41], { date: '2026-10-11', inMonth: false });
  assert.strictEqual(sept.filter((c) => c.inMonth).length, 30);

  // March 2027 starts on a Monday: no leading cells
  const mar = H.calendarMonth(2027, 2);
  assert.deepStrictEqual(mar[0], { date: '2027-03-01', inMonth: true });
  assert.deepStrictEqual(mar[30], { date: '2027-03-31', inMonth: true });

  // leap year: February 2028 has 29 days
  const feb = H.calendarMonth(2028, 1);
  assert.strictEqual(feb.filter((c) => c.inMonth).length, 29);
  assert.ok(feb.some((c) => c.date === '2028-02-29' && c.inMonth));
});

test('dateRange: inclusive, either order, across boundaries', () => {
  assert.deepStrictEqual(H.dateRange('2026-12-25', '2026-12-28'),
    ['2026-12-25', '2026-12-26', '2026-12-27', '2026-12-28']);
  assert.deepStrictEqual(H.dateRange('2026-12-28', '2026-12-25'),
    H.dateRange('2026-12-25', '2026-12-28'));
  assert.deepStrictEqual(H.dateRange('2026-12-30', '2027-01-02'),
    ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  assert.deepStrictEqual(H.dateRange('2026-05-01', '2026-05-01'), ['2026-05-01']);
  assert.strictEqual(H.dateRange('2028-02-01', '2028-02-29').length, 29);
});

test('religious data integrity: valid ranges, religion, note, approx flag', () => {
  assert.ok(Array.isArray(H.RELIGIOUS), 'RELIGIOUS is an array');
  assert.strictEqual(H.RELIGIOUS.length, 50, '10 holidays x 5 years (2024-2028)');
  const religions = new Set();
  for (const h of H.RELIGIOUS) {
    assert.match(h.start, /^\d{4}-\d{2}-\d{2}$/, `bad start ${h.start}`);
    assert.match(h.end, /^\d{4}-\d{2}-\d{2}$/, `bad end ${h.end}`);
    assert.ok(h.start <= h.end, `backwards range ${h.start}..${h.end}`);
    assert.ok(h.name && h.name.length > 0, 'missing name');
    assert.ok(h.religion && h.religion.length > 0, 'missing religion');
    assert.ok(h.note && h.note.length > 0, 'missing note');
    assert.strictEqual(typeof h.approx, 'boolean', 'missing approx');
    assert.ok(h.start >= '2024-01-01' && h.end <= '2028-12-31', `out of bounds ${h.start}`);
    religions.add(h.religion);
  }
  assert.deepStrictEqual(
    [...religions].sort(),
    ['Buddhist', 'Christian', 'Hindu', 'Islamic', 'Jewish']);
});

test('religious dates are right for 2024-2028 (spot checks)', () => {
  const on = (name, date) =>
    H.RELIGIOUS.some((h) => h.name === name && h.start <= date && date <= h.end);
  // Easter (computus)
  assert.ok(on('Easter', '2024-03-31'));
  assert.ok(on('Easter', '2026-04-05'));
  assert.ok(on('Easter', '2028-04-16'));
  // Hanukkah (8 days, can cross a year boundary)
  assert.ok(on('Hanukkah', '2024-12-26'));
  assert.ok(on('Hanukkah', '2025-01-01')); // 2024/25 Hanukkah crosses into January
  assert.ok(on('Hanukkah', '2026-12-05'));
  assert.ok(!on('Hanukkah', '2026-12-13')); // ends 12 Dec
  // Rosh Hashanah (2 days)
  assert.ok(on('Rosh Hashanah', '2026-09-12'));
  assert.ok(on('Rosh Hashanah', '2026-09-13'));
  assert.ok(!on('Rosh Hashanah', '2026-09-14'));
  // Diwali, Eid al-Fitr, Vesak (approx)
  assert.ok(on('Diwali', '2026-11-08'));
  assert.ok(on('Eid al-Fitr', '2026-03-20'));
  assert.ok(on('Vesak', '2028-05-09'));
  // a day that is not Easter
  assert.ok(!on('Easter', '2026-04-06'));
});

test('religiousHolidaysInRange: overlap, either order, sorted, approx flags', () => {
  // single day
  assert.deepStrictEqual(
    H.religiousHolidaysInRange('2026-04-05', '2026-04-05').map((h) => h.name),
    ['Easter']);
  // a range covering several religious events
  const r = H.religiousHolidaysInRange('2026-03-01', '2026-04-30');
  const names = r.map((h) => h.name);
  assert.ok(names.includes('Eid al-Fitr'), names.join(',')); // 20 Mar
  assert.ok(names.includes('Holi'), names.join(',')); // 4 Mar
  assert.ok(names.includes('Passover'), names.join(',')); // 2 Apr
  assert.ok(names.includes('Easter'), names.join(',')); // 5 Apr
  // either order gives the same result
  assert.deepStrictEqual(
    H.religiousHolidaysInRange('2026-04-30', '2026-03-01').map((h) => h.name),
    names);
  // sorted by start date
  for (let i = 1; i < r.length; i++) {
    assert.ok(r[i - 1].start <= r[i].start, 'sorted by start');
  }
  // approx flags are carried through
  assert.strictEqual(H.religiousHolidaysInRange('2026-03-20', '2026-03-20')[0].approx, true);
  assert.strictEqual(H.religiousHolidaysInRange('2026-04-05', '2026-04-05')[0].approx, false);
  // empty range
  assert.deepStrictEqual(H.religiousHolidaysInRange('2026-06-17', '2026-06-17'), []);
  // 2028 is covered
  assert.deepStrictEqual(
    H.religiousHolidaysInRange('2028-04-16', '2028-04-16').map((h) => h.name),
    ['Easter']);
});

test('isoDate round-trips', () => {
  assert.strictEqual(H.isoDate(new Date(Date.UTC(2026, 0, 5))), '2026-01-05');
  assert.strictEqual(H.isoDate(new Date(Date.UTC(2026, 11, 31))), '2026-12-31');
});

test('world map data: every country has a path, data countries match the data', () => {
  require('../app/map-paths.js');
  const M = globalThis.MapData;
  assert.ok(M && Array.isArray(M.countries), 'MapData.countries is an array');
  assert.match(M.viewbox, /^0 0 \d+ \d+$/, 'viewbox present');
  assert.ok(M.countries.length > 150, 'expected a full world map');
  const codes = new Set();
  const isos = new Set();
  for (const c of M.countries) {
    assert.ok(c.iso && c.iso.length > 0, 'every country has an iso key');
    assert.ok(!isos.has(c.iso), 'duplicate iso ' + c.iso);
    isos.add(c.iso);
    assert.ok(c.name && c.name.length > 0, 'every country has a name');
    assert.ok(c.d && c.d.length > 10 && /^M/.test(c.d), 'every country has a path: ' + c.name);
    if (c.code) {
      assert.ok(!codes.has(c.code), 'duplicate data code ' + c.code);
      codes.add(c.code);
    }
  }
  // most map countries have data (nager.at covers them), incl. the original five
  assert.ok(codes.size > 100, 'expected most map countries to have data, got ' + codes.size);
  for (const c of ['DE', 'FR', 'GB', 'JP', 'US']) assert.ok(codes.has(c), c + ' flagged');
  const byCode = Object.fromEntries(M.countries.filter((c) => c.code).map((c) => [c.code, c.name]));
  assert.strictEqual(byCode.GB, 'United Kingdom');
  assert.strictEqual(byCode.US, 'United States');
  // the map's data codes and the holiday data's countries agree exactly
  assert.deepStrictEqual([...codes].sort(), H.COUNTRIES.map((c) => c.code).sort());
  // a known no-data country is present but unflagged (India is not on nager.at)
  const inr = M.countries.find((c) => c.name === 'India');
  assert.ok(inr, 'India present');
  assert.strictEqual(inr.code, '');
});
