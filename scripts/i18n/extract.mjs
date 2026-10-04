// Extract distinct Chinese display strings from the web source tree.
// Shared by translate.mjs / wrap.mjs / sync.mjs. No deps, Node 18+.
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

export const WEB_SRC = "web/src";
export const EN = `${WEB_SRC}/lib/i18n/en.json`;
export const KO = `${WEB_SRC}/lib/i18n/ko.json`;

// Files whose Chinese must stay as keys (consumed via tr() at render) or that are
// imported by Server Components (can't import the "use client" tr()). Never wrapped.
export const WRAP_EXCLUDE = [
  "lib/status.ts", // label maps consumed via tr(meta.label)
  "navigation/sidebar/sidebar-items.ts", // titles consumed via tr(item.title)
  "config/app-config.ts", // imported by Server Component (metadata)
  "lib/i18n/", // the i18n module itself
];

const HAN = /[\u4e00-\u9fff]/;
// A standalone JSX-text run (same shape wrap.mjs accepts): CJK + safe inline punctuation.
const RUN = /^[\u4e00-\u9fff][\u4e00-\u9fff0-9A-Za-z /·、，。！？：；（）()「」《》…·%\-\u2192\u00b7—]*$/;

function listFiles() {
  const out = execSync(
    `rg -l '[\\p{Han}]' -g '*.tsx' -g '*.ts' ${WEB_SRC}`,
    { encoding: "utf8" },
  );
  return out.trim().split("\n").filter(Boolean)
    .filter((f) => !f.includes("/mock/") && !f.endsWith(".test.ts") && !f.endsWith(".test.tsx") && !f.includes("lib/i18n/"));
}

// Turn a template-literal body into a positional shape: `任务 #${id}` -> "任务 #{n0}"
function templateShape(body) {
  let i = 0;
  return body.replace(/\$\{[^}]*\}/g, () => `{n${i++}}`);
}

// A clean display string: after removing valid placeholders ({n0}, {args}), it must
// contain no JSX/code punctuation. Rejects broken fragments like ">Body（可含 {",
// "默认${x ? ", or JSON-ish example text — keeps real UI strings incl. "删除 {n0} 条".
function isClean(s) {
  if (!HAN.test(s)) return false;
  const bare = s.replace(/\{n\d+\}/g, "").replace(/\{args\}/g, "");
  return !/[<>{}`$\\]/.test(bare);
}

/**
 * Extract distinct candidate display strings from the source.
 * Returns a sorted array of Chinese strings (literals, JSX text, template shapes).
 * These are keys for en.json/ko.json (Chinese is the key).
 */
export function extractStrings() {
  const found = new Set();
  for (const file of listFiles()) {
    const text = readFileSync(file, "utf8");
    let inBlockComment = false; // inside /* ... */ or {/* ... */}
    for (const raw of text.split("\n")) {
      const t = raw.trim();
      // track multi-line block comments so their body lines are skipped
      if (inBlockComment) {
        if (t.includes("*/")) inBlockComment = false;
        continue;
      }
      if ((t.startsWith("/*") || t.startsWith("{/*")) && !t.includes("*/")) { inBlockComment = true; continue; }
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("{/*")) continue;
      if (t.startsWith("import ") || t.startsWith("export type") || t.startsWith("export interface")) continue;
      // strip existing tr("...") / tr(`...`) and line comments so we don't re-extract wrapped text
      let code = raw.replace(/tr\("[^"]*"/g, "").replace(/tr\(`[^`]*`/g, "").replace(/\/\/.*$/, "");
      if (!HAN.test(code)) continue;
      // double-quoted literals (skip ones embedding JSX/interpolation)
      for (const m of code.matchAll(/"([^"]*[\u4e00-\u9fff][^"]*)"/g)) {
        if (isClean(m[1])) found.add(m[1]);
      }
      // single-quoted
      for (const m of code.matchAll(/'([^']*[\u4e00-\u9fff][^']*)'/g)) {
        if (isClean(m[1])) found.add(m[1]);
      }
      // JSX text nodes between > and <
      for (const m of code.matchAll(/>([^<>{}]*[\u4e00-\u9fff][^<>{}]*)</g)) {
        const v = m[1].trim();
        if (isClean(v)) found.add(v);
      }
      // template literals -> positional shapes
      for (const m of code.matchAll(/`([^`]*[\u4e00-\u9fff][^`]*)`/g)) {
        const sh = templateShape(m[1]);
        if (isClean(sh)) found.add(sh);
      }
      // standalone JSX text on its own line (multi-line text node), e.g. a label
      // sitting alone between <Button> ... </Button> across lines. Require >=2 CJK
      // chars so trailing fragments like "条）" after a {expr} aren't captured.
      if (RUN.test(t) && isClean(t) && (t.match(/[\u4e00-\u9fff]/g) || []).length >= 2) found.add(t);
    }
  }
  return [...found].sort();
}

export function loadJSON(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

// CLI: print strings missing from the dictionaries.
if (import.meta.url === `file://${process.argv[1]}`) {
  const all = extractStrings();
  const en = loadJSON(EN);
  const missing = all.filter((s) => !(s in en));
  console.error(`Distinct Chinese display strings: ${all.length} | missing from dict: ${missing.length}`);
  for (const s of missing) console.log(s);
}
