'use strict';

let requestCounter = 0;
const pending = new Map();
const $ = selector => document.querySelector(selector);

function request(action, payload = {}) {
  const requestId = `moli-${Date.now()}-${requestCounter += 1}`;
  window.parent.postMessage({ source: 'moli-panel', requestId, action, payload }, '*');
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error('公众号页面响应超时，请刷新后重试'));
    }, 20000);
    pending.set(requestId, { resolve, reject, timer });
  });
}

window.addEventListener('message', event => {
  if (event.source !== window.parent || event.data?.source !== 'moli-host') return;
  const item = pending.get(event.data.requestId);
  if (!item) return;
  clearTimeout(item.timer);
  pending.delete(event.data.requestId);
  event.data.ok ? item.resolve(event.data.result) : item.reject(new Error(event.data.error));
});

let statusTimer;
function showStatus(message, error = false) {
  clearTimeout(statusTimer);
  const node = $('#status');
  node.textContent = message;
  node.className = `show${error ? ' error' : ''}`;
  statusTimer = setTimeout(() => { node.className = ''; }, 4200);
}

async function run(button, action, payload, loadingText) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = loadingText;
  try {
    const result = await request(action, payload);
    const warning = result.warnings?.length ? `；${result.warnings.join(' ')}` : '';
    showStatus((result.message || '操作完成') + warning);
    return result;
  } catch (error) {
    showStatus(error.message || '操作失败', true);
    return null;
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

document.querySelectorAll('nav button').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('nav button').forEach(item => item.classList.toggle('active', item === button));
  $('#markdownTab').hidden = button.dataset.tab !== 'markdown';
  $('#repostTab').hidden = button.dataset.tab !== 'repost';
}));

$('#fileInput').addEventListener('change', async event => {
  const [file] = event.target.files;
  if (!file) return;
  $('#markdown').value = await file.text();
  showStatus(`已读取 ${file.name}`);
});

$('#applyButton').addEventListener('click', () => run($('#applyButton'), 'APPLY_MARKDOWN', {
  markdown: $('#markdown').value,
  title: $('#title').value,
  author: $('#author').value,
  options: { theme: $('#theme').value, rhythm: $('#rhythm').value }
}, '正在写入…'));

$('#importButton').addEventListener('click', () => run($('#importButton'), 'IMPORT_REPOST', {
  url: $('#repostUrl').value,
  noteTitle: $('#noteTitle').value,
  note: $('#note').value,
  position: document.querySelector('input[name="position"]:checked').value,
  permissionConfirmed: $('#permission').checked
}, '正在读取原文…'));

$('#enhanceButton').addEventListener('click', () => run($('#enhanceButton'), 'ENHANCE_NATIVE_REPOST', {
  noteTitle: $('#noteTitle').value,
  note: $('#note').value
}, '正在填写…'));

$('#saveButton').addEventListener('click', () => run($('#saveButton'), 'SAVE_DRAFT', {}, '正在保存…'));
$('#publishButton').addEventListener('click', () => run($('#publishButton'), 'OPEN_PUBLISH', {}, '正在打开…'));
$('#closeButton').addEventListener('click', () => request('CLOSE_PANEL'));

request('STATUS').then(status => {
  const badge = $('#editorBadge');
  if (status.bodyEditor && status.titleEditor) {
    badge.textContent = status.nativeRepost ? '原生转载可用' : '编辑器已连接';
    badge.classList.add('ready');
  } else {
    badge.textContent = '编辑器未就绪';
  }
}).catch(() => { $('#editorBadge').textContent = '连接失败'; });
