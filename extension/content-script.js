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
  const notice = document.createElement('div');
  notice.className = 'moli-host-notice';
  notice.setAttribute('role', 'status');
  drawer.append(panel);
  host.append(launcher, notice, drawer);
  document.documentElement.append(host);

  const pageUrl = new URL(location.href);
  const isHomePage = location.pathname === '/cgi-bin/home'
    || pageUrl.searchParams.get('t') === 'home/index';

  if (isHomePage) {
    host.classList.add('is-home');
    launcher.textContent = '墨流转载';
    launcher.title = '打开公众号转载，选中文章后自动进入墨流配置';
  }

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
    nativeRepostEntry: [
      '.js_reprint',
      '.js_reprint_btn',
      '.js_reprint_entry',
      '[data-action="reprint"]',
      '[data-action="repost"]'
    ],
    newContentEntry: [
      '.js_add_appmsg',
      '.js_add_content',
      '[data-action="add-content"]'
    ],
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

  let noticeTimer;
  function showHostNotice(message, error = false) {
    clearTimeout(noticeTimer);
    notice.textContent = message;
    notice.classList.toggle('is-error', error);
    notice.classList.add('is-visible');
    noticeTimer = setTimeout(() => notice.classList.remove('is-visible'), 4200);
  }

  async function rememberRepostIntent() {
    if (!chrome.storage?.local) return;
    await chrome.storage.local.set({ moliPendingRepost: Date.now() });
  }

  async function consumeRepostIntent() {
    if (!chrome.storage?.local) return false;
    const stored = await chrome.storage.local.get('moliPendingRepost');
    const startedAt = Number(stored?.moliPendingRepost || 0);
    const active = startedAt > 0 && Date.now() - startedAt < 15 * 60 * 1000;
    if (startedAt) await chrome.storage.local.remove('moliPendingRepost');
    return active;
  }

  const PENDING_NATIVE_APPLY_KEY = 'moliPendingNativeApply';
  const PENDING_NATIVE_APPLY_TTL = 15 * 60 * 1000;
  const PENDING_PUBLIC_FALLBACK_KEY = 'moliPendingPublicFallback';
  let pendingNativeApplyMemory = null;
  let pendingNativeApplyRunning = false;
  let pendingPublicFallbackMemory = null;
  let pendingPublicFallbackRunning = false;

  function activePendingNativeApply(record) {
    const startedAt = Number(record?.startedAt || 0);
    return startedAt > 0 && Date.now() - startedAt < PENDING_NATIVE_APPLY_TTL
      ? record
      : null;
  }

  async function rememberPendingNativeApply(payload) {
    const record = { startedAt: Date.now(), payload };
    pendingNativeApplyMemory = record;
    if (!chrome.storage?.local) return;
    try {
      await chrome.storage.local.set({ [PENDING_NATIVE_APPLY_KEY]: record });
    } catch {
      // Keep one-click continuation working in the current page when a large
      // tail image exceeds Chrome's storage quota. A navigation fallback still
      // preserves all text settings and reports that the image was omitted.
      const fallback = {
        startedAt: record.startedAt,
        payload: { ...payload, tailImage: null },
        tailImageOmitted: Boolean(payload.tailImage)
      };
      await chrome.storage.local.set({ [PENDING_NATIVE_APPLY_KEY]: fallback }).catch(() => {});
    }
  }

  async function pendingNativeApply() {
    const memoryRecord = activePendingNativeApply(pendingNativeApplyMemory);
    if (memoryRecord) return memoryRecord;
    if (!chrome.storage?.local) return null;
    const stored = await chrome.storage.local.get(PENDING_NATIVE_APPLY_KEY);
    return activePendingNativeApply(stored?.[PENDING_NATIVE_APPLY_KEY]);
  }

  async function clearPendingNativeApply() {
    pendingNativeApplyMemory = null;
    if (chrome.storage?.local) await chrome.storage.local.remove(PENDING_NATIVE_APPLY_KEY).catch(() => {});
  }

  async function storePendingPublicFallback(record) {
    pendingPublicFallbackMemory = record;
    if (!chrome.storage?.local) return;
    try {
      await chrome.storage.local.set({ [PENDING_PUBLIC_FALLBACK_KEY]: record });
    } catch {
      const fallback = {
        ...record,
        payload: { ...record.payload, tailImage: null },
        tailImageOmitted: Boolean(record.payload?.tailImage)
      };
      await chrome.storage.local.set({ [PENDING_PUBLIC_FALLBACK_KEY]: fallback }).catch(() => {});
    }
  }

  async function rememberPendingPublicFallback(payload) {
    await storePendingPublicFallback({ startedAt: Date.now(), payload, invalidOriginal: false });
  }

  async function pendingPublicFallback() {
    const memoryRecord = activePendingNativeApply(pendingPublicFallbackMemory);
    if (memoryRecord) return memoryRecord;
    if (!chrome.storage?.local) return null;
    const stored = await chrome.storage.local.get(PENDING_PUBLIC_FALLBACK_KEY);
    return activePendingNativeApply(stored?.[PENDING_PUBLIC_FALLBACK_KEY]);
  }

  async function clearPendingPublicFallback() {
    pendingPublicFallbackMemory = null;
    if (chrome.storage?.local) await chrome.storage.local.remove(PENDING_PUBLIC_FALLBACK_KEY).catch(() => {});
  }

  function openPanel(tab = '') {
    drawer.classList.add('is-open');
    if (!tab) return;
    const notifyPanel = () => panel.contentWindow?.postMessage({
      source: 'moli-host',
      event: 'OPEN_TAB',
      tab
    }, '*');
    notifyPanel();
    panel.addEventListener('load', notifyPanel, { once: true });
  }

  launcher.addEventListener('click', async () => {
    if (!isHomePage) {
      drawer.classList.toggle('is-open');
      return;
    }
    launcher.disabled = true;
    try {
      await rememberRepostIntent();
      await openNativeRepostDialog();
      showHostNotice('请选择要转载的文章；进入编辑页后会自动打开墨流配置');
    } catch (error) {
      if (chrome.storage?.local) await chrome.storage.local.remove('moliPendingRepost').catch(() => {});
      showHostNotice(error.message || '未能打开转载入口', true);
    } finally {
      launcher.disabled = false;
    }
  });

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
    return style.display !== 'none' && style.visibility !== 'hidden' && !element.hidden
      && element.getClientRects().length > 0;
  }

  function clickWechatAction(element) {
    if (!element) return false;
    const link = element.closest?.('a[href]');
    const javascriptLink = link && /^\s*javascript:/i.test(link.getAttribute('href') || '');
    if (!javascriptLink) {
      element.click();
      return true;
    }
    const href = link.getAttribute('href');
    link.removeAttribute('href');
    try {
      element.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: element.ownerDocument.defaultView
      }));
    } finally {
      link.setAttribute('href', href);
    }
    return true;
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

  function editableMatchesText(element, text) {
    const expected = normalizedText(text);
    return Boolean(expected) && normalizedText(element?.textContent) === expected;
  }

  async function waitForEditableText(element, text, timeout = 500) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeout) {
      if (editableMatchesText(element, text)) return true;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return editableMatchesText(element, text);
  }

  async function replaceEditableVerified(element, html, text) {
    pasteIntoEditable(element, html, text);
    if (await waitForEditableText(element, text)) return;

    // Some WeChat editor states cancel the synthetic paste event without
    // applying its clipboard data. Retry at the editor root, then verify the
    // actual DOM instead of treating preventDefault() as proof of success.
    element.focus();
    selectContents(element, 'replace');
    element.ownerDocument.execCommand('insertHTML', false, html);
    if (!editableMatchesText(element, text)) element.innerHTML = html;
    element.dispatchEvent(new InputEvent('input', {
      bubbles: true, composed: true, inputType: 'insertFromPaste', data: text
    }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    if (!await waitForEditableText(element, text)) {
      throw new Error('标题和作者已读取，但正文未能写入公众号编辑器，请刷新页面后重试');
    }
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
    else setNativeValue(findFirst(SELECTORS.hiddenTitle), title);
  }

  function currentTitle() {
    return findFirst(SELECTORS.titleEditor)?.textContent?.trim()
      || findFirst(SELECTORS.hiddenTitle)?.value?.trim()
      || '';
  }

  function transformedTitle(originalTitle, payload) {
    const original = String(originalTitle || '').trim();
    if (payload.titleMode === 'custom') {
      const custom = String(payload.customTitle || '').trim();
      if (!custom) throw new Error('选择自定义标题后，需要填写新标题');
      return custom.slice(0, 64);
    }
    const prefix = '活动推荐 | ';
    return (original.startsWith(prefix) ? original : `${prefix}${original}`).slice(0, 64);
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

  function normalizedText(value) {
    return String(value || '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, '').trim();
  }

  function editorContainsText(element, value) {
    const expected = normalizedText(value);
    return Boolean(expected) && normalizedText(element?.textContent).includes(expected);
  }

  function imageFingerprint(image) {
    const value = String(image?.dataUrl || '');
    if (!value) return '';
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function contentFingerprint(value) {
    const html = String(value || '');
    let hash = 2166136261;
    for (let index = 0; index < html.length; index += 1) {
      hash ^= html.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function matchingImage(element, image) {
    if (!element || !image?.dataUrl) return null;
    const fingerprint = imageFingerprint(image);
    return [...element.querySelectorAll('img')].find(node => {
      const source = node.getAttribute('src') || node.getAttribute('data-src') || '';
      return source === image.dataUrl || node.dataset.moliImage === fingerprint;
    }) || null;
  }

  function editorContainsImage(element, image) {
    if (!element || !image?.dataUrl) return false;
    return Boolean(matchingImage(element, image));
  }

  function tailImageBlock(imageNode) {
    if (!imageNode) return null;
    return imageNode.closest('p, figure') || imageNode;
  }

  function moveTailImageToEnd(element, image) {
    const imageNode = matchingImage(element, image);
    const block = tailImageBlock(imageNode);
    if (!block) return false;
    if (block !== element.lastElementChild) element.append(block);
    element.dispatchEvent(new InputEvent('input', {
      bubbles: true, composed: true, inputType: 'insertFromPaste', data: null
    }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
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

  function scriptString(html, variableName) {
    const escapedName = variableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = html.match(new RegExp(`(?:var\\s+)?${escapedName}\\s*=\\s*("(?:\\\\.|[^"\\\\])*")`));
    if (!match) return '';
    try { return JSON.parse(match[1]); }
    catch { return ''; }
  }

  function parseWechatArticle(html, sourceUrl) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const content = doc.querySelector('#js_content');
    if (!content) throw new Error('未识别到原文正文');
    const title = getMeta(doc, 'og:title')
      || doc.querySelector('#activity-name')?.textContent?.trim()
      || doc.querySelector('h1')?.textContent?.trim()
      || '转载文章';
    const publisher = doc.querySelector('#js_name')?.textContent?.trim()
      || scriptString(html, 'nickname')
      || getMeta(doc, 'og:article:author')
      || '';
    const author = doc.querySelector('#js_author_name, .rich_media_meta_text.rich_media_meta_nickname')?.textContent?.trim()
      || scriptString(html, 'author')
      || getMeta(doc, 'author')
      || publisher;
    const digest = getMeta(doc, 'og:description');
    const isOriginal = Boolean(doc.querySelector('#copyright_logo, #js_original_tag'))
      || /copyright_stat\s*=\s*["']?[1-9]/.test(html);
    return { title, author, publisher, digest, sourceUrl, isOriginal, content: sanitizeArticleContent(content) };
  }

  function editorNote(text, label = '编者按') {
    if (!text?.trim()) return '';
    const escaped = MoliMarkdown.escapeHtml(text.trim()).replace(/\n/g, '<br>');
    return `<section style="margin:20px 0 26px;padding:18px 18px 18px 20px;color:#40505d;background:#edf8f8;border-left:3px solid #2f9aa5;font-family:PingFang SC,Microsoft YaHei,sans-serif;font-size:14px;line-height:1.8;"><strong style="display:block;margin-bottom:7px;color:#2f9aa5;font-size:12px;letter-spacing:0.12em;">${MoliMarkdown.escapeHtml(label)}</strong>${escaped}</section>`;
  }

  function attributionBlock(publisher, author) {
    const sourceName = String(publisher || '').trim();
    const authorName = String(author || '').trim();
    if (!sourceName && !authorName) return '';
    const source = MoliMarkdown.escapeHtml(sourceName || '原公众号');
    const writer = MoliMarkdown.escapeHtml(authorName || '原作者');
    return `<p data-moli-attribution="true" style="margin:18px 0 24px;padding:12px 15px;color:#52616d;background:#f2f6f7;border-radius:4px;font-family:PingFang SC,Microsoft YaHei,sans-serif;font-size:14px;line-height:1.8;">以下文章来源于<strong style="color:#2f7780;font-weight:700;">${source}</strong>，作者<strong style="color:#2f7780;font-weight:700;">${writer}</strong></p>`;
  }

  function isMoliAttributionBlock(element, expectedText) {
    if (!element || normalizedText(element.textContent) !== normalizedText(expectedText)) return false;
    const style = normalizedText(element.getAttribute('style'));
    const background = normalizedText(element.style.backgroundColor);
    return element.dataset.moliAttribution === 'true'
      || style.includes('background:#f2f6f7')
      || background === 'rgb(242,246,247)';
  }

  function platformAttributionPresent(bodyEditor, metadata, attributionText) {
    const publisher = normalizedText(metadata.publisher);
    if (!bodyEditor || !publisher) return false;
    const author = normalizedText(metadata.author);
    const matchesPlatformText = element => {
      if (isMoliAttributionBlock(element, attributionText)) return false;
      const text = normalizedText(element.textContent);
      const hasPublisher = text.includes(`文章来源于${publisher}`)
        || text.includes(`来源于${publisher}`);
      const hasAuthor = !author || text.includes(`作者${author}`);
      return hasPublisher && hasAuthor;
    };
    const blocks = bodyEditor.querySelectorAll('p, section, [data-reprint-source], [class*="reprint"]');
    if ([...blocks].some(matchesPlatformText)) return true;
    const moliBlocks = [...bodyEditor.querySelectorAll('p, section')]
      .filter(element => isMoliAttributionBlock(element, attributionText));
    return moliBlocks.length === 0 && matchesPlatformText(bodyEditor);
  }

  function removeDuplicateMoliAttribution(bodyEditor, attributionText) {
    const blocks = [...bodyEditor.querySelectorAll('p, section')]
      .filter(element => isMoliAttributionBlock(element, attributionText));
    if (!blocks.length) return false;
    blocks.forEach(element => element.remove());
    bodyEditor.dispatchEvent(new InputEvent('input', {
      bubbles: true, composed: true, inputType: 'deleteContent', data: null
    }));
    bodyEditor.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function dataUrlToFile(image) {
    if (!image?.dataUrl || !/^data:image\//i.test(image.dataUrl)) throw new Error('尾图数据无效，请重新选择图片');
    const [header, encoded] = image.dataUrl.split(',', 2);
    const mimeType = header.match(/^data:([^;]+)/i)?.[1] || image.type || 'image/png';
    const binary = atob(encoded || '');
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new File([bytes], image.name || 'moli-tail-image.png', { type: mimeType });
  }

  function pasteImageIntoEditable(element, image) {
    if (!image?.dataUrl) return { inserted: false, uploadedByWechat: false };
    if (!element) throw new Error('未找到可插入尾图的正文编辑器');
    if (editorContainsImage(element, image)) {
      const movedToEnd = moveTailImageToEnd(element, image);
      return { inserted: false, uploadedByWechat: false, duplicate: true, movedToEnd };
    }
    const imagesBeforePaste = new Set(element.querySelectorAll('img'));
    element.focus();
    selectContents(element, 'bottom');
    let handledByWechat = false;
    try {
      const transfer = new DataTransfer();
      transfer.items.add(dataUrlToFile(image));
      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true, cancelable: true, composed: true, clipboardData: transfer
      });
      handledByWechat = !element.dispatchEvent(pasteEvent);
    } catch { /* Fall through to a data URL image for older Chrome builds. */ }
    if (!handledByWechat) {
      selectContents(element, 'bottom');
      const safeDataUrl = /^data:image\/(png|jpeg|jpg|gif|webp);base64,[a-z0-9+/=]+$/i.test(image.dataUrl)
        ? image.dataUrl : '';
      if (!safeDataUrl) throw new Error('尾图格式不受支持');
      const fingerprint = imageFingerprint(image);
      const html = `<p style="margin:26px 0 0;text-align:center;"><img src="${safeDataUrl}" data-moli-image="${fingerprint}" alt="" style="display:block;max-width:100%;height:auto;margin:0 auto;" /></p>`;
      if (!element.ownerDocument.execCommand('insertHTML', false, html)) element.insertAdjacentHTML('beforeend', html);
      element.dispatchEvent(new InputEvent('input', {
        bubbles: true, composed: true, inputType: 'insertFromPaste', data: null
      }));
    }
    const fingerprints = new Set(String(element.dataset.moliImages || '').split(',').filter(Boolean));
    const fingerprint = imageFingerprint(image);
    fingerprints.add(fingerprint);
    element.dataset.moliImages = [...fingerprints].join(',');
    const insertedImage = [...element.querySelectorAll('img')].find(node => !imagesBeforePaste.has(node));
    if (insertedImage) insertedImage.dataset.moliImage = fingerprint;
    moveTailImageToEnd(element, image);
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return { inserted: true, uploadedByWechat: handledByWechat };
  }

  function nativeRepostMetadata() {
    return {
      publisher: document.querySelector('.js_reprint_biz_nickname')?.textContent?.trim() || '',
      author: document.querySelector('.js_reprint_author')?.textContent?.trim() || ''
    };
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

  function waitForVisible(selectorList, timeout = 3000) {
    const startedAt = Date.now();
    return new Promise(resolve => {
      const check = () => {
        const element = findFirst(selectorList);
        if (element && isVisible(element)) return resolve(element);
        if (Date.now() - startedAt >= timeout) return resolve(null);
        setTimeout(check, 80);
      };
      check();
    });
  }

  function visibleActionByText(labels) {
    const expected = new Set(labels.map(normalizedText));
    const candidates = document.querySelectorAll('body *');
    const matches = [...candidates].filter(element => {
      if (!isVisible(element) || host.contains(element)) return false;
      const values = [element.textContent, element.getAttribute('aria-label'), element.getAttribute('title')]
        .map(normalizedText).filter(Boolean);
      return values.some(value => expected.has(value));
    });
    // Prefer the smallest matching leaf. WeChat often binds the click listener on
    // a parent div while the visible label lives in a span; clicking the span lets
    // the native event bubble to that parent without depending on private classes.
    return matches.sort((left, right) => {
      const leftChildren = left.querySelectorAll('*').length;
      const rightChildren = right.querySelectorAll('*').length;
      return leftChildren - rightChildren;
    })[0] || null;
  }

  function nativeRepostEntry() {
    const known = findFirst(SELECTORS.nativeRepostEntry);
    if (known && isVisible(known) && !host.contains(known)) return known;
    return visibleActionByText(['转载', '转载文章']);
  }

  function newContentEntry() {
    const known = findFirst(SELECTORS.newContentEntry);
    if (known && isVisible(known) && !host.contains(known)) return known;
    return visibleActionByText(['新建内容', '新建图文', '更多']);
  }

  function enhanceHomeRepostEntry() {
    if (!isHomePage) return;
    const entry = nativeRepostEntry();
    if (!entry || entry.dataset.moliRepostReady === 'true') return;
    const action = entry.closest('button, a, [role="button"], [onclick]') || entry.parentElement || entry;
    entry.dataset.moliRepostReady = 'true';
    entry.classList.add('moli-native-repost-entry');
    entry.title = '选中文章后，墨流会自动打开转载配置';
    action.addEventListener('click', () => {
      rememberRepostIntent().catch(() => {});
    }, { capture: true });
  }

  async function revealNativeRepostEntry() {
    let entry = nativeRepostEntry();
    if (entry) return entry;
    const menuTrigger = newContentEntry();
    if (!menuTrigger) return null;
    clickWechatAction(menuTrigger);
    const startedAt = Date.now();
    while (Date.now() - startedAt < 3000) {
      entry = nativeRepostEntry();
      if (entry) return entry;
      await new Promise(resolve => setTimeout(resolve, 80));
    }
    return null;
  }

  async function openNativeRepostDialog() {
    const visibleDialog = findFirst(SELECTORS.nativeRepostDialog);
    if (isVisible(visibleDialog)) return visibleDialog;
    const entry = await revealNativeRepostEntry();
    if (!entry) throw new Error('未找到公众号页面中的“转载”按钮，请确认当前是图文编辑页');
    drawer.classList.remove('is-open');
    clickWechatAction(entry);
    const dialog = await waitForVisible(SELECTORS.nativeRepostDialog);
    if (!dialog) throw new Error('已点击“转载”，但公众号转载窗口未打开，请检查页面提示');
    return dialog;
  }

  async function searchNativeRepost(payload) {
    const url = validateWechatUrl(payload.url);
    await openNativeRepostDialog();
    const input = await waitForVisible(SELECTORS.nativeRepostSearch);
    if (!input) throw new Error('转载窗口已打开，但未找到原文搜索框');
    setNativeValue(input, url);
    await rememberPendingPublicFallback({ ...payload, url });
    const searchButton = findFirst(SELECTORS.nativeRepostSearchButton);
    if (searchButton) clickWechatAction(searchButton);
    else {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
    }
    setTimeout(maybeHandlePendingPublicFallback, 0);
    return { message: '已自动打开转载窗口并搜索原文，请选择文章并点击“确定”' };
  }

  function nativeSearchRejectedAsNonOriginal() {
    const dialog = findFirst(SELECTORS.nativeRepostDialog);
    if (!isVisible(dialog)) return false;
    const text = normalizedText(dialog.textContent);
    return /不是有效的账号原创文章链接|不是有效的原创文章链接|该文章未声明原创|无法转载非原创文章/.test(text);
  }

  async function maybeHandlePendingPublicFallback() {
    if (pendingPublicFallbackRunning) return;
    const record = await pendingPublicFallback();
    if (!record || pendingPublicFallbackRunning) return;

    if (!record.invalidOriginal) {
      if (nativeSearchRejectedAsNonOriginal()) {
        record.invalidOriginal = true;
        await storePendingPublicFallback(record);
        await clearPendingNativeApply();
        showHostNotice(record.payload.permissionConfirmed
          ? '检测到该文章未声明原创；关闭转载窗口后将自动按公开正文导入'
          : '检测到该文章未声明原创；如已获单独授权，请勾选授权后使用公开正文直导');
      } else if (nativeRepostState().ready) {
        await clearPendingPublicFallback();
      }
      return;
    }

    if (isVisible(findFirst(SELECTORS.nativeRepostDialog)) || !findBodyEditor()) return;
    if (!record.payload.permissionConfirmed) {
      await clearPendingPublicFallback();
      openPanel('repost');
      showHostNotice('该文章无法原生转载；请确认单独授权并勾选后，再点击“尝试直接读取公开正文”', true);
      return;
    }

    pendingPublicFallbackRunning = true;
    try {
      const result = await queueImportRepost(record.payload);
      if (record.tailImageOmitted) {
        result.warnings.push('页面跳转时结尾图片因体积过大未能暂存，请重新选择后应用。');
      }
      await clearPendingPublicFallback();
      const warning = result.warnings.length ? `；${result.warnings.join(' ')}` : '';
      showHostNotice(`原生转载不可用，已自动改用公开正文直导；${result.message}${warning}`);
    } catch (error) {
      await clearPendingPublicFallback();
      openPanel('repost');
      showHostNotice(error.message || '公开正文自动导入失败，请点击按钮重试', true);
    } finally {
      pendingPublicFallbackRunning = false;
    }
  }

  async function importRepost(payload) {
    if (!payload.permissionConfirmed) throw new Error('请先确认已获得转载及修改权限');
    const fetched = await chrome.runtime.sendMessage({ type: 'MOLI_FETCH_ARTICLE', url: payload.url });
    if (!fetched?.ok) throw new Error(fetched?.error || '读取原文失败');
    const article = parseWechatArticle(fetched.html, fetched.finalUrl || payload.url);
    const attribution = attributionBlock(article.publisher, article.author);
    const note = editorNote(payload.bodyNote || payload.note, payload.bodyNoteTitle || '编者按');
    let content = attribution + article.content;
    if (note) content = payload.position === 'bottom' ? content + note : attribution + note + article.content;
    const warnings = imageWarnings(content);
    const desiredTitle = transformedTitle(article.title, payload);
    if (normalizedText(currentTitle()) === normalizedText(desiredTitle)) {
      warnings.push('标题已是目标内容，已跳过重复写入。');
    } else {
      setTitle(desiredTitle);
    }
    setArticleMetadata({ ...article, title: '' });
    const bodyEditor = findBodyEditor();
    const desiredFingerprint = contentFingerprint(content);
    const existingTailBlock = tailImageBlock(matchingImage(bodyEditor, payload.tailImage));
    const desiredText = plainTextFromHtml(content);
    const sameContent = editableMatchesText(bodyEditor, desiredText);
    if (sameContent) {
      warnings.push('图文正文已是目标内容，已跳过重复写入。');
    } else {
      if (existingTailBlock) existingTailBlock.remove();
      await replaceEditableVerified(bodyEditor, content, desiredText);
      bodyEditor.dataset.moliImport = desiredFingerprint;
      if (existingTailBlock) bodyEditor.append(existingTailBlock);
    }
    if (!sameContent && !existingTailBlock && payload.tailImage) {
      const fingerprints = new Set(String(bodyEditor.dataset.moliImages || '').split(',').filter(Boolean));
      fingerprints.delete(imageFingerprint(payload.tailImage));
      bodyEditor.dataset.moliImages = [...fingerprints].join(',');
    }
    const imageResult = pasteImageIntoEditable(bodyEditor, payload.tailImage);
    if (imageResult.duplicate && imageResult.movedToEnd) warnings.push('全文中已存在相同尾图，已保留并移动到文章结尾。');
    else if (imageResult.duplicate) warnings.push('全文中已存在相同尾图，已跳过重复添加。');
    if (imageResult.inserted && !imageResult.uploadedByWechat) warnings.push('尾图已插入，保存前请确认公众号完成图片转存。');
    if (!article.isOriginal) warnings.push('未检测到原创标识，已按普通新文章导入。');
    return {
      message: `已导入《${article.title}》`,
      warnings
    };
  }

  async function applyNativeRepostReady(payload, options = {}) {
    const repost = nativeRepostState();
    if (!repost.ready) throw new Error('转载原文仍在载入，请稍后重试');
    await clearPendingPublicFallback();
    const titleField = findFirst(SELECTORS.nativeRepostTitle);
    const contentField = findFirst(SELECTORS.nativeRepostContent);
    if (!titleField || !contentField) {
      throw new Error('当前不是公众号原生转载编辑状态，未找到“编者荐语”字段');
    }
    setNativeValue(titleField, (payload.noteTitle || '编者荐语').slice(0, 10));
    pasteIntoEditable(contentField, '', (payload.note || '').slice(0, 120));
    const warnings = [];
    if (repost.canModify) {
      const oldTitle = currentTitle();
      const newTitle = transformedTitle(oldTitle, payload);
      if (newTitle !== oldTitle) setTitle(newTitle);
      else warnings.push('标题增补已存在，已跳过重复添加。');
    }
    if (payload.insertBody) {
      if (repost.canModify) {
        const bodyEditor = findBodyEditor();
        const metadata = nativeRepostMetadata();
        const attribution = attributionBlock(metadata.publisher, metadata.author);
        const note = editorNote(payload.bodyNote, payload.bodyNoteTitle || '编者按');
        const attributionText = plainTextFromHtml(attribution);
        const noteText = plainTextFromHtml(note);
        const hasPlatformAttribution = attribution
          && platformAttributionPresent(bodyEditor, metadata, attributionText);
        const removedDuplicateAttribution = hasPlatformAttribution
          && removeDuplicateMoliAttribution(bodyEditor, attributionText);
        const hasAttribution = hasPlatformAttribution
          || (attribution && editorContainsText(bodyEditor, attributionText));
        const hasNote = note && editorContainsText(bodyEditor, payload.bodyNote || noteText);
        if (note && !hasNote && payload.position === 'top') {
          pasteIntoEditable(bodyEditor, note, noteText, { replace: false, position: 'top' });
        }
        if (attribution && !hasAttribution) pasteIntoEditable(bodyEditor, attribution, attributionText, { replace: false, position: 'top' });
        if (note && !hasNote && payload.position === 'bottom') {
          pasteIntoEditable(bodyEditor, note, noteText, { replace: false, position: 'bottom' });
        }
        if (removedDuplicateAttribution) warnings.push('已移除与微信原生介绍重复的墨流来源署名。');
        else if (hasPlatformAttribution) warnings.push('微信已提供原生来源介绍，已跳过重复添加。');
        else if (hasAttribution) warnings.push('全文中已存在相同来源署名，已跳过重复添加。');
        if (hasNote) warnings.push('全文中已存在相同正文增补，已跳过重复添加。');
        const imageResult = pasteImageIntoEditable(bodyEditor, payload.tailImage);
        if (imageResult.duplicate) warnings.push('全文中已存在相同尾图，已跳过重复添加。');
        if (imageResult.inserted && !imageResult.uploadedByWechat) warnings.push('尾图已插入，保存前请确认公众号完成图片转存。');
        if (!metadata.publisher || !metadata.author) warnings.push('来源账号或作者未完整识别，请检查文首署名。');
      } else {
        warnings.push('该原文未授予正文修改权限，未改标题和正文；如有单独授权，可使用下方公开正文直导。');
      }
    }
    return {
      message: options.automatic
        ? (repost.canModify && payload.insertBody ? '原生转载已自动增补完成' : '原生转载荐语已自动填写')
        : (repost.canModify && payload.insertBody ? '已填写荐语并增补正文' : '已填写公众号原生转载荐语'),
      warnings
    };
  }

  async function applyNativeRepost(payload) {
    const repost = nativeRepostState();
    if (!repost.ready) {
      await rememberPendingNativeApply(payload);
      try {
        const searchResult = await searchNativeRepost(payload);
        return {
          ...searchResult,
          pendingSelection: true,
          warnings: ['选中原文并点击公众号的“转载”后，墨流会自动完成增补。']
        };
      } catch (error) {
        await clearPendingNativeApply();
        throw error;
      }
    }
    const result = await applyNativeRepostReady(payload);
    await clearPendingNativeApply();
    return result;
  }

  async function maybeApplyPendingNativeRepost() {
    if (pendingNativeApplyRunning || !nativeRepostState().ready) return;
    const record = await pendingNativeApply();
    if (!record || pendingNativeApplyRunning || !nativeRepostState().ready) return;
    pendingNativeApplyRunning = true;
    try {
      const result = await applyNativeRepostReady(record.payload, { automatic: true });
      if (record.tailImageOmitted) {
        result.warnings.push('页面跳转时结尾图片因体积过大未能暂存，请重新选择后应用。');
      }
      await clearPendingNativeApply();
      const warning = result.warnings.length ? `；${result.warnings.join(' ')}` : '';
      showHostNotice(`${result.message}${warning}`);
    } catch (error) {
      await clearPendingNativeApply();
      showHostNotice(error.message || '原生转载自动增补失败，请再次点击应用', true);
    } finally {
      pendingNativeApplyRunning = false;
    }
  }

  function imageWarnings(html) {
    const count = (html.match(/<img\b/gi) || []).length;
    return count ? [`检测到 ${count} 张图片。首次保存前请确认公众号已完成图片转存。`] : [];
  }

  function editorStatus() {
    const repost = nativeRepostState();
    const metadata = nativeRepostMetadata();
    return {
      titleEditor: Boolean(findFirst(SELECTORS.titleEditor) || findFirst(SELECTORS.hiddenTitle)),
      bodyEditor: Boolean(findBodyEditor()),
      nativeRepostMode: repost.mode,
      nativeRepostModal: repost.modalVisible,
      nativeRepostReady: repost.ready,
      nativeRepostCanModify: repost.canModify,
      nativePublisher: metadata.publisher,
      nativeAuthor: metadata.author,
      saveButton: Boolean(findFirst(SELECTORS.save)),
      publishButton: Boolean(findFirst(SELECTORS.publish)),
      url: location.pathname
    };
  }

  function clickNative(selectorList, missingMessage) {
    const button = findFirst(selectorList);
    if (!button) throw new Error(missingMessage);
    clickWechatAction(button);
    return { message: '已交给公众号处理，请留意页面提示' };
  }

  async function handleAction(action, payload) {
    switch (action) {
      case 'STATUS': return editorStatus();
      case 'APPLY_MARKDOWN': return applyMarkdown(payload);
      case 'SEARCH_NATIVE_REPOST': return searchNativeRepost(payload);
      case 'IMPORT_REPOST':
        await clearPendingPublicFallback();
        await clearPendingNativeApply();
        return queueImportRepost(payload);
      case 'APPLY_NATIVE_REPOST': return applyNativeRepost(payload);
      case 'ENHANCE_NATIVE_REPOST': return applyNativeRepost(payload);
      case 'SAVE_DRAFT': return clickNative(SELECTORS.save, '未找到“保存为草稿”按钮');
      case 'OPEN_PUBLISH': return clickNative(SELECTORS.publish, '未找到“发表”按钮');
      case 'CLOSE_PANEL': drawer.classList.remove('is-open'); return { message: 'closed' };
      default: throw new Error(`未知操作：${action}`);
    }
  }

  let importQueue = Promise.resolve();
  function queueImportRepost(payload) {
    const current = importQueue.then(() => importRepost(payload));
    importQueue = current.catch(() => {});
    return current;
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

  if (isHomePage) {
    enhanceHomeRepostEntry();
    const homeObserver = new MutationObserver(enhanceHomeRepostEntry);
    homeObserver.observe(document.body, { childList: true, subtree: true });
  } else if (new URL(location.href).searchParams.get('share') === '1') {
    consumeRepostIntent().then(shouldOpen => {
      if (shouldOpen) openPanel('repost');
    }).catch(() => {});
  }

  if (!isHomePage) {
    let pendingActionTimer;
    const schedulePendingActions = () => {
      clearTimeout(pendingActionTimer);
      pendingActionTimer = setTimeout(() => {
        maybeApplyPendingNativeRepost();
        maybeHandlePendingPublicFallback();
      }, 350);
    };
    const repostObserver = new MutationObserver(schedulePendingActions);
    repostObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden']
    });
    schedulePendingActions();
  }
})();
