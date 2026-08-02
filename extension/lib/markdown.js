(function initMoliMarkdown(global) {
  'use strict';

  const THEMES = {
    clear: {
      accent: '#2f9aa5', accentSoft: '#edf8f8', ink: '#34424d', heading: '#1d2d3a', mark: '#ccebed',
      bodyFont: 'Optima-Regular, PingFangTC-light, PingFang SC, Microsoft YaHei, sans-serif',
      titleFont: 'Songti SC, STSong, serif'
    },
    zen: {
      accent: '#65756a', accentSoft: '#f2f4ee', ink: '#454d47', heading: '#354039', mark: '#dfe5d8',
      bodyFont: 'Songti SC, STSong, serif', titleFont: 'Songti SC, STSong, serif'
    },
    pulse: {
      accent: '#f25f55', accentSoft: '#fff1ef', ink: '#34404f', heading: '#17243b', mark: '#ffd4cf',
      bodyFont: 'PingFang SC, Microsoft YaHei, sans-serif', titleFont: 'PingFang SC, Microsoft YaHei, sans-serif'
    }
  };

  function escapeHtml(value = '') {
    return String(value).replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  function safeUrl(url = '') {
    const decoded = url.replace(/&amp;/g, '&').trim();
    return /^(https?:\/\/|data:image\/)/i.test(decoded) ? escapeHtml(decoded) : '';
  }

  function inline(text, theme) {
    return text
      .replace(/!\[([^\]]*)\]\(([^\s)]+)\)/g, (_all, alt, url) => {
        const src = safeUrl(url);
        return src ? `<img src="${src}" alt="${alt}" style="display:block;max-width:100%;height:auto;margin:24px auto;" />` : alt;
      })
      .replace(/\[([^\]]+)\]\(([^\s)]+)\)/g, (_all, label, url) => {
        const href = safeUrl(url);
        return href ? `<a href="${href}" style="color:${theme.accent};text-decoration:none;border-bottom:1px solid ${theme.accent};">${label}</a>` : label;
      })
      .replace(/`([^`]+)`/g, `<code style="padding:2px 5px;border-radius:4px;color:#27434b;background:#edf3f4;font-family:SFMono-Regular,Consolas,monospace;font-size:0.86em;">$1</code>`)
      .replace(/\*\*([^*]+)\*\*/g, `<strong style="color:${theme.heading};font-weight:700;background:linear-gradient(transparent 68%,${theme.mark} 0);">$1</strong>`)
      .replace(/__([^_]+)__/g, `<strong style="color:${theme.heading};font-weight:700;background:linear-gradient(transparent 68%,${theme.mark} 0);">$1</strong>`)
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em style="color:#657480;">$2</em>');
  }

  function render(markdown, options = {}) {
    const theme = THEMES[options.theme] || THEMES.clear;
    const fontSize = Math.max(14, Math.min(19, Number(options.fontSize) || 16));
    const rhythm = options.rhythm === 'compact' ? { line: 1.7, paragraph: 12 }
      : options.rhythm === 'airy' ? { line: 2.15, paragraph: 26 }
        : { line: 1.95, paragraph: 18 };
    const lines = escapeHtml(String(markdown || '').replace(/\r\n?/g, '\n')).split('\n');
    const output = [];
    let paragraph = [];
    let listType = '';
    let quote = [];
    let code = [];
    let inCode = false;

    const flushParagraph = () => {
      if (!paragraph.length) return;
      output.push(`<p style="margin:${rhythm.paragraph}px 0;text-align:justify;color:${theme.ink};font-family:${theme.bodyFont};font-size:${fontSize}px;line-height:${rhythm.line};letter-spacing:0.025em;">${inline(paragraph.join('<br>'), theme)}</p>`);
      paragraph = [];
    };
    const flushList = () => {
      if (!listType) return;
      output.push(`</${listType}>`);
      listType = '';
    };
    const flushQuote = () => {
      if (!quote.length) return;
      output.push(`<blockquote style="margin:24px 0;padding:17px 18px;color:#50616e;background:${theme.accentSoft};border:0;border-left:3px solid ${theme.accent};font-family:${theme.bodyFont};font-size:${fontSize - 1}px;line-height:1.85;"><p style="margin:0;">${inline(quote.join('<br>'), theme)}</p></blockquote>`);
      quote = [];
    };

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (/^```/.test(line.trim())) {
        flushParagraph(); flushList(); flushQuote();
        if (inCode) {
          output.push(`<pre style="overflow-x:auto;margin:22px 0;padding:17px;color:#d9e8ec;background:#1c2a36;border-radius:5px;font-family:SFMono-Regular,Consolas,monospace;font-size:12px;line-height:1.75;"><code>${code.join('\n')}</code></pre>`);
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
        const headers = line.replace(/^\||\|$/g, '').split('|').map(value => value.trim());
        index += 1;
        const rows = [];
        while (index + 1 < lines.length && lines[index + 1].includes('|') && lines[index + 1].trim()) {
          index += 1;
          rows.push(lines[index].replace(/^\||\|$/g, '').split('|').map(value => value.trim()));
        }
        const cellStyle = `padding:9px 7px;text-align:left;border-bottom:1px solid #dce7e9;font-family:${theme.bodyFont};font-size:${fontSize - 3}px;line-height:1.6;`;
        output.push(`<table style="width:100%;margin:22px 0;border-collapse:collapse;"><thead><tr>${headers.map(value => `<th style="${cellStyle}color:${theme.accent};background:${theme.accentSoft};">${inline(value, theme)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(value => `<td style="${cellStyle}color:${theme.ink};">${inline(value, theme)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
        continue;
      }

      const heading = line.match(/^(#{1,3})\s+(.+)$/);
      if (heading) {
        flushParagraph(); flushList();
        const level = heading[1].length;
        if (level === 1) continue;
        if (level === 2 && options.theme === 'pulse') {
          output.push(`<h2 style="margin:38px 0 20px;padding:9px 13px;color:#fff;background:${theme.heading};font-family:${theme.titleFont};font-size:20px;line-height:1.5;font-weight:700;">${inline(heading[2], theme)}</h2>`);
        } else if (level === 2 && options.theme === 'zen') {
          output.push(`<h2 style="margin:42px 0 22px;padding:0 0 13px;color:${theme.heading};text-align:center;border-bottom:1px solid ${theme.accent};font-family:${theme.titleFont};font-size:20px;line-height:1.5;font-weight:500;letter-spacing:0.1em;">${inline(heading[2], theme)}</h2>`);
        } else if (level === 2) {
          output.push(`<h2 style="margin:38px 0 20px;padding:8px 0 8px 15px;color:${theme.heading};border-left:4px solid ${theme.accent};font-family:${theme.titleFont};font-size:20px;line-height:1.5;font-weight:700;">${inline(heading[2], theme)}</h2>`);
        } else {
          output.push(`<h3 style="margin:30px 0 14px;color:${theme.accent};font-family:${theme.titleFont};font-size:17px;line-height:1.55;font-weight:700;">${inline(heading[2], theme)}</h3>`);
        }
        continue;
      }
      if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
        flushParagraph(); flushList();
        output.push(`<hr style="width:42px;margin:34px auto;border:0;border-top:2px solid ${theme.accent};" />`);
        continue;
      }
      const unordered = line.match(/^\s*[-+*]\s+(.+)$/);
      const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
      if (unordered || ordered) {
        flushParagraph();
        const nextType = unordered ? 'ul' : 'ol';
        if (listType && listType !== nextType) flushList();
        if (!listType) {
          listType = nextType;
          output.push(`<${listType} style="margin:18px 0;padding-left:1.5em;color:${theme.ink};font-family:${theme.bodyFont};font-size:${fontSize}px;line-height:1.85;">`);
        }
        output.push(`<li style="margin:7px 0;padding-left:0.25em;">${inline((unordered || ordered)[1], theme)}</li>`);
        continue;
      }
      flushList();
      if (!line.trim()) { flushParagraph(); continue; }
      paragraph.push(line.trim());
    }
    flushParagraph(); flushList(); flushQuote();
    if (inCode && code.length) {
      output.push(`<pre style="overflow-x:auto;margin:22px 0;padding:17px;color:#d9e8ec;background:#1c2a36;border-radius:5px;font-family:SFMono-Regular,Consolas,monospace;font-size:12px;line-height:1.75;"><code>${code.join('\n')}</code></pre>`);
    }
    return output.join('');
  }

  function title(markdown) {
    const match = String(markdown || '').match(/^#\s+(.+)$/m);
    return match ? match[1].replace(/[*_`]/g, '').trim().slice(0, 64) : '';
  }

  const api = { render, title, escapeHtml, THEMES };
  global.MoliMarkdown = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
