'use strict';
// Core logic tests: node --test test/
const { test } = require('node:test');
const assert = require('node:assert');
const H = require('../app/holidays.js');

test('data integrity: every entry is a valid ISO date inside the covered years', () => {
  const [minY, maxY] = H.supportedYears();
  let count = 0;
  for (const c of H.COUNTRIES) {
    assert.ok(Array.isArray(H.DATA[c.code]), c.code + ' has a list');
    for (const h of H.DATA[c.code]) {
      count++;
      assert.match(h.date, /^\d{4}-\d{2}-\d{2}$/, `${c.code}: bad date ${h.date}`);
      const d = new Date(h.date + 'T00:00:00Z');
      assert.ok(!Number.isNaN(d.getTime()), `${c.code}: unparseable ${h.date}`);
      assert.strictEqual(d.toISOString().slice(0, 10), h.date, `${c.code}: not a real date ${h.date}`);
      const y = Number(h.date.slice(0, 4));
      assert.ok(y >= minY && y <= maxY, `${c.code}: year out of range ${h.date}`);
      assert.ok(h.name && h.name.length > 0, `${c.code}: missing name ${h.date}`);
    }
  }
  assert.ok(count > 100, 'suspiciously little data');
});

test('supportedYears reflects the data', () => {
  assert.deepStrictEqual(H.supportedYears(), [2024, 2027]);
});

test('UK bank holidays (2026)', () => {
  const names = (d) => H.holidaysForDate(d, ['GB']).map((h) => h.name);
  assert.ok(names('2026-04-06').includes('Easter Monday'));
  assert.ok(names('2026-05-04').includes('Early May Bank Holiday'));
  assert.ok(names('2026-08-31').includes('Summer Bank Holiday'));
  assert.deepStrictEqual(names('2026-12-28'), ['Boxing Day']); // substituted: 26 Dec is a Saturday
  assert.ok(H.holidaysForDate('2026-08-03', ['GB'])[0].note === 'Scotland');
});

test('US federal holidays (2026)', () => {
  const names = (d) => H.holidaysForDate(d, ['US']).map((h) => h.name);
  assert.ok(names('2026-11-26').includes('Thanksgiving Day'));
  assert.ok(names('2026-01-01').includes("New Year's Day"));
  // 4 July 2026 is a Saturday: the source lists the observed date only
  assert.deepStrictEqual(H.holidaysForDate('2026-07-03', ['US']).map((h) => h.name), ['Independence Day']);
  assert.deepStrictEqual(H.holidaysForDate('2026-07-04', ['US']), []);
});

test('German nationwide holidays carry honest notes', () => {
  const de = (d, name) =>
    H.holidaysForDate(d, ['DE']).find((h) => h.name === name);
  assert.ok(de('2026-05-01', 'Labour Day'));
  assert.strictEqual(de('2026-04-06', 'Easter Monday').note, 'most states (not Schleswig-Holstein)');
  assert.strictEqual(de('2026-05-14', 'Ascension Day').note, 'some states');
  assert.deepStrictEqual(H.holidaysForDate('2026-10-03', ['DE']).map((h) => h.name), ['German Unity Day']);
});

test('French and Japanese holidays', () => {
  assert.deepStrictEqual(
    H.holidaysForDate('2026-07-14', ['FR']).map((h) => h.name),
    ['Bastille Day']);
  assert.ok(H.holidaysForDate('2026-01-12', ['JP']).some((h) => h.name === 'Coming of Age Day'));
  assert.ok(H.holidaysForDate('2026-11-03', ['JP']).some((h) => h.name === 'Culture Day'));
  // Japan does not observe Christmas
  assert.deepStrictEqual(H.holidaysForDate('2026-12-25', ['JP']), []);
});

test('holidaysForDate: all countries, ordering and filtering', () => {
  const all = H.holidaysForDate('2026-12-25');
  assert.deepStrictEqual(
    all.map((h) => h.country),
    ['GB', 'US', 'DE', 'FR']); // no JP
  assert.strictEqual(all[0].countryName, 'United Kingdom');
  const onlyUs = H.holidaysForDate('2026-11-26', ['US']);
  assert.deepStrictEqual(onlyUs.map((h) => h.name), ['Thanksgiving Day']);
  // unknown country code is ignored, does not throw
  assert.deepStrictEqual(H.holidaysForDate('2026-11-26', ['XX']), []);
});

test('hasHoliday', () => {
  assert.ok(H.hasHoliday('2026-12-25'));
  assert.ok(H.hasHoliday('2026-12-25', ['JP']) === false);
  assert.ok(H.hasHoliday('2026-06-17', ['GB']) === false);
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

test('isoDate round-trips', () => {
  assert.strictEqual(H.isoDate(new Date(Date.UTC(2026, 0, 5))), '2026-01-05');
  assert.strictEqual(H.isoDate(new Date(Date.UTC(2026, 11, 31))), '2026-12-31');
});
