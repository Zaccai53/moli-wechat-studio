const SAMPLE = `# AI 不会替代你，但会重新定义“会工作”

我们正在经历的，不是一次普通的工具升级，而是一场关于**如何思考、如何协作**的工作方式迁移。

> 真正值得关注的，从来不是模型能回答多少问题，而是人能否提出更好的问题。

## 01 从“完成任务”到“设计任务”

过去，我们习惯把工作拆成一连串动作：查资料、写文档、做表格、发邮件。AI 出现之后，动作本身正在快速变得廉价。

人的价值开始向上游移动：

- 定义什么问题值得解决
- 判断结果是否可信、是否适合当下语境
- 把零散能力组织成一套稳定流程

## 02 好工具应该让思路显形

一篇好文章，不只是信息正确。它还要有呼吸、有重点、有一条能让读者跟下去的线。

| 排版元素 | 它解决的问题 |
| --- | --- |
| 标题层级 | 我现在读到哪里 |
| 段落留白 | 什么时候停一下 |
| 引用强调 | 什么值得记住 |

### 写在最后

工具的终点不是替你表达，而是让你的表达更接近它本来的样子。

---

愿每一次发布，都配得上你投入的注意力。`;

const state = {
  mode: 'write',
  markdown: localStorage.getItem('moli-current') || SAMPLE,
  importedHtml: '',
  importedMeta: null,
  theme: localStorage.getItem('moli-theme') || 'clear',
  rhythm: 'relaxed',
  fontSize: 16,
  contentWidth: 100,
  author: localStorage.getItem('moli-author') || '墨流编辑台',
  digest: '',
  saveTimer: null
};

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

const markdownInput = $('#markdownInput');
const articleContent = $('#articleContent');
const articlePreview = $('#articlePreview');
const articleTitle = $('#articleTitle');
const authorInput = $('#authorInput');
const digestInput = $('#digestInput');

function escapeHtml(value = '') {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function inlineMarkdown(text) {
  return text
    .replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, '<img src="$2" alt="$1">')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
}

