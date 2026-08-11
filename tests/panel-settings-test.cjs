/* Optional panel integration check. Run with Playwright available on NODE_PATH. */
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');

let browser;

(async () => {
  browser = await chromium.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  });
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.chrome = {
      storage: {
        local: {
          get: async () => ({ moliSettings: JSON.parse(localStorage.getItem('moli-test-settings') || 'null') }),
          set: async value => localStorage.setItem('moli-test-settings', JSON.stringify(value.moliSettings))
        }
      }
    };
    addEventListener('message', event => {
      if (event.data?.source !== 'moli-panel') return;
      postMessage({
        source: 'moli-host',
        requestId: event.data.requestId,
        ok: true,
        result: { titleEditor: true, bodyEditor: true, nativeRepostMode: false }
      }, '*');
    });
  });
  await page.goto(`file://${path.join(__dirname, '../extension/panel.html')}`);
  await page.locator('nav button[data-tab="repost"]').click();
  await page.locator('input[name="titleMode"][value="custom"]').check();
  await page.locator('#customTitle').fill('我的默认标题');
  await page.locator('#noteTitle').fill('固定荐语');
  await page.locator('#note').fill('每次默认使用这段荐语');
  await page.locator('#insertBody').uncheck();
  await page.locator('input[name="nativePosition"][value="bottom"]').check();
  await page.locator('#tailImageInput').setInputFiles({
    name: 'default-tail.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgo=', 'base64')
  });
  await page.waitForTimeout(350);
  await page.reload();
  await page.locator('nav button[data-tab="repost"]').click();
  await page.waitForFunction(() => document.querySelector('input[name="titleMode"][value="custom"]')?.checked === true);
  assert.equal(await page.locator('#customTitle').inputValue(), '我的默认标题');
  assert.equal(await page.locator('#noteTitle').inputValue(), '固定荐语');
  assert.equal(await page.locator('#note').inputValue(), '每次默认使用这段荐语');
  assert.equal(await page.locator('#insertBody').isChecked(), false);
  assert.equal(await page.locator('input[name="nativePosition"][value="bottom"]').isChecked(), true);
  await page.locator('#tailImageStatus').waitFor({ state: 'visible' });
  assert.match(await page.locator('#tailImageStatus').textContent(), /default-tail\.png/);
  await browser.close();
  console.log('panel settings integration: passed');
})().catch(error => {
  console.error(error);
  if (browser) browser.close().finally(() => process.exit(1));
  else process.exit(1);
});
