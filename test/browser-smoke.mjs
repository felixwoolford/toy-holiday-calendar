#!/usr/bin/env node
// Browser smoke test: loads the app from file:// and exercises the UI,
// including single-day and range selection and the school-holiday sections.
// Needs: npm i playwright-core, and a Chromium/Chrome binary
// (set CHROMIUM=/path/to/chromium, defaults to /usr/bin/chromium).
// Usage: node test/browser-smoke.mjs
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

const url = 'file://' + fileURLToPath(new URL('../app/index.html', import.meta.url));
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
  args: ['--no-sandbox'],
});
// Pin the locale so date-format assertions are deterministic
// (the app itself follows the user's browser locale).
const ctx = await browser.newContext({ viewport: { width: 1000, height: 760 }, locale: 'en-GB' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
async function gotoMonth(monthName, year) {
  for (let i = 0; i < 60; i++) {
    const label = (await page.textContent('#month-label')).trim();
    const [m, y] = label.split(' ');
    const cur = MONTHS.indexOf(m) + Number(y) * 12;
    const target = MONTHS.indexOf(monthName) + year * 12;
    if (cur === target) return;
    await page.click(cur < target ? '#next' : '#prev');
  }
  throw new Error(`could not reach ${monthName} ${year}`);
}
const clickDay = (n) =>
  page.locator('#cal .day:not(:disabled)', { hasText: new RegExp(`^${n}$`) }).click();
const title = async () => (await page.textContent('#detail-date')).trim();
const detail = async () => (await page.textContent('#detail')).trim();
const DASH = '\u2013';

await page.goto(url);
await page.waitForSelector('#cal .day');

// 1a. The world map is the country selector: every country starts selected,
// the five data countries are dark-outlined, and the count reads correctly.
const totalPaths = await page.locator('#map path.country').count();
assert.ok(totalPaths > 150, 'map should have many countries');
assert.strictEqual(await page.locator('#map path.country.on').count(), totalPaths, 'all selected by default');
assert.strictEqual(await page.locator('#map path.country.hasdata').count(), 5, '5 data countries outlined');
let mc = await page.textContent('#mapcount');
assert.ok(mc.includes(totalPaths + ' of ' + totalPaths), mc);
assert.ok(mc.includes('5 with data'), mc);

// 1. Opens on the current month with today selected
const now = new Date();
assert.strictEqual(
  (await page.textContent('#month-label')).trim(),
  now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }));
const sel = page.locator('#cal .day.edge');
assert.strictEqual(await sel.count(), 1);
assert.strictEqual((await sel.textContent()).trim(), String(now.getDate()));

// 2. Single-day clicking still works, with school and bank sections
await gotoMonth('December', 2025);
await clickDay(25);
assert.ok((await title()).includes('25 December 2025'));
assert.ok(!(await title()).includes(DASH));
let d = await detail();
for (const want of ['School holidays', 'Bank holidays', 'Christmas Day',
  'United Kingdom', 'United States', 'Germany', 'France']) {
  assert.ok(d.includes(want), `detail should mention ${want}; got: ${d}`);
}
// school entries carry their region, and countries without data say so
assert.ok(d.includes('Northern Ireland'), 'NI school break should name its region');
assert.ok(d.includes('school district'), 'US should explain the missing school data');
// Japan only appears in its no-school-data note (it does not observe Christmas)
assert.strictEqual(d.split('Japan').length - 1, 1, `Japan mentioned ${d.split('Japan').length - 1} times; got: ${d}`);

// 3. Second click extends to a range; span is highlighted
await clickDay(28);
assert.ok((await title()).includes(`25 December ${DASH} 28 December 2025`), await title());
assert.strictEqual(await page.locator('#cal .day.inrange').count(), 4);
assert.strictEqual(await page.locator('#cal .day.edge').count(), 2);
d = await detail();
assert.ok(d.includes('holidays over 4 days'), d);
assert.ok(d.includes('26 December 2025') && d.includes('Boxing Day'), d);
assert.ok(d.includes("St. Stephen's Day"), d);

// 4. Clicking an earlier day restarts the selection as a single day
await clickDay(20);
assert.ok((await title()).includes('20 December 2025'));
assert.ok(!(await title()).includes(DASH));

// 5. The click after a reset completes the range; after a completed range,
// the next click starts fresh
await clickDay(21);
assert.ok((await title()).includes(`20 December ${DASH} 21 December 2025`), await title());
await clickDay(23);
assert.ok((await title()).includes('23 December 2025'));
assert.ok(!(await title()).includes(DASH));
await clickDay(30);
assert.ok((await title()).includes(`23 December ${DASH} 30 December 2025`), await title());

// 6. Country filter (world map) still works
await page.locator('#map path[data-iso="826"]').dispatchEvent('click'); // deselect UK
await clickDay(25);
assert.ok(!(await detail()).includes('United Kingdom'));
assert.strictEqual(await page.locator('#cal .day[data-date="2025-12-25"] .dot').count(), 3);
mc = await page.textContent('#mapcount');
assert.ok(mc.includes('4 with data'), mc);
assert.ok(mc.includes(String(totalPaths - 1) + ' of ' + totalPaths), mc);
await page.locator('#map path[data-iso="826"]').dispatchEvent('click'); // reselect UK

