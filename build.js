#!/usr/bin/env node
'use strict';

/*
 * build.js — bundle the app into single-file outputs.
 *
 * Everything below is generated from the real sources (index.html, styles.css,
 * scoring.js, app.js). Nothing is hand-copied, so the bundles can never drift
 * from the app you actually develop against.
 *
 * Outputs:
 *   dist/yahtzee.html       a complete standalone document: open it in any
 *                           browser, offline, and you get the whole app.
 *   dist/artifact-page.html a fragment for a host that supplies its own
 *                           <html>/<head>/<body> and stamps data-theme on the
 *                           root element.
 *
 * Extra copies of the artifact fragment can be written with:
 *   node build.js --artifact-out=/some/where/artifact-page.html
 */

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');

const readSource = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

/* ------------------------------------------------------------------ *
 * Inlining hazards
 *
 * Raw-text elements end at the first "</script" / "</style" the HTML
 * tokenizer sees — even inside a JS string, a regex or a comment. Backslash
 * escaping the slash hides the sequence from the tokenizer while keeping the
 * value identical for the JS/CSS parser. "<!--" gets the same treatment
 * because JS still honours HTML-style comment openers.
 * ------------------------------------------------------------------ */

const hazards = [];

function escapeForScript(js, label) {
  let hits = 0;
  const out = js
    .replace(/<\/(script)/gi, (m, tag) => { hits++; return '<\\/' + tag; })
    .replace(/<!--/g, () => { hits++; return '<\\!--'; });
  if (hits) hazards.push(`${label}: escaped ${hits} script-closing sequence(s)`);
  return out;
}

function escapeForStyle(css, label) {
  let hits = 0;
  const out = css.replace(/<\/(style)/gi, (m, tag) => { hits++; return '<\\/' + tag; });
  if (hits) hazards.push(`${label}: escaped ${hits} style-closing sequence(s)`);
  return out;
}

/* ------------------------------------------------------------------ *
 * A very small CSS scanner: enough to find rules and balanced blocks
 * while ignoring braces that live inside comments or strings.
 * ------------------------------------------------------------------ */

function skipString(css, i) {
  const quote = css[i];
  for (let j = i + 1; j < css.length; j++) {
    if (css[j] === '\\') { j++; continue; }
    if (css[j] === quote) return j;
  }
  throw new Error('unterminated string in CSS near offset ' + i);
}

function matchBrace(css, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < css.length; i++) {
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end === -1 ? css.length : end + 1;
      continue;
    }
    if (c === '"' || c === "'") { i = skipString(css, i); continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i; }
  }
  throw new Error('unbalanced braces in CSS starting at offset ' + openIndex);
}

function findOpenBrace(css, from) {
  for (let i = from; i < css.length; i++) {
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end === -1 ? css.length : end + 1;
      continue;
    }
    if (c === '"' || c === "'") { i = skipString(css, i); continue; }
    if (c === '{') return i;
  }
  return -1;
}

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

/** Split a chunk of CSS into top-level `{ selector, body, start, end }` rules. */
function parseRules(css) {
  const rules = [];
  let cursor = 0;
  while (cursor < css.length) {
    const open = findOpenBrace(css, cursor);
    if (open === -1) break;
    const close = matchBrace(css, open);
    const selector = stripComments(css.slice(cursor, open)).trim();
    if (selector) {
      rules.push({
        selector,
        body: css.slice(open + 1, close),
        start: cursor,
        end: close + 1
      });
    }
    cursor = close + 1;
  }
  return rules;
}

/** Property names declared directly in a rule body. */
function declaredProps(body) {
  return stripComments(body)
    .split(';')
    .map((chunk) => chunk.slice(0, chunk.indexOf(':')).trim())
    .filter(Boolean);
}

/* ------------------------------------------------------------------ *
 * Theme rewrite for the hosted fragment.
 *
 * styles.css states the light palette on a bare :root and the dark palette
 * inside @media (prefers-color-scheme: dark). A host that stamps
 * data-theme="dark" / "light" on the root element needs the dark values in two
 * places instead, so we lift every `prefers-color-scheme: dark` block out of
 * the stylesheet and re-emit its rules under:
 *
 *   @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) … }
 *   :root[data-theme="dark"] …
 *
 * The light palette stays exactly where it was, on bare :root, so no colour is
 * ever defined only inside a media or [data-theme] block.
 * ------------------------------------------------------------------ */

