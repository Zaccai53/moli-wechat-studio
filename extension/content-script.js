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
    nativeRepostSource: ['#js_reprint_source'],
    nativeRepostTip: ['#js_reprint_article_tips'],
    nativeRepostDialog: ['.dialog_wrp.share_article_dialog'],
    nativeRepostSearch: ['.share_article_dialog .js_search_input'],
    nativeRepostSearchButton: ['.share_article_dialog .js_search_btn'],
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

  function isVisible(element) {
    if (!element || !element.isConnected) return false;
    const style = element.ownerDocument.defaultView.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && !element.hidden;
  }

  function selectContents(element, position = 'replace') {
    const selection = element.ownerDocument.getSelection();
    const range = element.ownerDocument.createRange();
    range.selectNodeContents(element);
    if (position === 'top') range.collapse(true);
    if (position === 'bottom') range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function pasteIntoEditable(element, html, text, options = {}) {
    if (!element) throw new Error('未找到公众号正文编辑器，请刷新页面后重试');
    const replace = options.replace !== false;
    const position = replace ? 'replace' : (options.position === 'top' ? 'top' : 'bottom');
    element.focus();
    selectContents(element, position);

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
      selectContents(element, position);
      const command = html ? 'insertHTML' : 'insertText';
      const value = html || text;
      if (!element.ownerDocument.execCommand(command, false, value)) {
        const safeValue = html || MoliMarkdown.escapeHtml(text);
        if (replace) element.innerHTML = safeValue;
        else element.insertAdjacentHTML(position === 'top' ? 'afterbegin' : 'beforeend', safeValue);
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

  function nativeRepostState() {
    const search = new URL(location.href).searchParams;
    const dialog = findFirst(SELECTORS.nativeRepostDialog);
    const source = findFirst(SELECTORS.nativeRepostSource);
    const tip = findFirst(SELECTORS.nativeRepostTip);
    const mode = search.get('share') === '1' || isVisible(dialog);
    const modalVisible = isVisible(dialog);
    const sourceVisible = isVisible(source);
    const readOnlyTipVisible = isVisible(tip) && /不支持修改/.test(tip.textContent || '');
    const ready = mode && !modalVisible && (sourceVisible || readOnlyTipVisible);
    return {
      mode,
      modalVisible,
      ready,
      canModify: ready && Boolean(findBodyEditor()) && !readOnlyTipVisible
    };
  }

  function validateWechatUrl(rawUrl) {
    let url;
    try { url = new URL(rawUrl); }
    catch { throw new Error('请输入有效的公众号文章链接'); }
    if (url.protocol !== 'https:' || url.hostname !== 'mp.weixin.qq.com') {
      throw new Error('目前仅支持 https://mp.weixin.qq.com 的文章链接');
    }
    return url.toString();
  }

  function searchNativeRepost(payload) {
    const url = validateWechatUrl(payload.url);
    const input = findFirst(SELECTORS.nativeRepostSearch);
    if (!input || !isVisible(findFirst(SELECTORS.nativeRepostDialog))) {
      throw new Error('请先在公众号后台点击“转载”，进入转载文章窗口');
    }
    setNativeValue(input, url);
    const searchButton = findFirst(SELECTORS.nativeRepostSearchButton);
    if (searchButton) searchButton.click();
    else {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
    }
    return { message: '已在公众号中搜索原文，请选择文章并点击“确定”' };
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

  function applyNativeRepost(payload) {
    const repost = nativeRepostState();
    if (!repost.ready) throw new Error('请先在公众号转载窗口选中原文并点击“确定”');
    const titleField = findFirst(SELECTORS.nativeRepostTitle);
    const contentField = findFirst(SELECTORS.nativeRepostContent);
    if (!titleField || !contentField) {
      throw new Error('当前不是公众号原生转载编辑状态，未找到“编者荐语”字段');
    }
    setNativeValue(titleField, (payload.noteTitle || '编者荐语').slice(0, 10));
    pasteIntoEditable(contentField, '', (payload.note || '').slice(0, 120));
    const warnings = [];
    if (payload.insertBody && payload.bodyNote?.trim()) {
      if (repost.canModify) {
        const note = editorNote(payload.bodyNote, payload.bodyNoteTitle || '编者按');
        pasteIntoEditable(findBodyEditor(), note, plainTextFromHtml(note), {
          replace: false,
          position: payload.position
        });
      } else {
        warnings.push('该原文未授予正文修改权限，已只填写官方荐语。');
      }
    }
    return {
      message: repost.canModify && payload.insertBody ? '已填写荐语并增补正文' : '已填写公众号原生转载荐语',
      warnings
    };
  }

  function imageWarnings(html) {
    const count = (html.match(/<img\b/gi) || []).length;
    return count ? [`检测到 ${count} 张图片。首次保存前请确认公众号已完成图片转存。`] : [];
  }

  function editorStatus() {
    const repost = nativeRepostState();
    return {
      titleEditor: Boolean(findFirst(SELECTORS.titleEditor) || findFirst(SELECTORS.hiddenTitle)),
      bodyEditor: Boolean(findBodyEditor()),
      nativeRepostMode: repost.mode,
      nativeRepostModal: repost.modalVisible,
      nativeRepostReady: repost.ready,
      nativeRepostCanModify: repost.canModify,
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
      case 'SEARCH_NATIVE_REPOST': return searchNativeRepost(payload);
      case 'IMPORT_REPOST': return importRepost(payload);
      case 'APPLY_NATIVE_REPOST': return applyNativeRepost(payload);
      case 'ENHANCE_NATIVE_REPOST': return applyNativeRepost(payload);
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