function parseMarkdown(source) {
  const lines = escapeHtml(source.replace(/\r\n/g, '\n')).split('\n');
  const html = [];
  let paragraph = [];
  let listType = '';
  let inCode = false;
  let code = [];
  let quote = [];

  const flushParagraph = () => {
    if (paragraph.length) html.push(`<p>${inlineMarkdown(paragraph.join('<br>'))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (listType) html.push(`</${listType}>`);
    listType = '';
  };
  const flushQuote = () => {
    if (quote.length) html.push(`<blockquote><p>${inlineMarkdown(quote.join('<br>'))}</p></blockquote>`);
    quote = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^```/.test(line.trim())) {
      flushParagraph(); flushList(); flushQuote();
      if (inCode) {
        html.push(`<pre><code>${code.join('\n')}</code></pre>`);
        code = [];
      }
      inCode = !inCode;
      continue;
    }
    if (inCode) { code.push(line); continue; }
    if (/^\s*&gt;\s?/.test(line)) {
      flushParagraph(); flushList();
      quote.push(line.replace(/^\s*&gt;\s?/, ''));
      continue;
    }
    flushQuote();
    const tableDivider = index + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1]);
    if (line.includes('|') && tableDivider) {
      flushParagraph(); flushList();
      const headers = line.replace(/^\||\|$/g, '').split('|').map(v => v.trim());
      index += 1;
      const rows = [];
      while (index + 1 < lines.length && lines[index + 1].includes('|') && lines[index + 1].trim()) {
        index += 1;
        rows.push(lines[index].replace(/^\||\|$/g, '').split('|').map(v => v.trim()));
      }
      html.push(`<table><thead><tr>${headers.map(v => `<th>${inlineMarkdown(v)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(v => `<td>${inlineMarkdown(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph(); flushList();
      const level = heading[1].length;
      html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      flushParagraph(); flushList(); html.push('<hr>'); continue;
    }
    const unordered = line.match(/^\s*[-+*]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      const nextType = unordered ? 'ul' : 'ol';
      if (listType && listType !== nextType) flushList();
      if (!listType) { listType = nextType; html.push(`<${listType}>`); }
      html.push(`<li>${inlineMarkdown((unordered || ordered)[1])}</li>`);
      continue;
    }
    flushList();
    if (!line.trim()) { flushParagraph(); continue; }
    paragraph.push(line.trim());
  }
  flushParagraph(); flushList(); flushQuote();
  if (inCode && code.length) html.push(`<pre><code>${code.join('\n')}</code></pre>`);
  return html.join('');
}

function sanitizeImportedHtml(html) {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  doc.querySelectorAll('script, iframe, form, input, button, style, link').forEach(node => node.remove());
  doc.querySelectorAll('*').forEach(node => {
    [...node.attributes].forEach(attr => {
      if (/^on/i.test(attr.name) || ['id', 'class', 'contenteditable'].includes(attr.name)) node.removeAttribute(attr.name);
      if ((attr.name === 'href' || attr.name === 'src') && /^javascript:/i.test(attr.value)) node.removeAttribute(attr.name);
    });
  });
  return doc.body.firstElementChild?.innerHTML || '';
}

function getTitleFromMarkdown(markdown) {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? match[1].replace(/[*_`]/g, '') : '未命名文章';
}

function createInsertNote() {
  const text = $('#insertContent').value.trim();
  if (!text) return '';
  return `<div class="insert-note">${escapeHtml(text).replace(/\n/g, '<br>')}</div>`;
}

function render() {
  let content;
  let title;
  if (state.mode === 'repost' && state.importedHtml) {
    const note = createInsertNote();
    const position = $('input[name="position"]:checked').value;
    content = position === 'top' ? note + state.importedHtml : state.importedHtml + note;
    title = state.importedMeta?.title || '转载文章';
  } else {
    content = parseMarkdown(state.markdown);
    title = getTitleFromMarkdown(state.markdown);
  }
  articleContent.innerHTML = content;
  articleTitle.textContent = title;
  $('#articleAuthor').textContent = state.author || '未署名';
  articlePreview.className = `phone-page theme-${state.theme}` + (articlePreview.classList.contains('wide') ? ' wide' : '');
  articlePreview.style.setProperty('--article-font-size', `${state.fontSize}px`);
  articlePreview.style.setProperty('--content-width', `${state.contentWidth}%`);
  const rhythmMap = { compact: ['1.72', '12px'], relaxed: ['1.95', '18px'], airy: ['2.18', '26px'] };
  articlePreview.style.setProperty('--article-line-height', rhythmMap[state.rhythm][0]);
  articlePreview.style.setProperty('--paragraph-space', rhythmMap[state.rhythm][1]);
  $('#wordCount').textContent = `${plainText().length} 字 · 约 ${Math.max(1, Math.ceil(plainText().length / 450))} 分钟阅读`;
  updateSpectrum();
}

function plainText() {
  const temp = document.createElement('div');
  temp.innerHTML = articleContent.innerHTML;
  return (temp.textContent || '').replace(/\s+/g, '');
}

function updateSpectrum() {
  const blocks = [...articleContent.children];
  $('#spectrum').innerHTML = blocks.slice(0, 28).map(block => {
    const type = /^H[1-3]$/.test(block.tagName) ? 'heading' : block.tagName === 'BLOCKQUOTE' ? 'quote' : '';
    const size = Math.max(4, Math.min(22, (block.textContent || '').length / 12));
    return `<i class="${type}" style="height:${size}px"></i>`;
  }).join('');
}

function markSaving() {
  $('.document-state').classList.add('saving');
  $('#saveState').textContent = '正在保存…';
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => {
    localStorage.setItem('moli-current', state.markdown);
    localStorage.setItem('moli-theme', state.theme);
    localStorage.setItem('moli-author', state.author);
    $('.document-state').classList.remove('saving');
    $('#saveState').textContent = '所有更改已保存';
  }, 450);
}

function toast(message, type = '') {
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.textContent = message;
  $('#toastRegion').append(node);
  setTimeout(() => node.remove(), 3200);
}

function switchMode(mode) {
  state.mode = mode;
  $$('.mode-tab').forEach(tab => {
    const active = tab.dataset.mode === mode;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', active);
  });
  $('#writeView').hidden = mode !== 'write';
  $('#repostView').hidden = mode !== 'repost';
  $('#previewModeLabel').textContent = mode === 'write' ? '手机阅读' : '转载预览';
  render();
}

async function copyRichText() {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = articleContent.innerHTML;
  const computed = getComputedStyle(articleContent);
  wrapper.style.cssText = `font-size:${computed.fontSize};line-height:${computed.lineHeight};color:${computed.color};font-family:${computed.fontFamily};`;
  try {
    if (navigator.clipboard && window.ClipboardItem) {
      const htmlBlob = new Blob([wrapper.outerHTML], { type: 'text/html' });
      const textBlob = new Blob([articleContent.innerText], { type: 'text/plain' });
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': htmlBlob, 'text/plain': textBlob })]);
    } else {
      const range = document.createRange();
      range.selectNodeContents(articleContent);
      const selection = window.getSelection();
      selection.removeAllRanges(); selection.addRange(range);
      document.execCommand('copy'); selection.removeAllRanges();
    }
    toast('已复制富文本，可直接粘贴到公众号编辑器');
  } catch {
    toast('复制被浏览器拦截，请在预览区手动选择内容', 'error');
  }
}

