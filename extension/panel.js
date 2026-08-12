'use strict';

let requestCounter = 0;
const pending = new Map();
const $ = selector => document.querySelector(selector);
let tailImage = null;
const DEFAULT_SETTINGS = {
  titleMode: 'prefix',
  customTitle: '',
  noteTitle: '编者荐语',
  note: '',
  insertBody: true,
  bodyNote: '',
  nativePosition: 'top',
  tailImage: null
};
let persistTimer;

function collectSettings() {
  return {
    titleMode: document.querySelector('input[name="titleMode"]:checked')?.value || DEFAULT_SETTINGS.titleMode,
    customTitle: $('#customTitle').value,
    noteTitle: $('#noteTitle').value,
    note: $('#note').value,
    insertBody: $('#insertBody').checked,
    bodyNote: $('#bodyNote').value,
    nativePosition: document.querySelector('input[name="nativePosition"]:checked')?.value || DEFAULT_SETTINGS.nativePosition,
    tailImage
  };
}

async function persistSettings() {
  if (!globalThis.chrome?.storage?.local) return;
  const settings = collectSettings();
  // chrome.storage.local has a finite quota; keep the active image in memory even when it is too large to persist.
  if (settings.tailImage?.dataUrl?.length > 5_500_000) settings.tailImage = null;
  try { await chrome.storage.local.set({ moliSettings: settings }); }
  catch { showStatus('默认设置保存失败，可能是结尾图片过大', true); }
}

function schedulePersist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persistSettings, 180);
}

function setImageStatus(image) {
  const node = $('#tailImageStatus');
  if (!image) {
    node.textContent = '尚未选择结尾图片';
    node.classList.remove('ready');
    return;
  }
  const size = image.dataUrl ? `${(image.dataUrl.length * 0.75 / 1024).toFixed(0)} KB` : '已保存';
  node.textContent = `${image.name || '默认结尾图片'} · ${size}`;
  node.classList.add('ready');
}

function applySettings(settings) {
  const value = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  const titleRadio = document.querySelector(`input[name="titleMode"][value="${value.titleMode}"]`);
  if (titleRadio) titleRadio.checked = true;
  const positionRadio = document.querySelector(`input[name="nativePosition"][value="${value.nativePosition}"]`);
  if (positionRadio) positionRadio.checked = true;
  $('#customTitle').value = value.customTitle || '';
  $('#noteTitle').value = value.noteTitle ?? DEFAULT_SETTINGS.noteTitle;
  $('#note').value = value.note || '';
  $('#insertBody').checked = value.insertBody !== false;
  $('#bodyNote').value = value.bodyNote || '';
  tailImage = value.tailImage?.dataUrl ? value.tailImage : null;
  setImageStatus(tailImage);
}

async function loadSettings() {
  if (!globalThis.chrome?.storage?.local) return;
  const stored = await chrome.storage.local.get('moliSettings');
  applySettings(stored?.moliSettings);
}

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
  if (event.data.event === 'OPEN_TAB') {
    activateTab(event.data.tab);
    return;
  }
  const item = pending.get(event.data.requestId);
  if (!item) return;
  clearTimeout(item.timer);
  pending.delete(event.data.requestId);
  event.data.ok ? item.resolve(event.data.result) : item.reject(new Error(event.data.error));
});

const STATUS_DURATION = 4200;
const STATUS_LEAVE_DURATION = 1500;
let statusTimer;
let statusHovered = false;

function scheduleStatusHide(duration = STATUS_DURATION) {
  clearTimeout(statusTimer);
  if (statusHovered) return;
  statusTimer = setTimeout(() => { $('#status').className = ''; }, duration);
}

function showStatus(message, error = false) {
  const node = $('#status');
  node.textContent = message;
  node.className = `show${error ? ' error' : ''}`;
  scheduleStatusHide();
}

$('#status').addEventListener('mouseenter', () => {
  statusHovered = true;
  clearTimeout(statusTimer);
});

$('#status').addEventListener('mouseleave', () => {
  statusHovered = false;
  if ($('#status').classList.contains('show')) scheduleStatusHide(STATUS_LEAVE_DURATION);
});

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

function activateTab(tab) {
  const target = tab === 'repost' ? 'repost' : 'markdown';
  document.querySelectorAll('nav button').forEach(item => item.classList.toggle('active', item.dataset.tab === target));
  $('#markdownTab').hidden = target !== 'markdown';
  $('#repostTab').hidden = target !== 'repost';
}

document.querySelectorAll('nav button').forEach(button => button.addEventListener('click', () => {
  activateTab(button.dataset.tab);
}));

