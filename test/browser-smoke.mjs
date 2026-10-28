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
// the cell text also carries the dot-count chip, so match the leading digits
assert.ok((await sel.textContent()).trim().startsWith(String(now.getDate())),
  (await sel.textContent()).trim());

// 2. Single-day clicking still works, with school and bank sections
await gotoMonth('December', 2025);
await clickDay(25);
assert.ok((await title()).includes('25 December 2025'));
assert.ok(!(await title()).includes(DASH));
let d = await detail();
for (const want of ['School holidays', 'Bank holidays', 'Christmas Day']) {
  assert.ok(d.includes(want), `detail should mention ${want}; got: ${d}`);
}
// school entries carry their region, and the lack of school data is stated
assert.ok(d.includes('Northern Ireland'), 'NI school break should name its region');
assert.ok(d.includes('No school-holiday data for'), 'missing school data should be stated');
// Japan has data but does not observe Christmas, so it appears nowhere
assert.ok(!d.includes('Japan'), `Japan should not appear on 25 Dec; got: ${d}`);

// 2a. A one-line summary sits at the very top of the panel, and the
// sections are ordered bank -> religious -> school (bank first: that's
// what she cares about most)
const firstEl = page.locator('#detail > *').first();
assert.strictEqual(await firstEl.getAttribute('class'), 'summary', 'summary is the first element');
const summary = (await firstEl.textContent()).trim();
assert.ok(/^\d+ bank holidays in \d+ countries/.test(summary), 'summary leads with bank holidays: ' + summary);
assert.ok(summary.includes('school break'), 'summary mentions school breaks: ' + summary);
const heads = await page.locator('#detail h3.dhead').allTextContents();
const bi = heads.indexOf('Bank holidays'), ri = heads.indexOf('Religious holidays'), si = heads.indexOf('School holidays');
assert.ok(bi !== -1 && bi < ri && ri < si, 'sections ordered bank, religious, school: ' + heads.join(' | '));

// 2b. With many countries selected, same-named holidays are grouped:
// "Christmas Day · 128 countries" is one collapsed line, not 128 rows.
const xmasGroup = page.locator('#detail .bgroup', { hasText: 'Christmas Day' });
assert.strictEqual(await xmasGroup.count(), 1, 'one Christmas Day group');
assert.ok((await xmasGroup.textContent()).includes('countries'), 'group shows a country count');
assert.strictEqual(await xmasGroup.getAttribute('aria-expanded'), 'false', 'big groups start collapsed');
// scope to this group's rows: school rows share the .hrow class and are visible
const ukRow = xmasGroup.locator('xpath=following-sibling::div[1]')
  .locator('.hrow', { hasText: 'United Kingdom' });
assert.ok(await ukRow.count() >= 1, 'UK row exists in the group');
assert.strictEqual(await ukRow.first().isVisible(), false, 'collapsed group hides the rows');
await xmasGroup.click();
assert.strictEqual(await xmasGroup.getAttribute('aria-expanded'), 'true');
assert.strictEqual(await ukRow.first().isVisible(), true, 'expanded group shows the rows');
d = await detail();
for (const want of ['United Kingdom', 'United States', 'Germany', 'France', 'India']) {
  assert.ok(d.includes(want), `expanded group should list ${want}; got: ${d}`);
}
// collapsing again hides the rows
await xmasGroup.click();
assert.strictEqual(await ukRow.first().isVisible(), false);

// 3. Second click extends to a range; span is highlighted
await clickDay(28);
assert.ok((await title()).includes(`25 December ${DASH} 28 December 2025`), await title());
assert.strictEqual(await page.locator('#cal .day.inrange').count(), 4);
assert.strictEqual(await page.locator('#cal .day.edge').count(), 2);
d = await detail();
assert.ok(/bank holidays in \d+ countries/.test(d), 'range summary counts bank holidays: ' + d);
assert.ok(d.includes('26 December 2025') && d.includes('Boxing Day'), d);
assert.ok(d.includes("St. Stephen's Day"), d);
// small groups (<= 3 countries) start open and name the countries
const goodwill = page.locator('#detail .bgroup', { hasText: 'Day of Goodwill' });
assert.strictEqual(await goodwill.count(), 1, 'Day of Goodwill group present');
assert.strictEqual(await goodwill.getAttribute('aria-expanded'), 'true', 'small groups start open');
assert.ok((await goodwill.textContent()).includes('South Africa and Namibia'),
  'small group names its countries');

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

