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
// match by data-date, not by text: cells now also carry dot-count chips
const clickDay = (n) =>
  page.locator(`#cal .day:not(:disabled)[data-date$="-${String(n).padStart(2, '0')}"]`).click();
const title = async () => (await page.textContent('#detail-date')).trim();
const detail = async () => (await page.textContent('#detail')).trim();
const DASH = '\u2013';

await page.goto(url);
await page.waitForSelector('#cal .day');

// 1a. The world map is the country selector: every country starts selected,
// most countries are dark-outlined (they have data), and the count is right.
const totalPaths = await page.locator('#map path.country').count();
assert.ok(totalPaths > 150, 'map should have many countries');
assert.strictEqual(await page.locator('#map path.country.on').count(), totalPaths, 'all selected by default');
const dataPaths = await page.locator('#map path.country.hasdata').count();
assert.ok(dataPaths > 100, 'most map countries should be outlined as having data');
let mc = await page.textContent('#mapcount');
assert.ok(mc.includes(totalPaths + ' of ' + totalPaths), mc);
assert.ok(mc.includes(dataPaths + ' with data'), mc);

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
// school entries carry their region, and the lack of school data is stated
assert.ok(d.includes('Northern Ireland'), 'NI school break should name its region');
assert.ok(d.includes('No school-holiday data for'), 'missing school data should be stated');
// Japan has data but does not observe Christmas, so it appears nowhere
assert.ok(!d.includes('Japan'), `Japan should not appear on 25 Dec; got: ${d}`);

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

// 6. Country filter (world map) still works. With 141 data countries most
// days carry more dots than fit, so the calendar caps at 12 and shows "+N".
const dotmore = '#cal .day[data-date="2025-12-25"] .dotmore';
assert.strictEqual(await page.locator('#cal .day[data-date="2025-12-25"] .dot').count(), 12, 'dots capped at 12');
const moreBefore = Number((await page.textContent(dotmore)).slice(1));
assert.ok(moreBefore > 100, 'most data countries observe Christmas');
await page.locator('#map path[data-iso="826"]').dispatchEvent('click'); // deselect UK
await clickDay(25);
assert.ok(!(await detail()).includes('United Kingdom'));
assert.strictEqual(Number((await page.textContent(dotmore)).slice(1)), moreBefore - 1);
mc = await page.textContent('#mapcount');
assert.ok(mc.includes(String(dataPaths - 1) + ' with data'), mc);
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
assert.ok(mc.includes(dataPaths + ' with data'), mc);

// 6c. The search box finds countries that are hard to click on the map,
// and ticking them stays in sync with the map and the count.
// A country with data (Luxembourg): unticking drops the "with data" count.
await page.fill('#search', 'luxembourg');
const luxRow = page.locator('#searchresults .searchrow', { hasText: 'Luxembourg' });
assert.strictEqual(await luxRow.count(), 1, 'Luxembourg should be the only match');
const luxCb = luxRow.locator('input');
assert.ok(await luxCb.isChecked(), 'Luxembourg is selected by default');
await luxCb.uncheck();
mc = await page.textContent('#mapcount');
assert.ok(mc.includes(String(totalPaths - 1) + ' of ' + totalPaths), mc);
assert.ok(mc.includes(String(dataPaths - 1) + ' with data'), mc); // Luxembourg has data
// ticking it back on restores the full selection
await luxCb.check();
assert.ok(await luxCb.isChecked());
mc = await page.textContent('#mapcount');
assert.ok(mc.includes(totalPaths + ' of ' + totalPaths), mc);
// A country without data (India): unticking leaves the "with data" count alone.
await page.fill('#search', 'india');
const inRow = page.locator('#searchresults .searchrow', { hasText: 'India' });
assert.strictEqual(await inRow.count(), 1, 'India should be the only match');
const inCb = inRow.locator('input');
assert.ok(await inCb.isChecked(), 'India is selected by default');
await inCb.uncheck();
mc = await page.textContent('#mapcount');
assert.ok(mc.includes(String(totalPaths - 1) + ' of ' + totalPaths), mc);
assert.ok(mc.includes(dataPaths + ' with data'), mc); // India has no data
await inCb.check();
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
assert.ok(d.includes('No school-holiday data for'), 'missing school data still stated');

