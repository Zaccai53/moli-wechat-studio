const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT || 4173);
const PUBLIC_DIR = path.join(__dirname, 'public');
const ALLOWED_IMPORT_HOST = 'mp.weixin.qq.com';

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

let tokenCache = { value: '', expiresAt: 0 };

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': mime['.json'] });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 10 * 1024 * 1024) reject(new Error('请求内容超过 10MB'));
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(new Error('请求内容不是有效 JSON')); }
    });
    req.on('error', reject);
  });
}

function decodeHtml(value = '') {
  return value
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function getMeta(html, property) {
  const safe = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${safe}["'][^>]+content=["']([^"']*)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${safe}["'][^>]*>`, 'i')
  ];
  return decodeHtml((html.match(patterns[0]) || html.match(patterns[1]) || [])[1] || '');
}

function extractWechatArticle(html, url) {
  const contentMatch = html.match(/<div[^>]+id=["']js_content["'][^>]*>([\s\S]*?)<\/div>\s*<script/i)
    || html.match(/<div[^>]+id=["']js_content["'][^>]*>([\s\S]*?)<\/div>/i);
  if (!contentMatch) throw new Error('未识别到公众号正文，链接可能已失效或需要验证');

  let content = contentMatch[1]
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/\sdata-src=/gi, ' src=')
    .replace(/\sdata-original=/gi, ' src=')
    .replace(/\son\w+\s*=\s*(["']).*?\1/gi, '');

  const title = getMeta(html, 'og:title')
    || decodeHtml((html.match(/<h1[^>]+id=["']activity-name["'][^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '').replace(/<[^>]+>/g, '').trim()
    || '转载文章';
  const author = getMeta(html, 'og:article:author')
    || decodeHtml((html.match(/id=["']js_name["'][^>]*>([\s\S]*?)<\/a>/i) || [])[1] || '').replace(/<[^>]+>/g, '').trim();
  const cover = getMeta(html, 'og:image');
  const digest = getMeta(html, 'og:description');
  return { title, author, cover, digest, content, sourceUrl: url };
}

async function getAccessToken() {
  if (tokenCache.value && Date.now() < tokenCache.expiresAt) return tokenCache.value;
  const appId = process.env.WECHAT_APP_ID;
  const secret = process.env.WECHAT_APP_SECRET;
  if (!appId || !secret) {
    const error = new Error('服务端尚未配置 WECHAT_APP_ID 和 WECHAT_APP_SECRET');
    error.status = 503;
    throw error;
  }
  const url = new URL('https://api.weixin.qq.com/cgi-bin/token');
  url.searchParams.set('grant_type', 'client_credential');
  url.searchParams.set('appid', appId);
  url.searchParams.set('secret', secret);
  const response = await fetch(url);
  const result = await response.json();
  if (!response.ok || result.errcode) throw new Error(result.errmsg || '获取公众号 access_token 失败');
  tokenCache = { value: result.access_token, expiresAt: Date.now() + (result.expires_in - 180) * 1000 };
  return tokenCache.value;
}

async function callWechat(apiPath, payload) {
  const token = await getAccessToken();
  const response = await fetch(`https://api.weixin.qq.com/cgi-bin/${apiPath}?access_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload)
  });
  const result = await response.json();
  if (!response.ok || result.errcode) {
    const error = new Error(result.errmsg || '公众号接口调用失败');
    error.details = result;
    throw error;
  }
  return result;
}

async function handleApi(req, res, pathname) {
  if (pathname === '/api/health' && req.method === 'GET') {
    return sendJson(res, 200, {
      ok: true,
      wechatConfigured: Boolean(process.env.WECHAT_APP_ID && process.env.WECHAT_APP_SECRET)
    });
  }

  if (pathname === '/api/wechat/import' && req.method === 'POST') {
    const { url } = await readBody(req);
    let parsed;
    try { parsed = new URL(url); }
    catch { return sendJson(res, 400, { error: '请输入有效的公众号文章链接' }); }
    if (parsed.protocol !== 'https:' || parsed.hostname !== ALLOWED_IMPORT_HOST) {
      return sendJson(res, 400, { error: '目前仅支持 https://mp.weixin.qq.com 的文章链接' });
    }
    const response = await fetch(parsed, { headers: { 'User-Agent': 'Mozilla/5.0 MoliStudio/0.1' } });
    if (!response.ok) return sendJson(res, 502, { error: `读取原文失败（${response.status}）` });
    const html = await response.text();
    return sendJson(res, 200, extractWechatArticle(html, parsed.toString()));
  }

  if (pathname === '/api/wechat/draft' && req.method === 'POST') {
    const article = await readBody(req);
    const required = ['title', 'content', 'thumbMediaId'];
    const missing = required.filter(key => !article[key]);
    if (missing.length) return sendJson(res, 400, { error: `缺少必填项：${missing.join(', ')}` });
    const result = await callWechat('draft/add', {
      articles: [{
        article_type: 'news',
        title: article.title,
        author: article.author || '',
        digest: article.digest || '',
        content: article.content,
        content_source_url: article.sourceUrl || '',
        thumb_media_id: article.thumbMediaId,
        need_open_comment: article.openComment ? 1 : 0,
        only_fans_can_comment: article.fansOnlyComment ? 1 : 0
      }]
    });
    return sendJson(res, 200, result);
  }

  if (pathname === '/api/wechat/publish' && req.method === 'POST') {
    const { mediaId } = await readBody(req);
    if (!mediaId) return sendJson(res, 400, { error: '缺少草稿 mediaId' });
    const result = await callWechat('freepublish/submit', { media_id: mediaId });
    return sendJson(res, 200, result);
  }

  return sendJson(res, 404, { error: '接口不存在' });
}

function serveFile(res, pathname) {
  const requestPath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requestPath));
  if (!filePath.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: '禁止访问' });
  fs.readFile(filePath, (error, data) => {
    if (error) {
      if (error.code === 'ENOENT') return sendJson(res, 404, { error: '页面不存在' });
      return sendJson(res, 500, { error: '读取页面失败' });
    }
    res.writeHead(200, { 'Content-Type': mime[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (pathname.startsWith('/api/')) await handleApi(req, res, pathname);
    else serveFile(res, pathname);
  } catch (error) {
    console.error(error);
    sendJson(res, error.status || 500, { error: error.message || '服务暂时不可用', details: error.details });
  }
});

server.listen(PORT, () => {
  console.log(`墨流编辑台已启动：http://localhost:${PORT}`);
});