async function importWechatArticle() {
  const url = $('#repostUrl').value.trim();
  if (!$('#permissionCheck').checked) {
    $('#importStatus').textContent = '请先确认已获得原文转载及修改权限。'; return;
  }
  if (!url) { $('#importStatus').textContent = '请粘贴公众号文章链接。'; return; }
  $('#importButton').disabled = true;
  $('#importButton').textContent = '读取中…';
  $('#importStatus').textContent = '正在解析文章正文和图片…';
  try {
    const response = await fetch('/api/wechat/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    state.importedMeta = result;
    state.importedHtml = sanitizeImportedHtml(result.content);
    if (result.author) { state.author = result.author; authorInput.value = result.author; }
    if (result.digest) { state.digest = result.digest; digestInput.value = result.digest; }
    $('#importStatus').textContent = `已读取《${result.title}》，可在右侧预览并调整。`;
    render();
  } catch (error) {
    $('#importStatus').textContent = error.message || '读取失败，请确认链接可公开访问。';
  } finally {
    $('#importButton').disabled = false;
    $('#importButton').textContent = '读取原文';
  }
}

async function checkConnection() {
  const card = $('#connectionCard');
  card.className = 'connection-card';
  $('#connectionTitle').textContent = '正在检查连接…';
  try {
    const response = await fetch('/api/health');
    const result = await response.json();
    card.classList.add(result.wechatConfigured ? 'ready' : 'error');
    $('#connectionTitle').textContent = result.wechatConfigured ? '服务端已连接公众号' : '尚未配置公众号密钥';
    $('#connectionDetail').textContent = result.wechatConfigured ? '可保存草稿；发布权限由账号决定' : '在服务端环境变量中配置 AppID 与 AppSecret';
  } catch {
    card.classList.add('error');
    $('#connectionTitle').textContent = '无法连接本地服务';
    $('#connectionDetail').textContent = '请通过 npm start 启动墨流';
  }
}

async function publishToWechat(event) {
  event.preventDefault();
  const button = $('#confirmPublishButton');
  button.disabled = true;
  button.textContent = '正在创建草稿…';
  const article = {
    title: articleTitle.textContent,
    author: state.author,
    digest: state.digest || articleContent.innerText.slice(0, 100),
    content: articleContent.innerHTML,
    sourceUrl: state.importedMeta?.sourceUrl || '',
    thumbMediaId: $('#thumbMediaId').value.trim(),
    openComment: $('#openComment').checked
  };
  try {
    const draftResponse = await fetch('/api/wechat/draft', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(article)
    });
    const draft = await draftResponse.json();
    if (!draftResponse.ok) throw new Error(draft.error);
    if ($('#publishNow').checked) {
      button.textContent = '正在提交发布…';
      const publishResponse = await fetch('/api/wechat/publish', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mediaId: draft.media_id })
      });
      const published = await publishResponse.json();
      if (!publishResponse.ok) throw new Error(published.error);
      toast(`已提交发布，任务 ID：${published.publish_id || '已受理'}`);
    } else toast('已保存到公众号草稿箱');
    $('#publishModal').close();
  } catch (error) {
    toast(error.message || '保存失败，请检查公众号配置', 'error');
  } finally {
    button.disabled = false;
    button.textContent = '保存到公众号草稿';
  }
}

function saveLocalDraft() {
  const drafts = JSON.parse(localStorage.getItem('moli-drafts') || '[]');
  const item = { id: Date.now(), title: articleTitle.textContent, markdown: state.markdown, theme: state.theme, author: state.author, savedAt: new Date().toISOString() };
  localStorage.setItem('moli-drafts', JSON.stringify([item, ...drafts].slice(0, 20)));
  toast('已保存到本地草稿');
}

function showDrafts() {
  const drafts = JSON.parse(localStorage.getItem('moli-drafts') || '[]');
  $('#draftList').innerHTML = drafts.length ? drafts.map(draft => `
    <div class="draft-item">
      <div><b>${escapeHtml(draft.title)}</b><small>${new Date(draft.savedAt).toLocaleString('zh-CN')}</small></div>
      <button type="button" data-draft-id="${draft.id}">恢复</button>
    </div>`).join('') : '<div class="empty-drafts">还没有本地草稿。在编辑时按 ⌘S 保存一份。</div>';
  $('#draftsModal').showModal();
}