// 6b. The no-data note lists selected countries without data; Clear and
// Select all reset the whole map.
d = await detail();
assert.ok(/No holiday data for \d+ selected countries/.test(d), 'no-data note shown by default');
await page.locator('#selnone').click();
mc = await page.textContent('#mapcount');
assert.ok(mc.includes('0 of ' + totalPaths), mc);
assert.ok(mc.includes('0 with data'), mc);
d = await detail();
assert.ok(!/No holiday data for \d+ selected countries/.test(d), 'no no-data note when nothing is selected');
assert.ok(d.includes('No bank holidays on this day.'), 'no bank holidays with no countries selected');
await page.locator('#selall').click();
mc = await page.textContent('#mapcount');
assert.ok(mc.includes(totalPaths + ' of ' + totalPaths), mc);
assert.ok(mc.includes('5 with data'), mc);

// 6c. The search box finds small countries that are hard to click on the map,
// and ticking them stays in sync with the map and the count.
await page.fill('#search', 'luxembourg');
const luxRow = page.locator('#searchresults .searchrow', { hasText: 'Luxembourg' });
assert.strictEqual(await luxRow.count(), 1, 'Luxembourg should be the only match');
const luxCb = luxRow.locator('input');
assert.ok(await luxCb.isChecked(), 'Luxembourg is selected by default');
await luxCb.uncheck();
mc = await page.textContent('#mapcount');
assert.ok(mc.includes(String(totalPaths - 1) + ' of ' + totalPaths), mc);
assert.ok(mc.includes('5 with data'), mc); // Luxembourg has no data
// ticking it back on restores the full selection
await luxCb.check();
assert.ok(await luxCb.isChecked());
mc = await page.textContent('#mapcount');
assert.ok(mc.includes(totalPaths + ' of ' + totalPaths), mc);
// a data country is findable too and shows ticked
await page.fill('#search', 'germany');
const deRow = page.locator('#searchresults .searchrow', { hasText: 'Germany' });
assert.strictEqual(await deRow.count(), 1, 'Germany should be the only match');
assert.ok(await deRow.locator('input').isChecked(), 'Germany is ticked');
// a non-matching query says so; clearing restores the idle hint
await page.fill('#search', 'zzzz');
assert.ok((await page.textContent('#searchresults')).includes('No country matches'));
await page.fill('#search', '');
assert.ok((await page.textContent('#searchresults')).includes('Type to search'));

// 7. School holidays on a day in the middle of summer break
// (the pending single selection is completed by the first click;
// clicking the same day again starts a fresh single day)
await gotoMonth('August', 2026);
await clickDay(10);
await clickDay(10);
assert.ok(!(await title()).includes(DASH));
d = await detail();
for (const want of ['School holidays', 'Summer holiday', 'Bavaria', 'Northern Ireland']) {
  assert.ok(d.includes(want), `detail should mention ${want}; got: ${d}`);
}
assert.ok(d.includes('school district'), 'US note still shown');

// 8. A day with no holidays at all (15-18 Sep 2026 is holiday-free in all
// five countries, verified against the data)
await gotoMonth('September', 2026);
await clickDay(15);
await clickDay(15);
d = await detail();
assert.ok(d.includes('No school holidays on this day.'), d);
assert.ok(d.includes('No bank holidays on this day.'), d);

// 9. ... and as a range
await clickDay(18);
assert.ok((await title()).includes(`15 September ${DASH} 18 September 2026`), await title());
d = await detail();
assert.ok(d.includes('No school holidays in this range.'), d);
assert.ok(d.includes('No bank holidays in this range.'), d);

// 10. A range crossing a year boundary: covered part is shown, and 2028 is
// now inside the data range (German Christmas holidays run into January)
await gotoMonth('December', 2027);
await clickDay(25);
await gotoMonth('January', 2028);
await clickDay(5);
d = await detail();
assert.ok(d.includes('Christmas Day'), d);
assert.ok(d.includes('Christmas holiday'), 'DE school break runs into 2028');
// the out-of-coverage message is absent (the no-data-countries note is fine)
assert.ok(!d.includes('No holiday data for this range'), d);
assert.ok(!(await page.locator('#range-note').isVisible()), 'Jan 2028 is covered');
// 5 out-of-month cells (27-31 Dec) + 5 in-month (1-5 Jan)
assert.strictEqual(await page.locator('#cal .day.inrange').count(), 10);

// 11. Religious holidays: their own section, with the ±1 day flag
await gotoMonth('April', 2026);
await clickDay(5);
await clickDay(5);
d = await detail();
assert.ok(d.includes('Religious holidays'), d);
assert.ok(d.includes('Easter'), 'Easter should be listed');
assert.ok(d.includes('Christian'), 'the religion should be named');
// an approx (moon-dependent) holiday is flagged ±1 day and explained
await gotoMonth('March', 2026);
await clickDay(20);
await clickDay(20);
d = await detail();
assert.ok(d.includes('Eid al-Fitr'), d);
assert.ok(d.includes('\u00b11 day'), 'approx holidays should be flagged');
assert.ok(d.includes('expected'), 'the ±1 day note should explain why');

// 12. Months beyond the data limit show the note
await gotoMonth('June', 2029);
assert.ok(await page.locator('#range-note').isVisible());

assert.deepStrictEqual(errors, [], `page errors: ${errors.join(' | ')}`);
console.log('browser smoke test: OK');
await browser.close();
