// Pure renderer for MaruMori grammar lesson content (TipTap/ProseMirror JSON) to
// a safe HTML string. All text is escaped before any markup is inserted, so the
// only tags emitted are the ones this module controls.

export const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const furigana = /\{([^|{}]+)\|([^{}]+)\}/gu; // {漢字|かな} -> ruby
const targetGrammar = /\[([^\][]+)\]/gu; // [やら] -> highlighted target grammar

// Render a plain text fragment, converting {漢字|かな} furigana to ruby. Used for
// cloze sentence fragments (the text either side of the blank).
export const renderFurigana = (text) => escapeHtml(text).replace(furigana, "<ruby>$1<rt>$2</rt></ruby>");

// Inline MaruMori markup lives inside already-escaped text; the captured groups
// are therefore safe to place back into ruby / mark tags.
const inline = (text) => renderFurigana(text)
  .replace(targetGrammar, '<mark class="g-target">$1</mark>');

const markWrap = (html, marks) => (Array.isArray(marks) ? marks : []).reduce(
  (inner, mark) => ({
    italic: `<em>${inner}</em>`,
    bold: `<strong>${inner}</strong>`,
    underline: `<u>${inner}</u>`,
    strike: `<s>${inner}</s>`,
    code: `<code>${inner}</code>`,
  }[mark?.type] ?? inner),
  html,
);

const children = (node) => (Array.isArray(node?.content) ? node.content : []).map(renderNode).join("");

const headingTag = (level) => `h${Math.min(4, Math.max(2, Number(level) || 3))}`;

const span = (attrs) => (attrs?.colspan > 1 ? ` colspan="${Number(attrs.colspan)}"` : "")
  + (attrs?.rowspan > 1 ? ` rowspan="${Number(attrs.rowspan)}"` : "");

const renderers = Object.freeze({
  text: (node) => markWrap(inline(node.text ?? ""), node.marks),
  heading: (node) => ((tag) => `<${tag}>${children(node)}</${tag}>`)(headingTag(node.attrs?.level)),
  paragraph: (node) => `<p>${children(node)}</p>`,
  blockquote: (node) => `<blockquote class="g-quote">${children(node)}</blockquote>`,
  bulletList: (node) => `<ul>${children(node)}</ul>`,
  listItem: (node) => `<li>${children(node)}</li>`,
  callout: (node) => `<aside class="g-callout">${children(node)}</aside>`,
  calloutHeading: (node) => `<strong class="g-callout-head">${children(node)}</strong>`,
  calloutContent: (node) => `<div class="g-callout-body">${children(node)}</div>`,
  summary: (node) => `<div class="g-summary"><span class="g-summary-label">Summary</span><ul>${children(node)}</ul></div>`,
  table: (node) => `<div class="g-table-wrap"><table class="g-table">${children(node)}</table></div>`,
  tableRow: (node) => `<tr>${children(node)}</tr>`,
  tableHeader: (node) => `<th${span(node.attrs)}>${children(node)}</th>`,
  tableCell: (node) => `<td${span(node.attrs)}>${children(node)}</td>`,
  hardBreak: () => "<br>",
  horizontalRule: () => "<hr>",
});

const renderNode = (node) => (renderers[node?.type] ?? children)(node);

export const renderGrammarBlocks = (content) => (Array.isArray(content) ? content : []).map(renderNode).join("");