markdownInput.value = state.markdown;
authorInput.value = state.author;
$('#articleDate').textContent = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date());

markdownInput.addEventListener('input', event => { state.markdown = event.target.value; render(); markSaving(); });
authorInput.addEventListener('input', event => { state.author = event.target.value; render(); markSaving(); });
digestInput.addEventListener('input', event => { state.digest = event.target.value; markSaving(); });
$$('.mode-tab').forEach(tab => tab.addEventListener('click', () => switchMode(tab.dataset.mode)));
$('#fileInput').addEventListener('change', async event => {
  const [file] = event.target.files;
  if (!file) return;
  state.markdown = await file.text();
  markdownInput.value = state.markdown;
  switchMode('write'); render(); markSaving(); toast(`已导入 ${file.name}`);
});
$('#sampleButton').addEventListener('click', () => { state.markdown = SAMPLE; markdownInput.value = SAMPLE; render(); markSaving(); });
$('#clearButton').addEventListener('click', () => { state.markdown = ''; markdownInput.value = ''; render(); markSaving(); });
$('#importButton').addEventListener('click', importWechatArticle);
$('#insertContent').addEventListener('input', render);
$$('input[name="position"]').forEach(input => input.addEventListener('change', render));
$$('.theme-card').forEach(card => card.addEventListener('click', () => {
  state.theme = card.dataset.theme;
  $$('.theme-card').forEach(item => item.classList.toggle('selected', item === card));
  render(); markSaving();
}));
$$('.theme-card').forEach(card => card.classList.toggle('selected', card.dataset.theme === state.theme));
$$('#rhythmControl button').forEach(button => button.addEventListener('click', () => {
  state.rhythm = button.dataset.rhythm;
  $$('#rhythmControl button').forEach(item => item.classList.toggle('active', item === button));
  $('#rhythmValue').textContent = ({ compact: '紧凑', relaxed: '舒展', airy: '留白' })[state.rhythm];
  render();
}));
$('#fontSizeInput').addEventListener('input', event => { state.fontSize = Number(event.target.value); $('#fontSizeValue').textContent = `${state.fontSize} px`; render(); });
$('#contentWidthInput').addEventListener('input', event => { state.contentWidth = Number(event.target.value); $('#contentWidthValue').textContent = `${state.contentWidth}%`; render(); });
$$('.device-switch button').forEach(button => button.addEventListener('click', () => {
  $$('.device-switch button').forEach(item => item.classList.toggle('active', item === button));
  articlePreview.classList.toggle('wide', button.dataset.width === 'wide');
}));
$('#resetStyleButton').addEventListener('click', () => {
  state.theme = 'clear'; state.rhythm = 'relaxed'; state.fontSize = 16; state.contentWidth = 100;
  $('#fontSizeInput').value = 16; $('#contentWidthInput').value = 100;
  $('#fontSizeValue').textContent = '16 px'; $('#contentWidthValue').textContent = '100%';
  $$('.theme-card').forEach(card => card.classList.toggle('selected', card.dataset.theme === 'clear'));
  $$('#rhythmControl button').forEach(button => button.classList.toggle('active', button.dataset.rhythm === 'relaxed'));
  $('#rhythmValue').textContent = '舒展'; render(); markSaving();
});
$('#copyButton').addEventListener('click', copyRichText);
$('#publishButton').addEventListener('click', () => { $('#publishModal').showModal(); checkConnection(); });
$('#publishForm').addEventListener('submit', publishToWechat);
$('#settingsButton').addEventListener('click', () => $('#settingsModal').showModal());
$('#draftListButton').addEventListener('click', showDrafts);
$('#railDrafts').addEventListener('click', showDrafts);
$('#helpButton').addEventListener('click', () => toast('导入或粘贴内容 → 选择风格 → 复制到公众号，或连接接口保存草稿'));
$$('[data-close-modal]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
$('#draftList').addEventListener('click', event => {
  const button = event.target.closest('[data-draft-id]');
  if (!button) return;
  const drafts = JSON.parse(localStorage.getItem('moli-drafts') || '[]');
  const draft = drafts.find(item => item.id === Number(button.dataset.draftId));
  if (!draft) return;
  Object.assign(state, { markdown: draft.markdown, theme: draft.theme, author: draft.author });
  markdownInput.value = state.markdown; authorInput.value = state.author;
  switchMode('write'); render(); $('#draftsModal').close(); toast('已恢复草稿');
});
document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveLocalDraft(); }
});
document.addEventListener('click', event => {
  if (window.innerWidth <= 1180 && event.target.closest('.preview-header')) $('.style-panel').classList.toggle('open');
});

render();
