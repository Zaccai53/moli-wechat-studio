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
        sendMessage: async message => {
          if (message.type !== 'MOLI_FETCH_ARTICLE') return { ok: false, error: 'unknown fixture request' };
          return {
            ok: true,
            finalUrl: message.url,
            html: `<!doctype html><html><head>
              <meta property="og:title" content="公开文章">
              <meta property="og:description" content="公开文章摘要">
              <meta property="og:article:author" content="来源公众号">
            </head><body>
              <span id="js_name">来源公众号</span><span id="js_author_name">作者乙</span>
              <div id="js_content"><p>公开正文</p></div>
            </body></html>`
          };
        }
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
    position: 'top',
    titleMode: 'prefix',
    tailImage: {
      name: 'tail.png',
      type: 'image/png',
      dataUrl: 'data:image/png;base64,iVBORw0KGgo='
    }
  });
  assert.equal(await page.locator('.js_reprint_recommend_title').inputValue(), '荐语');
  assert.equal(await page.locator('.js_reprint_recommend_content').innerText(), '值得一读');
  assert.match(await page.locator('#ueditor_0 .ProseMirror').innerHTML(), /补充说明/);
  assert.match(await page.locator('#ueditor_0 .ProseMirror').innerHTML(), /小标题/);
  assert.match(await page.locator('#ueditor_0 .ProseMirror').innerText(), /以下文章来源于来源公众号，作者作者甲/);
  assert.match(await page.locator('#ueditor_0 .ProseMirror').innerHTML(), /data:image\/png/);
  assert.equal(await page.locator('#title').inputValue(), '活动推荐 | 注入测试');
  const nativeText = await page.locator('#ueditor_0 .ProseMirror').innerText();
  assert.ok(nativeText.indexOf('以下文章来源于') < nativeText.indexOf('补充说明'));

  const bodyAfterFirstSupplement = await page.locator('#ueditor_0 .ProseMirror').innerHTML();
  const duplicateResult = await request('APPLY_NATIVE_REPOST', {
    noteTitle: '荐语',
    note: '值得一读',
    insertBody: true,
    bodyNote: '补充说明',
    position: 'bottom',
    titleMode: 'prefix',
    tailImage: {
      name: 'tail.png',
      type: 'image/png',
      dataUrl: 'data:image/png;base64,iVBORw0KGgo='
    }
  });
  assert.equal(await page.locator('#ueditor_0 .ProseMirror').innerHTML(), bodyAfterFirstSupplement);
  assert.equal(await page.locator('#title').inputValue(), '活动推荐 | 注入测试');
  assert.match(duplicateResult.warnings.join(''), /标题增补已存在/);
  assert.match(duplicateResult.warnings.join(''), /相同来源署名/);
  assert.match(duplicateResult.warnings.join(''), /相同正文增补/);
  assert.match(duplicateResult.warnings.join(''), /相同尾图/);

  await page.locator('.share_article_dialog').evaluate(element => { element.style.display = 'block'; });
  await request('SEARCH_NATIVE_REPOST', { url: 'https://mp.weixin.qq.com/s/example' });
  assert.equal(await page.locator('.js_search_input').inputValue(), 'https://mp.weixin.qq.com/s/example');
  assert.equal(await page.evaluate(() => window.searched), 1);

  await page.locator('.share_article_dialog').evaluate(element => { element.style.display = 'none'; });
  await page.locator('#js_reprint_article_tips').evaluate(element => { element.style.display = 'block'; });
  const lockedTitle = await page.locator('#title').inputValue();
  const lockedBody = await page.locator('#ueditor_0 .ProseMirror').innerHTML();
  const lockedResult = await request('APPLY_NATIVE_REPOST', {
    noteTitle: '荐语',
    note: '只允许荐语',
    insertBody: true,
    bodyNote: '不能写入的内容',
    titleMode: 'custom',
    customTitle: '不能修改的标题'
  });
  assert.equal(await page.locator('#title').inputValue(), lockedTitle);
  assert.equal(await page.locator('#ueditor_0 .ProseMirror').innerHTML(), lockedBody);
  assert.match(lockedResult.warnings.join(''), /未授予正文修改权限/);
  await page.locator('#js_reprint_article_tips').evaluate(element => { element.style.display = 'none'; });

  await request('IMPORT_REPOST', {
    url: 'https://mp.weixin.qq.com/s/public-example',
    permissionConfirmed: true,
    titleMode: 'custom',
    customTitle: '自定义活动标题',
    note: '推荐理由',
    bodyNote: '文末补充',
    position: 'bottom',
    tailImage: {
      name: 'tail.png',
      type: 'image/png',
      dataUrl: 'data:image/png;base64,iVBORw0KGgo='
    }
  });
  assert.equal(await page.locator('#title').inputValue(), '自定义活动标题');
  assert.match(await page.locator('#ueditor_0 .ProseMirror').innerText(), /以下文章来源于来源公众号，作者作者乙/);
  assert.match(await page.locator('#ueditor_0 .ProseMirror').innerText(), /公开正文/);
  assert.match(await page.locator('#ueditor_0 .ProseMirror').innerText(), /文末补充/);

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
