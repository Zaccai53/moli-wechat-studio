/* Optional integration check. Run with Playwright available on NODE_PATH. */
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  });

  const homePage = await browser.newPage();
  await homePage.goto(`file://${path.join(__dirname, 'home-fixture.html')}?t=home/index`);
  await homePage.addInitScript(() => {
    const values = {};
    window.chrome = {
      runtime: { getURL: () => 'about:blank' },
      storage: {
        local: {
          async set(update) { Object.assign(values, update); window.moliStoredValues = { ...values }; },
          async get(key) { return { [key]: values[key] }; },
          async remove(key) { delete values[key]; window.moliStoredValues = { ...values }; }
        }
      }
    };
  });
  await homePage.reload();
  await homePage.addScriptTag({ path: path.join(__dirname, '../extension/lib/markdown.js') });
  await homePage.addScriptTag({ path: path.join(__dirname, '../extension/content-script.js') });
  await homePage.waitForSelector('.home-repost .moli-native-repost-entry');
  assert.equal(await homePage.locator('.home-repost .moli-native-repost-entry').getAttribute('title'), '选中文章后，墨流会自动打开转载配置');
  assert.equal(await homePage.locator('.moli-launcher').innerText(), '墨流转载');
  await homePage.locator('.home-repost').click({ position: { x: 5, y: 5 } });
  assert.equal(await homePage.evaluate(() => window.repostOpened), 1);
  assert.ok(await homePage.evaluate(() => Number(window.moliStoredValues?.moliPendingRepost) > 0));
  await homePage.locator('.share_article_dialog').evaluate(element => { element.style.display = 'none'; });
  await homePage.evaluate(() => { delete window.blockedJavascriptUrl; });
  await homePage.locator('.moli-launcher').click();
  assert.equal(await homePage.evaluate(() => window.repostOpened), 2);
  assert.equal(await homePage.evaluate(() => window.blockedJavascriptUrl), undefined);
  assert.equal(await homePage.locator('.share_article_dialog').isVisible(), true);
  assert.ok(await homePage.evaluate(() => Number(window.moliStoredValues?.moliPendingRepost) > 0));
  assert.match(await homePage.locator('.moli-host-notice').innerText(), /自动打开墨流配置/);
  await homePage.close();

  const page = await browser.newPage();
  await page.goto(`file://${path.join(__dirname, 'extension-fixture.html')}?share=1`);
  await page.addInitScript(() => {
    const values = { moliPendingRepost: Date.now() };
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
      },
      storage: {
        local: {
          async get(key) { return { [key]: values[key] }; },
          async remove(key) { delete values[key]; window.moliStoredValues = { ...values }; },
          async set(update) { Object.assign(values, update); window.moliStoredValues = { ...values }; }
        }
      }
    };
  });
  await page.reload();
  await page.addScriptTag({ path: path.join(__dirname, '../extension/lib/markdown.js') });
  await page.addScriptTag({ path: path.join(__dirname, '../extension/content-script.js') });

  const panelFrame = page.frames().find(frame => frame !== page.mainFrame());
  assert.ok(panelFrame, 'extension panel iframe should be injected');
  await page.waitForSelector('.moli-drawer.is-open');
  assert.equal(await page.evaluate(() => window.moliStoredValues?.moliPendingRepost), undefined);

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

  await page.locator('.js_search_btn').evaluate(element => {
    element.addEventListener('click', () => {
      window.searchHrefDuringClick = element.getAttribute('href');
    });
  });

  const status = await request('STATUS');
  assert.equal(status.titleEditor, true);
  assert.equal(status.bodyEditor, true);
  assert.equal(status.nativeRepostMode, true);
  assert.equal(status.nativeRepostReady, true);
  assert.equal(status.nativeRepostCanModify, true);

  await page.locator('#js_reprint_source').evaluate(element => { element.style.display = 'none'; });
  const redirectedApply = await request('APPLY_NATIVE_REPOST', {
    url: 'https://mp.weixin.qq.com/s/from-apply',
    noteTitle: '荐语',
    note: '等待选择',
    insertBody: true,
    titleMode: 'prefix'
  });
  assert.equal(redirectedApply.pendingSelection, true);
  assert.equal(await page.evaluate(() => window.newContentOpened), 1);
  assert.equal(await page.evaluate(() => window.repostOpened), 1);
  assert.equal(await page.locator('.js_search_input').inputValue(), 'https://mp.weixin.qq.com/s/from-apply');
  assert.equal(await page.evaluate(() => window.blockedSearchJavascriptUrl), undefined);
  assert.equal(await page.evaluate(() => window.searchHrefDuringClick), null);
  assert.match(await page.locator('.js_search_btn').getAttribute('href'), /^javascript:/);
  assert.match(redirectedApply.warnings.join(''), /自动完成增补/);
  await page.locator('.share_article_dialog').evaluate(element => { element.style.display = 'none'; });
  await page.locator('.repost-menu').evaluate(element => { element.style.display = 'none'; });
  await page.locator('#ueditor_0 .ProseMirror').evaluate(element => {
    element.innerHTML = '<p class="native-reprint-source">文章来源于来源公众号，作者作者甲</p><section><b>来源公众号</b><span>公众号介绍</span></section><p>原生转载正文</p>';
  });
  await page.locator('#js_reprint_source').evaluate(element => { element.style.display = 'block'; });
  await page.waitForFunction(() => document.querySelector('.js_reprint_recommend_content')?.textContent === '等待选择');
  assert.equal(await page.locator('.js_reprint_recommend_title').inputValue(), '荐语');
  assert.equal(await page.locator('#title').inputValue(), '活动推荐 | 原始标题');
  assert.equal(await page.locator('#ueditor_0 .ProseMirror').getByText(/以下文章来源于/).count(), 0);
  assert.equal(await page.locator('#ueditor_0 .ProseMirror').getByText('原生转载正文', { exact: true }).count(), 1);
  assert.equal(await page.evaluate(() => window.moliStoredValues?.moliPendingNativeApply), undefined);

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
  assert.match(duplicateResult.warnings.join(''), /相同来源署名|原生来源介绍/);
  assert.match(duplicateResult.warnings.join(''), /相同正文增补/);
  assert.match(duplicateResult.warnings.join(''), /相同尾图/);

  await page.locator('#ueditor_0 .ProseMirror').evaluate(element => {
    element.innerHTML = '<p class="native-reprint-source">文章来源于来源公众号，作者作者甲</p><p style="margin:18px 0 24px;padding:12px 15px;color:#52616d;background:#f2f6f7;border-radius:4px;">以下文章来源于<strong>来源公众号</strong>，作者<strong>作者甲</strong></p><section>补充说明</section><p>原生转载正文</p>';
  });
  const nativeAttributionResult = await request('APPLY_NATIVE_REPOST', {
    noteTitle: '荐语',
    note: '值得一读',
    insertBody: true,
    bodyNote: '补充说明',
    position: 'top',
    titleMode: 'prefix'
  });
  assert.equal(await page.locator('#ueditor_0 .ProseMirror').getByText(/以下文章来源于/).count(), 0);
  assert.equal(await page.locator('#ueditor_0 .ProseMirror').getByText(/文章来源于来源公众号/).count(), 1);
  assert.match(nativeAttributionResult.warnings.join(''), /移除.*重复/);

  await request('SEARCH_NATIVE_REPOST', { url: 'https://mp.weixin.qq.com/s/example' });
  assert.equal(await page.evaluate(() => window.newContentOpened), 2);
  assert.equal(await page.evaluate(() => window.repostOpened), 2);
  assert.equal(await page.locator('.share_article_dialog').isVisible(), true);
  assert.equal(await page.locator('.js_search_input').inputValue(), 'https://mp.weixin.qq.com/s/example');
  assert.equal(await page.evaluate(() => window.searched), 2);

  await request('SEARCH_NATIVE_REPOST', { url: 'https://mp.weixin.qq.com/s/second-example' });
  assert.equal(await page.evaluate(() => window.newContentOpened), 2);
  assert.equal(await page.evaluate(() => window.repostOpened), 2);
  assert.equal(await page.locator('.js_search_input').inputValue(), 'https://mp.weixin.qq.com/s/second-example');
  assert.equal(await page.evaluate(() => window.searched), 3);

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

  const importPayload = {
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
  };
  const [firstImport, secondImport] = await Promise.all([
    request('IMPORT_REPOST', importPayload),
    request('IMPORT_REPOST', importPayload)
  ]);
  assert.equal(await page.locator('#title').inputValue(), '自定义活动标题');
  assert.match(await page.locator('#ueditor_0 .ProseMirror').innerText(), /以下文章来源于来源公众号，作者作者乙/);
  assert.match(await page.locator('#ueditor_0 .ProseMirror').innerText(), /公开正文/);
  assert.match(await page.locator('#ueditor_0 .ProseMirror').innerText(), /文末补充/);
  assert.equal(await page.locator('#ueditor_0 .ProseMirror').getByText('公开正文', { exact: true }).count(), 1);
  assert.equal(await page.locator('#ueditor_0 .ProseMirror img').count(), 1);
  assert.equal(await page.locator('#ueditor_0 .ProseMirror > :last-child img').count(), 1);
  assert.match(secondImport.warnings.join(''), /标题已是目标内容/);
  assert.match(secondImport.warnings.join(''), /图文正文已是目标内容/);
  assert.match(secondImport.warnings.join(''), /移动到文章结尾/);

  await page.locator('#title').fill('错误标题');
  await page.locator('#ueditor_0 .ProseMirror').evaluate(element => {
    element.innerHTML = '';
    element.addEventListener('paste', event => event.preventDefault(), { once: true });
  });
  await request('IMPORT_REPOST', importPayload);
  assert.equal(await page.locator('#title').inputValue(), '自定义活动标题');
  assert.equal(await page.locator('#ueditor_0 .ProseMirror').getByText('公开正文', { exact: true }).count(), 1);
  assert.equal(await page.locator('#ueditor_0 .ProseMirror').getByText('错误正文', { exact: true }).count(), 0);
  assert.equal(await page.locator('#ueditor_0 .ProseMirror img').count(), 1);
  assert.equal(await page.locator('#ueditor_0 .ProseMirror > :last-child img').count(), 1);

  await page.locator('#js_reprint_source').evaluate(element => { element.style.display = 'none'; });
  await request('SEARCH_NATIVE_REPOST', importPayload);
  await page.locator('.js_search_error').evaluate(element => {
    element.textContent = '不是有效的账号原创文章链接';
  });
  await page.waitForFunction(() => window.moliStoredValues?.moliPendingPublicFallback?.invalidOriginal === true);
  await page.locator('#ueditor_0 .ProseMirror').evaluate(element => { element.innerHTML = ''; });
  await page.locator('.share_article_dialog').evaluate(element => { element.style.display = 'none'; });
  await page.waitForFunction(() => document.querySelector('#ueditor_0 .ProseMirror')?.textContent.includes('公开正文'));
  assert.match(await page.locator('.moli-host-notice').innerText(), /自动改用公开正文直导/);
  assert.equal(await page.evaluate(() => window.moliStoredValues?.moliPendingPublicFallback), undefined);
  assert.equal(await page.locator('#ueditor_0 .ProseMirror').getByText('公开正文', { exact: true }).count(), 1);

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
