/* Optional integration check. Run with Playwright available on NODE_PATH. */
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  });
  const page = await browser.newPage();
  await page.goto(`file://${path.join(__dirname, 'extension-fixture.html')}?share=1`);
  await page.addInitScript(() => {
    window.chrome = {
      runtime: {
        getURL: () => 'about:blank',
        sendMessage: async () => ({ ok: false, error: 'not used in this fixture' })
      }
    };
  });
  await page.reload();
  await page.addScriptTag({ path: path.join(__dirname, '../extension/lib/markdown.js') });
  await page.addScriptTag({ path: path.join(__dirname, '../extension/content-script.js') });

  const panelFrame = page.frames().find(frame => frame !== page.mainFrame());
  assert.ok(panelFrame, 'extension panel iframe should be injected');

  async function request(action, payload = {}) {
    return panelFrame.evaluate(({ action, payload }) => new Promise((resolve, reject) => {
      const requestId = `test-${Math.random()}`;
      const timer = setTimeout(() => reject(new Error('message timeout')), 2000);
      addEventListener('message', function listener(event) {
        if (event.data?.source !== 'moli-host' || event.data.requestId !== requestId) return;
        clearTimeout(timer);
        removeEventListener('message', listener);
        event.data.ok ? resolve(event.data.result) : reject(new Error(event.data.error));
      });
      parent.postMessage({ source: 'moli-panel', requestId, action, payload }, '*');
    }), { action, payload });
  }

  const status = await request('STATUS');
  assert.equal(status.titleEditor, true);
  assert.equal(status.bodyEditor, true);
  assert.equal(status.nativeRepostMode, true);
  assert.equal(status.nativeRepostReady, true);
  assert.equal(status.nativeRepostCanModify, true);

  await request('APPLY_MARKDOWN', {
    markdown: '# 注入测试\n\n## 小标题\n\n正文带有 **重点**。',
    author: '墨流',
    options: { theme: 'clear', rhythm: 'relaxed' }
  });
  assert.equal(await page.locator('#title').inputValue(), '注入测试');
  assert.equal(await page.locator('#author').inputValue(), '墨流');
  assert.match(await page.locator('#ueditor_0 .ProseMirror').innerHTML(), /小标题/);
  assert.match(await page.locator('#ueditor_0 .ProseMirror').innerHTML(), /重点/);

  await request('APPLY_NATIVE_REPOST', {
    noteTitle: '荐语',
    note: '值得一读',
    insertBody: true,
    bodyNote: '补充说明',
    position: 'top'
  });
  assert.equal(await page.locator('.js_reprint_recommend_title').inputValue(), '荐语');
  assert.equal(await page.locator('.js_reprint_recommend_content').innerText(), '值得一读');
  assert.match(await page.locator('#ueditor_0 .ProseMirror').innerHTML(), /补充说明/);
  assert.match(await page.locator('#ueditor_0 .ProseMirror').innerHTML(), /小标题/);

  await page.locator('.share_article_dialog').evaluate(element => { element.style.display = 'block'; });
  await request('SEARCH_NATIVE_REPOST', { url: 'https://mp.weixin.qq.com/s/example' });
  assert.equal(await page.locator('.js_search_input').inputValue(), 'https://mp.weixin.qq.com/s/example');
  assert.equal(await page.evaluate(() => window.searched), 1);

  await request('SAVE_DRAFT');
  await request('OPEN_PUBLISH');
  assert.equal(await page.evaluate(() => window.saved), 1);
  assert.equal(await page.evaluate(() => window.published), 1);

  await browser.close();
  console.log('extension browser integration: passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
