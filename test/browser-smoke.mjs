#!/usr/bin/env node
// Browser smoke test: loads the app from file:// and exercises the UI.
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
const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(url);
await page.waitForSelector('#cal .day');

// 1. Opens on the current month with today selected
const now = new Date();
const monthLabel = (await page.textContent('#month-label')).trim();
assert.strictEqual(
  monthLabel,
  now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
  `expected current month, got ${monthLabel}`);
const todayBtn = page.locator('#cal .day.sel');
assert.strictEqual((await todayBtn.textContent()).trim(), String(now.getDate()));

// 2. Navigate to December 2025 and pick the 25th
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
await gotoMonth('December', 2025);
await page.locator('#cal .day:not(:disabled)', { hasText: '25' }).click();
const detail = await page.textContent('#detail');
for (const want of ['Christmas Day', 'United Kingdom', 'United States', 'Germany', 'France']) {
  assert.ok(detail.includes(want), `detail should mention ${want}; got: ${detail}`);
}
assert.ok(!detail.includes('Japan'), 'Japan does not observe Christmas');

// 3. A day with no holidays
await page.locator('#cal .day:not(:disabled)', { hasText: '10' }).click();
assert.ok((await page.textContent('#detail')).includes('No holidays'));

// 4. Country filter: unchecking the UK removes it from the detail panel
await page.locator('#chips [data-country="GB"] input').uncheck();
await page.locator('#cal .day:not(:disabled)', { hasText: '25' }).click();
assert.ok(!(await page.textContent('#detail')).includes('United Kingdom'));
// and the UK dot disappears from 25 Dec
const dots = await page.locator('#cal .day[data-date="2025-12-25"] .dot').count();
assert.strictEqual(dots, 3); // US, DE, FR
await page.locator('#chips [data-country="GB"] input').check();

// 5. Out-of-range months show the data-coverage note
await gotoMonth('January', 2030);
assert.ok(await page.locator('#range-note').isVisible());
await page.locator('#cal .day:not(:disabled)', { hasText: '15' }).click();
assert.ok((await page.textContent('#detail')).includes('No holiday data'));

assert.deepStrictEqual(errors, [], `page errors: ${errors.join(' | ')}`);
console.log('browser smoke test: OK');
await browser.close();
