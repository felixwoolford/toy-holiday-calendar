#!/usr/bin/env node
// Browser smoke test: loads the app from file:// and exercises the UI,
// including single-day and range selection.
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

// 1. Opens on the current month with today selected
const now = new Date();
assert.strictEqual(
  (await page.textContent('#month-label')).trim(),
  now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }));
const sel = page.locator('#cal .day.edge');
assert.strictEqual(await sel.count(), 1);
assert.strictEqual((await sel.textContent()).trim(), String(now.getDate()));

// 2. Single-day clicking still works
await gotoMonth('December', 2025);
await clickDay(25);
assert.ok((await title()).includes('25 December 2025'));
assert.ok(!(await title()).includes(DASH));
let d = await detail();
for (const want of ['Christmas Day', 'United Kingdom', 'United States', 'Germany', 'France']) {
  assert.ok(d.includes(want), `detail should mention ${want}; got: ${d}`);
}
assert.ok(!d.includes('Japan'), 'Japan does not observe Christmas');

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

// 6. Country filter still works
await page.locator('#chips [data-country="GB"] input').uncheck();
await clickDay(25);
assert.ok(!(await detail()).includes('United Kingdom'));
assert.strictEqual(await page.locator('#cal .day[data-date="2025-12-25"] .dot').count(), 3);
await page.locator('#chips [data-country="GB"] input').check();

// 7. A range with no holidays
// (the previous single selection is still pending, so the first click
// completes it; clicking the same day again starts a fresh single day)
await gotoMonth('January', 2027);
await clickDay(5);
await clickDay(5);
assert.ok(!(await title()).includes(DASH));
await clickDay(8);
assert.ok((await detail()).includes('No holidays in the selected countries in this range.'));

// 8. A range crossing the data limit: covered part is shown, note appears,
// and the highlight continues into the out-of-month cells
await gotoMonth('December', 2027);
await clickDay(25);
await gotoMonth('January', 2028);
await clickDay(2);
d = await detail();
assert.ok(d.includes('Christmas Day'), d);
assert.ok(!d.includes('No holiday data'), d);
assert.ok(await page.locator('#range-note').isVisible());
// 5 out-of-month cells (27-31 Dec) + 2 in-month (1-2 Jan)
assert.strictEqual(await page.locator('#cal .day.inrange').count(), 7);

assert.deepStrictEqual(errors, [], `page errors: ${errors.join(' | ')}`);
console.log('browser smoke test: OK');
await browser.close();