// 6. Country filter (world map) still works. With many countries selected
// the calendar shows one dot plus a country count per day (no dot soup).
const dotcount = '#cal .day[data-date="2025-12-25"] .dotmore';
assert.strictEqual(await page.locator('#cal .day[data-date="2025-12-25"] .dot').count(), 1, 'one dot per day with many countries selected');
const moreBefore = Number(await page.textContent(dotcount));
assert.ok(moreBefore > 100, 'most data countries observe Christmas');
await page.locator('#map path[data-iso="826"]').dispatchEvent('click'); // deselect UK
await clickDay(25);
assert.ok(!(await detail()).includes('United Kingdom'));
assert.strictEqual(Number(await page.textContent(dotcount)), moreBefore - 1);
mc = await page.textContent('#mapcount');
assert.ok(mc.includes(String(dataPaths - 1) + ' with data'), mc);
assert.ok(mc.includes(String(totalPaths - 1) + ' of ' + totalPaths), mc);
await page.locator('#map path[data-iso="826"]').dispatchEvent('click'); // reselect UK
// with few countries selected, dots are per-country colours again (no count chip)
await page.locator('#selnone').click();
await page.locator('#map path[data-iso="826"]').dispatchEvent('click'); // UK
await page.locator('#map path[data-iso="276"]').dispatchEvent('click'); // Germany
assert.strictEqual(await page.locator('#cal .day[data-date="2025-12-25"] .dot').count(), 2, 'one dot per country when few are selected');
assert.strictEqual(await page.locator('#cal .day[data-date="2025-12-25"] .dotmore').count(), 0, 'no count chip when few are selected');
await page.locator('#selall').click();

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
// A newly covered data country (India): unticking drops the "with data" count.
// 'india' also matches the Indian Ocean territories, so match the exact name.
await page.fill('#search', 'india');
const inRow = page.locator('#searchresults .searchrow', { hasText: /^India$/ });
assert.strictEqual(await inRow.count(), 1, 'India should match exactly once');
const inCb = inRow.locator('input');
assert.ok(await inCb.isChecked(), 'India is selected by default');
await inCb.uncheck();
mc = await page.textContent('#mapcount');
assert.ok(mc.includes(String(totalPaths - 1) + ' of ' + totalPaths), mc);
assert.ok(mc.includes(String(dataPaths - 1) + ' with data'), mc); // India has data
await inCb.check();
// A country without data (Somaliland): unticking leaves the "with data" count alone.
await page.fill('#search', 'somaliland');
const slRow = page.locator('#searchresults .searchrow', { hasText: 'Somaliland' });
assert.strictEqual(await slRow.count(), 1, 'Somaliland should be the only match');
const slCb = slRow.locator('input');
assert.ok(await slCb.isChecked(), 'Somaliland is selected by default');
await slCb.uncheck();
mc = await page.textContent('#mapcount');
assert.ok(mc.includes(String(totalPaths - 1) + ' of ' + totalPaths), mc);
assert.ok(mc.includes(dataPaths + ' with data'), mc); // Somaliland has no data
await slCb.check();
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

// 8. A day with no holidays at all (13 Jun 2026 is holiday-free in every
// data country, verified against the data)
await gotoMonth('June', 2026);
await clickDay(13);
await clickDay(13);
d = await detail();
assert.ok(d.includes('No school holidays on this day.'), d);
assert.ok(d.includes('No bank holidays on this day.'), d);
assert.ok((await page.locator('#detail > *').first().textContent()).includes('No holidays on this day.'), 'summary says no holidays');

// 9. ... and as a range (14-15 Dec 2026 is likewise holiday-free)
await gotoMonth('December', 2026);
await clickDay(14);
await clickDay(15);
assert.ok((await title()).includes(`14 December ${DASH} 15 December 2026`), await title());
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
// moon-dependent bank holidays (UAE, Pakistan, ...) are grouped and flagged too
const eidGroup = page.locator('#detail .bgroup', { hasText: 'Eid al-Fitr' });
assert.ok(await eidGroup.count() >= 1, 'Eid al-Fitr bank group present');
assert.ok((await eidGroup.first().textContent()).includes('\u00b11 day'),
  'the bank group carries the ±1 day flag');

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
// the cell text also carries the dot-count chip, so match the leading digits
assert.ok((await page.locator('#cal .day.edge').textContent()).trim().startsWith(String(now.getDate())),
  'selected day should reset to today: ' + (await page.locator('#cal .day.edge').textContent()).trim());

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
