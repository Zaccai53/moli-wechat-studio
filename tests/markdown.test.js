const test = require('node:test');
const assert = require('node:assert/strict');
const { render, title } = require('../extension/lib/markdown.js');

test('extracts the first level-one heading as article title', () => {
  assert.equal(title('intro\n# **测试标题**\nbody'), '测试标题');
  assert.equal(title('## only h2'), '');
});

test('renders supported markdown blocks with inline styles', () => {
  const html = render(`# hidden title

## Section

Paragraph with **bold** and [link](https://example.com).

> quote

- one
- two

| A | B |
| --- | --- |
| 1 | 2 |`);
  assert.doesNotMatch(html, /hidden title/);
  assert.match(html, /<h2 style=/);
  assert.match(html, /<strong style=/);
  assert.match(html, /<blockquote style=/);
  assert.match(html, /<ul style=/);
  assert.match(html, /<table style=/);
});

test('escapes raw html and rejects unsafe links', () => {
  const html = render('hello <script>alert(1)</script> [bad](javascript:alert(1))');
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /href="javascript:/);
});

test('applies distinct theme tokens', () => {
  const clear = render('## Heading', { theme: 'clear' });
  const pulse = render('## Heading', { theme: 'pulse' });
  assert.match(clear, /border-left:4px solid #2f9aa5/);
  assert.match(pulse, /background:#17243b/);
  assert.notEqual(clear, pulse);
});
