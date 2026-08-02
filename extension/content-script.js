(function initMoliContentScript() {
  'use strict';

  if (window.top !== window || document.getElementById('moli-extension-host')) return;

  const host = document.createElement('div');
  host.id = 'moli-extension-host';
  const launcher = document.createElement('button');
  launcher.className = 'moli-launcher';
  launcher.type = 'button';
  launcher.textContent = '墨流';
  launcher.title = '打开墨流排版助手';
  const drawer = document.createElement('div');
  drawer.className = 'moli-drawer';
  const panel = document.createElement('iframe');
  panel.src = chrome.runtime.getURL('panel.html');
  panel.title = '墨流排版助手';
  drawer.append(panel);
  host.append(launcher, drawer);
  document.documentElement.append(host);

  launcher.addEventListener('click', () => drawer.classList.toggle('is-open'));

  const SELECTORS = {
    titleEditor: [
      '#js_title_main .title-editor-overlay .ProseMirror[contenteditable="true"]',
      '.title-editor__input .ProseMirror[contenteditable="true"]'
    ],
    hiddenTitle: ['#title', 'textarea.js_article_title'],
    bodyEditor: [
      '#ueditor_0 .rich_media_content .ProseMirror[contenteditable="true"]',
      '#ueditor_0 .ProseMirror[contenteditable="true"]',
      '.editor-v-root .ProseMirror[contenteditable="true"]'
    ],
    author: ['#author', 'input.js_author'],
    digest: ['#js_description', 'textarea.js_desc'],
    sourceUrl: ['input.js_url[name="source_url"]', 'input[name="source_url"]'],
    nativeRepostTitle: ['.js_reprint_recommend_title'],
    nativeRepostContent: ['.js_reprint_recommend_content[contenteditable="true"]'],
    save: ['#js_submit button', '#js_submit'],
    publish: ['#js_send button', '#js_send']
  };

  function findFirst(names, root = document) {
    for (const selector of names) {
      const node = root.querySelector(selector);
      if (node) return node;
    }
    return null;
  }

  function findBodyEditor() {
    const direct = findFirst(SELECTORS.bodyEditor);
    if (direct) return direct;
    for (const iframe of document.querySelectorAll('#edui1_iframeholder iframe, iframe[id^="ueditor_"]')) {
      try {
        const frameDocument = iframe.contentDocument;
        const editable = frameDocument?.querySelector('[contenteditable="true"]') || frameDocument?.body;
        if (editable) return editable;
      } catch { /* Older cross-origin iframe: no safe DOM access. */ }
    }
    return null;
  }

  function selectContents(element) {
    const selection = element.ownerDocument.getSelection();
    const range = element.ownerDocument.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function pasteIntoEditable(element, html, text) {
    if (!element) throw new Error('未找到公众号正文编辑器，请刷新页面后重试');
    element.focus();
    selectContents(element);

    let handledByEditor = false;
    try {
      const transfer = new DataTransfer();
      transfer.setData('text/html', html);
      transfer.setData('text/plain', text);
      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true, cancelable: true, composed: true, clipboardData: transfer
      });
      handledByEditor = !element.dispatchEvent(pasteEvent);
    } catch { /* DataTransfer construction is unavailable in some Chrome versions. */ }

    if (!handledByEditor) {
      selectContents(element);
      const command = html ? 'insertHTML' : 'insertText';
      const value = html || text;
      if (!element.ownerDocument.execCommand(command, false, value)) {
        element.innerHTML = html || MoliMarkdown.escapeHtml(text);
      }
      element.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        composed: true,
        inputType: 'insertFromPaste',
        data: text
      }));
    }
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setNativeValue(element, value) {
    if (!element) return false;
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    setter ? setter.call(element, value) : (element.value = value);
    element.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: value }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function setTitle(value) {
    if (!value) return;
    const title = value.trim().slice(0, 64);
    const editor = findFirst(SELECTORS.titleEditor);
    if (editor) pasteIntoEditable(editor, '', title);
    setNativeValue(findFirst(SELECTORS.hiddenTitle), title);
  }

  function setArticleMetadata(payload) {
    if (payload.title) setTitle(payload.title);
    if (payload.author) setNativeValue(findFirst(SELECTORS.author), payload.author.slice(0, 8));
    if (payload.digest) setNativeValue(findFirst(SELECTORS.digest), payload.digest.slice(0, 120));
    if (payload.sourceUrl) setNativeValue(findFirst(SELECTORS.sourceUrl), payload.sourceUrl);
  }

  function plainTextFromHtml(html) {
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
    return doc.body.textContent || '';
  }

  function applyMarkdown(payload) {
    const html = MoliMarkdown.render(payload.markdown, payload.options || {});
    if (!html.trim()) throw new Error('Markdown 内容为空');
    setArticleMetadata({
      title: payload.title || MoliMarkdown.title(payload.markdown),
      author: payload.author,
      digest: payload.digest
    });
    pasteIntoEditable(findBodyEditor(), html, plainTextFromHtml(html));
    return { message: '排版内容已写入公众号编辑器', warnings: imageWarnings(html) };
  }

  function getMeta(doc, property) {
    return doc.querySelector(`meta[property="${property}"], meta[name="${property}"]`)?.content?.trim() || '';
  }

  function sanitizeArticleContent(container) {
    const clone = container.cloneNode(true);
    clone.querySelectorAll('script, style, iframe, form, input, button, noscript, mp-common-profile, wx-open-launch-weapp').forEach(node => node.remove());
    clone.querySelectorAll('*').forEach(node => {
      for (const attribute of [...node.attributes]) {
        const keep = ['style', 'src', 'data-src', 'alt', 'href', 'width', 'height'].includes(attribute.name);
        if (!keep || /^on/i.test(attribute.name)) node.removeAttribute(attribute.name);
      }
      if (node.tagName === 'IMG') {
        const source = node.getAttribute('data-src') || node.getAttribute('src');
        if (source && /^https:\/\//i.test(source)) node.setAttribute('src', source);
        node.style.maxWidth = '100%';
        node.style.height = 'auto';
      }
      if (node.tagName === 'A') {
        const href = node.getAttribute('href') || '';
        if (!/^https:\/\//i.test(href)) node.removeAttribute('href');
      }
    });
    return clone.innerHTML;
  }

  function parseWechatArticle(html, sourceUrl) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const content = doc.querySelector('#js_content');
    if (!content) throw new Error('未识别到原文正文');
    const title = getMeta(doc, 'og:title')
      || doc.querySelector('#activity-name')?.textContent?.trim()
      || doc.querySelector('h1')?.textContent?.trim()
      || '转载文章';
    const author = getMeta(doc, 'og:article:author')
      || doc.querySelector('#js_name')?.textContent?.trim()
      || '';
    const digest = getMeta(doc, 'og:description');
    return { title, author, digest, sourceUrl, content: sanitizeArticleContent(content) };
  }

  function editorNote(text, label = '编者按') {
    if (!text?.trim()) return '';
    const escaped = MoliMarkdown.escapeHtml(text.trim()).replace(/\n/g, '<br>');
    return `<section style="margin:20px 0 26px;padding:18px 18px 18px 20px;color:#40505d;background:#edf8f8;border-left:3px solid #2f9aa5;font-family:PingFang SC,Microsoft YaHei,sans-serif;font-size:14px;line-height:1.8;"><strong style="display:block;margin-bottom:7px;color:#2f9aa5;font-size:12px;letter-spacing:0.12em;">${MoliMarkdown.escapeHtml(label)}</strong>${escaped}</section>`;
  }

  async function importRepost(payload) {
    if (!payload.permissionConfirmed) throw new Error('请先确认已获得转载及修改权限');
    const fetched = await chrome.runtime.sendMessage({ type: 'MOLI_FETCH_ARTICLE', url: payload.url });
    if (!fetched?.ok) throw new Error(fetched?.error || '读取原文失败');
    const article = parseWechatArticle(fetched.html, fetched.finalUrl || payload.url);
    const note = editorNote(payload.note, payload.noteTitle || '编者按');
    const content = payload.position === 'bottom' ? article.content + note : note + article.content;
    setArticleMetadata(article);
    pasteIntoEditable(findBodyEditor(), content, plainTextFromHtml(content));
    return {
      message: `已导入《${article.title}》`,
      warnings: imageWarnings(content)
    };
  }

  function enhanceNativeRepost(payload) {
    const titleField = findFirst(SELECTORS.nativeRepostTitle);
    const contentField = findFirst(SELECTORS.nativeRepostContent);
    if (!titleField || !contentField) {
      throw new Error('当前不是公众号原生转载编辑状态，未找到“编者荐语”字段');
    }
    setNativeValue(titleField, (payload.noteTitle || '编者荐语').slice(0, 10));
    pasteIntoEditable(contentField, '', (payload.note || '').slice(0, 120));
    return { message: '已填写公众号原生转载荐语' };
  }

  function imageWarnings(html) {
    const count = (html.match(/<img\b/gi) || []).length;
    return count ? [`检测到 ${count} 张图片。首次保存前请确认公众号已完成图片转存。`] : [];
  }

  function editorStatus() {
    const nativeRepost = Boolean(findFirst(SELECTORS.nativeRepostContent));
    return {
      titleEditor: Boolean(findFirst(SELECTORS.titleEditor)),
      bodyEditor: Boolean(findBodyEditor()),
      nativeRepost,
      saveButton: Boolean(findFirst(SELECTORS.save)),
      publishButton: Boolean(findFirst(SELECTORS.publish)),
      url: location.pathname
    };
  }

  function clickNative(selectorList, missingMessage) {
    const button = findFirst(selectorList);
    if (!button) throw new Error(missingMessage);
    button.click();
    return { message: '已交给公众号处理，请留意页面提示' };
  }

  async function handleAction(action, payload) {
    switch (action) {
      case 'STATUS': return editorStatus();
      case 'APPLY_MARKDOWN': return applyMarkdown(payload);
      case 'IMPORT_REPOST': return importRepost(payload);
      case 'ENHANCE_NATIVE_REPOST': return enhanceNativeRepost(payload);
      case 'SAVE_DRAFT': return clickNative(SELECTORS.save, '未找到“保存为草稿”按钮');
      case 'OPEN_PUBLISH': return clickNative(SELECTORS.publish, '未找到“发表”按钮');
      case 'CLOSE_PANEL': drawer.classList.remove('is-open'); return { message: 'closed' };
      default: throw new Error(`未知操作：${action}`);
    }
  }

  window.addEventListener('message', async event => {
    if (event.source !== panel.contentWindow || event.data?.source !== 'moli-panel') return;
    const { requestId, action, payload = {} } = event.data;
    try {
      const result = await handleAction(action, payload);
      panel.contentWindow.postMessage({ source: 'moli-host', requestId, ok: true, result }, '*');
    } catch (error) {
      panel.contentWindow.postMessage({ source: 'moli-host', requestId, ok: false, error: error.message || '操作失败' }, '*');
    }
  });
})();