// 8. A day with no holidays at all (7 Jun 2026 is holiday-free in every
// data country, verified against the data)
await gotoMonth('June', 2026);
await clickDay(7);
await clickDay(7);
d = await detail();
assert.ok(d.includes('No school holidays on this day.'), d);
assert.ok(d.includes('No bank holidays on this day.'), d);

// 9. ... and as a range (13-15 Dec 2026 is likewise holiday-free)
await gotoMonth('December', 2026);
await clickDay(13);
await clickDay(15);
assert.ok((await title()).includes(`13 December ${DASH} 15 December 2026`), await title());
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

// 13. The country selection is remembered across reloads (localStorage),
// while the month and the selected day are not — they reset to today.
await page.locator('#map path[data-iso="250"]').dispatchEvent('click'); // France off
await page.locator('#map path[data-iso="392"]').dispatchEvent('click'); // Japan off
mc = await page.textContent('#mapcount');
assert.ok(mc.includes(String(totalPaths - 2) + ' of ' + totalPaths), mc);
assert.ok(mc.includes(String(dataPaths - 2) + ' with data'), mc);
await page.reload();
await page.waitForSelector('#cal .day');
mc = await page.textContent('#mapcount');
assert.ok(mc.includes(String(totalPaths - 2) + ' of ' + totalPaths), mc);
assert.ok(mc.includes(String(dataPaths - 2) + ' with data'), mc);
assert.strictEqual(await page.locator('#map path.country.on').count(), totalPaths - 2,
  'map should show the remembered subset');
assert.ok(!/\bon\b/.test(await page.locator('#map path[data-iso="250"]').getAttribute('class')),
  'France stays deselected after reload');
assert.ok(!/\bon\b/.test(await page.locator('#map path[data-iso="392"]').getAttribute('class')),
  'Japan stays deselected after reload');
assert.strictEqual(
  (await page.textContent('#month-label')).trim(),
  now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
  'month should reset to today, not be remembered');
assert.strictEqual((await page.locator('#cal .day.edge').textContent()).trim(), String(now.getDate()),
  'selected day should reset to today');

// 14. Fails soft: if localStorage is unavailable (blocked/private window),
// the app still works — it defaults to all countries and never throws.
const ctx2 = await browser.newContext({ viewport: { width: 1000, height: 760 }, locale: 'en-GB' });
const page2 = await ctx2.newPage();
const errors2 = [];
page2.on('pageerror', (e) => errors2.push(String(e)));
page2.on('console', (m) => { if (m.type() === 'error') errors2.push(m.text()); });
await page2.addInitScript(() => {
  Object.defineProperty(window, 'localStorage', {
    get() { throw new Error('storage blocked'); },
    configurable: true,
  });
});
await page2.goto(url);
await page2.waitForSelector('#cal .day');
const mc2 = await page2.textContent('#mapcount');
assert.ok(mc2.includes(totalPaths + ' of ' + totalPaths), mc2); // defaults to all
assert.ok(mc2.includes(dataPaths + ' with data'), mc2);
await page2.locator('#map path[data-iso="826"]').dispatchEvent('click'); // still toggleable
const mc3 = await page2.textContent('#mapcount');
assert.ok(mc3.includes(String(totalPaths - 1) + ' of ' + totalPaths), mc3);
assert.deepStrictEqual(errors2, [], `page errors with storage blocked: ${errors2.join(' | ')}`);
await ctx2.close();

assert.deepStrictEqual(errors, [], `page errors: ${errors.join(' | ')}`);
console.log('browser smoke test: OK');
await browser.close();