const DARK_MEDIA = /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*/gi;

function extractDarkBlocks(css) {
  const blocks = [];
  let light = '';
  let cursor = 0;
  DARK_MEDIA.lastIndex = 0;
  let m;
  while ((m = DARK_MEDIA.exec(css))) {
    const open = findOpenBrace(css, m.index + m[0].length - 1);
    if (open === -1) throw new Error('dark @media block has no body');
    const close = matchBrace(css, open);
    light += css.slice(cursor, m.index);
    blocks.push(parseRules(css.slice(open + 1, close)));
    cursor = close + 1;
    DARK_MEDIA.lastIndex = cursor;
  }
  light += css.slice(cursor);
  return { light: light.replace(/\n{3,}/g, '\n\n'), darkRules: [].concat.apply([], blocks) };
}

/**
 * ":root" -> "<base>", ".btn" -> ":where(<base>) .btn", per comma-separated part.
 *
 * The :where() wrapper is load-bearing. A plain descendant selector would raise
 * the rule's specificity, so a dark `.btn` would start beating a later
 * `.btn-quiet` that legitimately overrode it inside the media query — the quiet
 * buttons then render their dark-mode text colour on a dark background and
 * vanish. :where() contributes zero specificity, so each rule keeps competing
 * with its neighbours exactly as it did before the rewrite.
 *
 * Root-level rules are the exception: they must outrank the bare :root light
 * palette, so they take the real selector.
 */
function rescope(selector, base) {
  return selector
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => (part === ':root' || part === 'html' ? base : ':where(' + base + ') ' + part))
    .join(',\n  ');
}

function emitRules(darkRules, base, indent) {
  return darkRules
    .map((rule) => {
      const decls = rule.body
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => indent + '  ' + line)
        .join('\n');
      return indent + rescope(rule.selector, base) + ' {\n' + decls + '\n' + indent + '}';
    })
    .join('\n\n');
}

/**
 * Drift guard: every property a dark rule overrides must already have a value
 * on the same selector outside any media / [data-theme] block, otherwise the
 * fragment would have a colour that only exists in dark mode.
 */
function assertNoDarkOnlyValues(lightCss, darkRules) {
  const base = new Map();
  for (const rule of parseRules(lightCss)) {
    if (rule.selector.startsWith('@')) continue;
    for (const sel of rule.selector.split(',').map((s) => s.trim())) {
      if (!base.has(sel)) base.set(sel, new Set());
      const set = base.get(sel);
      declaredProps(rule.body).forEach((p) => set.add(p));
    }
  }
  const missing = [];
  for (const rule of darkRules) {
    for (const sel of rule.selector.split(',').map((s) => s.trim())) {
      const known = base.get(sel) || new Set();
      for (const prop of declaredProps(rule.body)) {
        if (!known.has(prop)) missing.push(`${sel} { ${prop} }`);
      }
    }
  }
  if (missing.length) {
    throw new Error(
      'These values exist only in the dark block — give them a base value in styles.css:\n  ' +
      missing.join('\n  ')
    );
  }
}