$('#fileInput').addEventListener('change', async event => {
  const [file] = event.target.files;
  if (!file) return;
  $('#markdown').value = await file.text();
  showStatus(`已读取 ${file.name}`);
});

$('#tailImageInput').addEventListener('change', async event => {
  const [file] = event.target.files;
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) {
    tailImage = null;
    showStatus('结尾图片不能超过 10MB', true);
    return;
  }
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
  tailImage = { dataUrl, name: file.name, type: file.type };
  setImageStatus(tailImage);
  schedulePersist();
});

$('#clearTailImage').addEventListener('click', () => {
  tailImage = null;
  $('#tailImageInput').value = '';
  setImageStatus(null);
  schedulePersist();
});

['customTitle', 'noteTitle', 'note', 'bodyNote'].forEach(id => {
  $(`#${id}`).addEventListener('input', schedulePersist);
});
$('#insertBody').addEventListener('change', schedulePersist);
document.querySelectorAll('input[name="titleMode"], input[name="nativePosition"]').forEach(input => {
  input.addEventListener('change', schedulePersist);
});

$('#applyButton').addEventListener('click', () => run($('#applyButton'), 'APPLY_MARKDOWN', {
  markdown: $('#markdown').value,
  title: $('#title').value,
  author: $('#author').value,
  options: { theme: $('#theme').value, rhythm: $('#rhythm').value }
}, '正在写入…'));

async function refreshEditorStatus() {
  const status = await request('STATUS');
  const badge = $('#editorBadge');
  const capability = $('#repostCapability');
  badge.className = '';
  capability.className = 'capability';
  if (status.nativeRepostReady) {
    if (status.nativeRepostCanModify) {
      badge.textContent = '转载可修改';
      capability.textContent = '已识别转载原文，可以填写荐语并增补正文。';
      capability.classList.add('ready');
    } else {
      badge.textContent = '仅可荐语';
      capability.textContent = '该原文不允许修改正文，将只填写公众号官方荐语。';
      capability.classList.add('readonly');
    }
    badge.classList.add('ready');
  } else if (status.nativeRepostMode) {
    badge.textContent = status.nativeRepostModal ? '选择转载文章' : '等待原文载入';
    capability.textContent = '请在公众号转载窗口搜索并选择原文。';
  } else if (status.bodyEditor && status.titleEditor) {
    badge.textContent = '编辑器已连接';
    badge.classList.add('ready');
    capability.textContent = '粘贴原文链接后，墨流会自动打开公众号转载窗口并搜索。';
  } else {
    badge.textContent = '编辑器未就绪';
  }
  return status;
}

function supplements() {
  return {
    titleMode: document.querySelector('input[name="titleMode"]:checked').value,
    customTitle: $('#customTitle').value,
    tailImage
  };
}

$('#searchNativeButton').addEventListener('click', async () => {
  const result = await run($('#searchNativeButton'), 'SEARCH_NATIVE_REPOST', {
    url: $('#repostUrl').value
  }, '正在搜索…');
  if (result) setTimeout(() => request('CLOSE_PANEL'), 650);
});

$('#applyNativeButton').addEventListener('click', async () => {
  const result = await run($('#applyNativeButton'), 'APPLY_NATIVE_REPOST', {
    ...supplements(),
    url: $('#repostUrl').value,
    noteTitle: $('#noteTitle').value,
    note: $('#note').value,
    insertBody: $('#insertBody').checked,
    bodyNoteTitle: '编者按',
    bodyNote: $('#bodyNote').value,
    position: document.querySelector('input[name="nativePosition"]:checked').value
  }, '正在应用…');
  if (result?.pendingSelection) setTimeout(() => request('CLOSE_PANEL'), 650);
  else if (result) refreshEditorStatus();
});

$('#importButton').addEventListener('click', () => run($('#importButton'), 'IMPORT_REPOST', {
  ...supplements(),
  url: $('#repostUrl').value,
  noteTitle: $('#noteTitle').value,
  note: $('#note').value,
  bodyNote: $('#bodyNote').value,
  position: document.querySelector('input[name="nativePosition"]:checked').value,
  permissionConfirmed: $('#permission').checked
}, '正在读取原文…'));

$('#saveButton').addEventListener('click', () => run($('#saveButton'), 'SAVE_DRAFT', {}, '正在保存…'));
$('#publishButton').addEventListener('click', () => run($('#publishButton'), 'OPEN_PUBLISH', {}, '正在打开…'));
$('#closeButton').addEventListener('click', () => request('CLOSE_PANEL'));

Promise.all([loadSettings(), refreshEditorStatus()]).catch(() => { $('#editorBadge').textContent = '连接失败'; });
