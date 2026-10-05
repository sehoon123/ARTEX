// Report-only: dictionary keys that appear in no source literal and no catalog key.
// NEVER auto-deletes: tr(variable) builds keys dynamically (nav titles, status labels,
// retry triggers, builtin summaries), so absence from static literals is a hint for
// manual review, not proof a key is dead. Exit 0 always.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT, EN, KO, WEB_SRC, loadJSON, sourceFiles, scanSource, extractStrings, ts } from "./extract.mjs";

const used = new Set(extractStrings()); // display candidates + Han builtin metadata labels
const dynamic = [];
// Every raw string/jsxtext literal in source, so data arrays consumed via tr(variable) count as used.
for (const path of sourceFiles()) {
  const file = scanSource(path);
  for (const d of file.dynamic) dynamic.push(d);
  const source = ts.createSourceFile(path, file.text, ts.ScriptTarget.Latest, true);
  (function walk(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) used.add(node.text);
    if (ts.isJsxText(node)) used.add(node.text.trim());
    ts.forEachChild(node, walk);
  })(source);
}
// Catalog tool summaries are keyed, not literal in source.
const toolPath = join(WEB_SRC, "lib/builtin-tool-descriptions.json");
if (existsSync(toolPath)) for (const key of Object.keys(JSON.parse(readFileSync(toolPath, "utf8")))) used.add(`builtin.tool.${key}.summary`);

const en = loadJSON(EN), ko = loadJSON(KO);
const unused = Object.keys(en).filter((key) => !used.has(key));
const onlyKo = Object.keys(ko).filter((key) => !Object.hasOwn(en, key));
console.log(`Dictionary keys: en ${Object.keys(en).length}, ko ${Object.keys(ko).length}. Source+catalog literals: ${used.size}.`);
if (onlyKo.length) console.log(`\nKeys in ko but not en (${onlyKo.length}):\n` + onlyKo.map((k) => "  " + JSON.stringify(k)).join("\n"));
console.log(`\nKeys with no matching source literal or catalog key (${unused.length}) — review before removing; dynamic tr(variable) keys can legitimately appear here:`);
for (const key of unused) console.log("  " + JSON.stringify(key));
console.log(`\nDynamic tr(expr) sites (${dynamic.length}) — their keys cannot be inventoried statically; ensure the values they resolve to are present in both dictionaries:`);
for (const d of dynamic) console.log(`  ${d.rel}:${d.line}  ${d.text}`);