function assertTokenBackgroundOnBody(lightCss) {
  const bodyRule = parseRules(lightCss).find((r) =>
    r.selector.split(',').map((s) => s.trim()).includes('body')
  );
  if (!bodyRule || !/background\s*:\s*var\(--/.test(bodyRule.body)) {
    throw new Error('body must keep an explicit token background (background: var(--…))');
  }
}

const MEDIA_BASE = ':root:not([data-theme="light"])';
const ATTR_BASE = ':root[data-theme="dark"]';

/**
 * Each dark block is rewritten WHERE IT STANDS, never moved to the end of the
 * stylesheet. Source order is half of the cascade: hoisting these rules past
 * later ones would change which declaration wins even with specificity held
 * steady by rescope().
 */
function renderDarkPair(rules) {
  return [
    '/* dark palette — generated by build.js from the @media block in styles.css.',
    ' * Emitted twice: once for the viewer\'s system setting (unless an explicit',
    ' * light stamp overrides it), once for a data-theme="dark" stamp. */',
    '@media (prefers-color-scheme: dark) {',
    emitRules(rules, MEDIA_BASE, '  '),
    '}',
    '',
    emitRules(rules, ATTR_BASE, '')
  ].join('\n');
}

function themeAwareCss(css) {
  const { light, darkRules } = extractDarkBlocks(css);
  if (!darkRules.length) throw new Error('no prefers-color-scheme: dark block found in styles.css');
  assertNoDarkOnlyValues(light, darkRules);
  assertTokenBackgroundOnBody(light);

  let out = '';
  let cursor = 0;
  let blocks = 0;
  DARK_MEDIA.lastIndex = 0;
  let m;
  while ((m = DARK_MEDIA.exec(css))) {
    const open = findOpenBrace(css, m.index + m[0].length - 1);
    if (open === -1) throw new Error('dark @media block has no body');
    const close = matchBrace(css, open);
    out += css.slice(cursor, m.index) + renderDarkPair(parseRules(css.slice(open + 1, close)));
    cursor = close + 1;
    DARK_MEDIA.lastIndex = cursor;
    blocks++;
  }
  out += css.slice(cursor);

  if (blocks !== darkRules.length && blocks === 0) throw new Error('dark blocks were not rewritten');
  assertSpecificityPreserved(darkRules, out);
  return out;
}

/**
 * Guards the rescope() contract: every dark rule that is not root-level must
 * appear wrapped in :where(), so the rewrite cannot silently start winning
 * cascade fights the original stylesheet lost on purpose.
 */
function assertSpecificityPreserved(darkRules, out) {
  const unwrapped = [];
  for (const rule of darkRules) {
    for (const part of rule.selector.split(',').map((s) => s.trim()).filter(Boolean)) {
      if (part === ':root' || part === 'html') continue;
      for (const base of [MEDIA_BASE, ATTR_BASE]) {
        if (!out.includes(':where(' + base + ') ' + part)) unwrapped.push(part + ' under ' + base);
      }
    }
  }
  if (unwrapped.length) {
    throw new Error(
      'these dark rules would outrank their neighbours after rewriting:\n  ' + unwrapped.join('\n  ')
    );
  }
}

/* ------------------------------------------------------------------ *
 * HTML assembly
 * ------------------------------------------------------------------ */

const STYLESHEET_LINK = /[ \t]*<link\s+rel="stylesheet"\s+href="([^"]+)"\s*\/?>[ \t]*\r?\n?/gi;
const SCRIPT_SRC = /[ \t]*<script\s+src="([^"]+)"\s*>\s*<\/script>[ \t]*\r?\n?/gi;

function inlineStyle(css, label) {
  return '<style>\n' + escapeForStyle(css.trim(), label) + '\n</style>';
}

function inlineScript(js, label) {
  return '<script>\n' + escapeForScript(js.trim(), label) + '\n</script>';
}

