'use strict';

const ALLOWED_HOST = 'mp.weixin.qq.com';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'MOLI_FETCH_ARTICLE') return false;
  fetchArticle(message.url)
    .then(result => sendResponse({ ok: true, ...result }))
    .catch(error => sendResponse({ ok: false, error: error.message || '读取原文失败' }));
  return true;
});

async function fetchArticle(rawUrl) {
  let url;
  try { url = new URL(rawUrl); }
  catch { throw new Error('请输入有效的公众号文章链接'); }
  if (url.protocol !== 'https:' || url.hostname !== ALLOWED_HOST) {
    throw new Error('目前仅支持 https://mp.weixin.qq.com 的文章链接');
  }
  const response = await fetch(url.toString(), { credentials: 'omit', redirect: 'follow' });
  if (!response.ok) throw new Error(`读取原文失败（HTTP ${response.status}）`);
  const html = await response.text();
  if (!html.includes('js_content')) throw new Error('页面中未找到公众号正文，链接可能已失效或需要验证');
  return { html, finalUrl: response.url };
}