function assertSelfContained(html, label, opts) {
  const allowDataLink = Boolean(opts && opts.allowDataLink);
  const problems = [];
  const links = html.match(/<link\b[^>]*>/gi) || [];
  for (const link of links) {
    // A data: URI favicon is self-contained; anything else is a fetch.
    if (allowDataLink && /href\s*=\s*"data:/i.test(link)) continue;
    problems.push('contains a <link> tag: ' + link.slice(0, 60));
  }
  if (/rel\s*=\s*["']?stylesheet/i.test(html)) problems.push('contains a stylesheet link');
  if (/<script[^>]*\bsrc\s*=/i.test(html)) problems.push('contains <script src=…>');
  if (/\bhref\s*=\s*["']?(?:https?:)?\/\//i.test(html)) problems.push('contains a remote href');
  if (/\bsrc\s*=\s*["']?(?:https?:)?\/\//i.test(html)) problems.push('contains a remote src');
  if (/@import\b/i.test(html)) problems.push('contains a CSS @import');
  if (/url\(\s*["']?(?:https?:)?\/\//i.test(html)) problems.push('contains a remote url()');
  if (problems.length) throw new Error(label + ': ' + problems.join('; '));
}

function assertNoDocumentTags(html, label) {
  const found = html.match(/<\s*\/?\s*(!doctype|html|head|body)\b/gi);
  if (found) throw new Error(label + ': must not contain ' + [...new Set(found)].join(', '));
}

function write(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  return Buffer.byteLength(contents);
}

/* ------------------------------------------------------------------ *
 * Build
 * ------------------------------------------------------------------ */

function build() {
  const html = readSource('index.html');
  const css = readSource('styles.css');

  /* ---- (A) standalone document ---- */

  let linksInlined = 0;
  let scriptsInlined = 0;

  /*
   * Inlined content is parked behind placeholders while the markup is tidied.
   * Tidying the finished document instead would run the whitespace pass over
   * the app's own JS and CSS, silently rewriting source bytes (a template
   * literal spanning blank lines would come out shorter than it went in).
   */
  const PARK = '@@INLINE';
  const parked = [];
  const park = (text) => {
    parked.push(text);
    return PARK + (parked.length - 1) + '@@';
  };

  let standalone = html
    .replace(STYLESHEET_LINK, (m, href) => {
      linksInlined++;
      return park(inlineStyle(readSource(href), href)) + '\n';
    })
    .replace(SCRIPT_SRC, (m, src) => {
      scriptsInlined++;
      return park(inlineScript(readSource(src), src)) + '\n';
    });

  if (linksInlined !== 1) throw new Error('expected one stylesheet <link> in index.html, found ' + linksInlined);
  if (scriptsInlined < 2) throw new Error('expected the scoring/app <script src> tags in index.html, found ' + scriptsInlined);

  standalone = standalone
    .replace(/\n{3,}/g, '\n\n')
    .replace(/@@INLINE(\d+)@@/g, (m, i) => parked[Number(i)]);
  if (standalone.includes(PARK)) throw new Error('an inlined block was not restored');
  assertSelfContained(standalone, 'dist/yahtzee.html', { allowDataLink: true });
  if (!/^<!DOCTYPE html>/i.test(standalone)) throw new Error('standalone output lost its doctype');

  /* ---- (B) hosted fragment ---- */

  const title = (html.match(/<title>[\s\S]*?<\/title>/i) || [])[0];
  if (!title) throw new Error('index.html has no <title>');

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (!bodyMatch) throw new Error('index.html has no <body>');
  const content = bodyMatch[1].replace(SCRIPT_SRC, '').trim();

  const fragment = [
    title,
    inlineStyle(themeAwareCss(css), 'styles.css (theme-rewritten)'),
    '',
    content,
    '',
    inlineScript(readSource('scoring.js'), 'scoring.js'),
    inlineScript(readSource('app.js'), 'app.js'),
    ''
  ].join('\n');

  assertNoDocumentTags(fragment, 'artifact-page.html');
  assertSelfContained(fragment, 'artifact-page.html');
  for (const needle of [':root[data-theme="dark"]', ':root:not([data-theme="light"])']) {
    if (!fragment.includes(needle)) throw new Error('artifact-page.html is missing ' + needle);
  }

  /* ---- emit ---- */

  const extraArtifactPaths = process.argv
    .filter((a) => a.startsWith('--artifact-out='))
    .map((a) => path.resolve(a.slice('--artifact-out='.length)));

  const outputs = [
    [path.join(DIST, 'yahtzee.html'), standalone],
    [path.join(DIST, 'artifact-page.html'), fragment],
    ...extraArtifactPaths.map((p) => [p, fragment])
  ];

  for (const [file, contents] of outputs) {
    const bytes = write(file, contents);
    console.log(`${file}  ${bytes} bytes`);
  }
  console.log(
    hazards.length
      ? 'escaped inlining hazards:\n  ' + hazards.join('\n  ')
      : 'no </script> or </style> sequences in the sources; nothing needed escaping'
  );
}

if (require.main === module) {
  try {
    build();
  } catch (err) {
    console.error('build failed: ' + err.message);
    process.exit(1);
  }
}

module.exports = { build, themeAwareCss, escapeForScript, escapeForStyle };
