// Idempotent codemod: wrap Chinese DISPLAY strings in tr() across the web source.
// Safe by construction:
//   - only wraps strings that already exist as keys in ko.json (so you control what
//     gets wrapped; logic strings you never translated are left untouched),
//   - only wraps DISPLAY positions (JSX text, display attributes, toast/alert/throw
//     args, ternary / || / ?? branches, template literals),
//   - never edits inside an existing tr(...) call, never uses a '}' left-boundary
//     (which previously corrupted `{n0}` inside strings),
//   - re-runnable: already-wrapped occurrences don't match again.
//
//   node scripts/i18n/wrap.mjs          # apply
//   node scripts/i18n/wrap.mjs --check  # exit 1 if changes would be made (CI)
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { loadJSON, KO, WEB_SRC, WRAP_EXCLUDE } from "./extract.mjs";

const check = process.argv.includes("--check");
const keys = new Set(Object.keys(loadJSON(KO)));
const HAN = "\\u4e00-\\u9fff";
const hasHan = (s) => /[\u4e00-\u9fff]/.test(s);
const J = (s) => JSON.stringify(s);

const files = execSync(`rg -l '[\\p{Han}]' -g '*.tsx' -g '*.ts' ${WEB_SRC}`, { encoding: "utf8" })
  .trim().split("\n").filter(Boolean)
  .filter((f) => !f.includes("/mock/") && !WRAP_EXCLUDE.some((x) => f.includes(x)));

// template literal body -> tr("shape", { n0: expr0, ... }) if the shape is a known key
function tmplToTr(body) {
  const exprs = [];
  let i = 0;
  const shape = body.replace(/\$\{([^}]*)\}/g, (_, e) => { exprs.push(e); return `{n${i++}}`; });
  if (!keys.has(shape)) return null;
  if (!exprs.length) return `tr(${J(shape)})`;
  return `tr(${J(shape)}, { ${exprs.map((e, k) => `n${k}: ${e}`).join(", ")} })`;
}

// Replace top-level (non-nested) template literals on a line.
function replaceTemplates(line) {
  let out = "", i = 0;
  while (i < line.length) {
    if (line[i] === "`") {
      let j = i + 1, depth = 0, nested = false, body = "";
      while (j < line.length) {
        const c = line[j];
        if (c === "\\") { body += line[j] + (line[j + 1] ?? ""); j += 2; continue; }
        if (c === "`") { if (depth > 0) nested = true; break; }
        if (c === "$" && line[j + 1] === "{") { depth++; body += "${"; j += 2; continue; }
        if (c === "}" && depth > 0) { depth--; body += "}"; j++; continue; }
        body += c; j++;
      }
      if (j < line.length && line[j] === "`" && !nested) {
        const r = hasHan(body) ? tmplToTr(body) : null;
        if (r) { out += r; i = j + 1; continue; }
        out += line.slice(i, j + 1); i = j + 1; continue;
      }
      out += line[i]; i++; continue;
    }
    out += line[i]; i++;
  }
  return out;
}

const RUN = `[\\u4e00-\\u9fff][\\u4e00-\\u9fff0-9A-Za-z /·、，。！？：；（）()「」《》…·%\\-\\u2192\\u00b7—]*`;

let changed = 0;
const changedFiles = [];
for (const path of files) {
  let content = readFileSync(path, "utf8");
  const orig = content;
  const lines = content.split("\n");
  for (let li = 0; li < lines.length; li++) {
    let line = lines[li];
    const t = line.trim();
    if (!hasHan(line)) continue;
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("{/*")) continue;
    if (t.startsWith("import ") || t.startsWith("export type") || t.startsWith("export interface")) continue;

    // 1) JSX text node: >  中文  <   (no < > { } inside)
    line = line.replace(new RegExp(`>([ \\t]*)([^<>{}]*[${HAN}][^<>{}]*?)([ \\t]*)<`, "g"), (m, w1, zh, w2) =>
      keys.has(zh.trim()) ? `>${w1}{tr(${J(zh.trim())})}${w2}<` : m);
    // 2) attribute values  attr="中文" / attr='中文' / attr={"中文"}
    line = line.replace(new RegExp(`([A-Za-z_][\\w-]*)=\\{?"([^"]*[${HAN}][^"]*)"\\}?`, "g"), (m, a, zh) =>
      (!zh.includes("${") && keys.has(zh)) ? `${a}={tr(${J(zh)})}` : m);
    line = line.replace(new RegExp(`([A-Za-z_][\\w-]*)='([^']*[${HAN}][^']*)'`, "g"), (m, a, zh) =>
      keys.has(zh) ? `${a}={tr(${J(zh)})}` : m);
    // 3) display call args + fallbacks + ternary branches
    line = line.replace(new RegExp(`((?:toast\\.\\w+|set[A-Z]\\w*|alert|window\\.confirm|throw new Error)\\(\\s*)"([^"]*[${HAN}][^"]*)"`, "g"), (m, pre, zh) =>
      (!zh.includes("${") && keys.has(zh)) ? `${pre}tr(${J(zh)})` : m);
    line = line.replace(new RegExp(`(\\|\\||\\?\\?|[?:])(\\s*)"([^"]*[${HAN}][^"]*)"`, "g"), (m, op, ws, zh) =>
      (!zh.includes("${") && keys.has(zh)) ? `${op}${ws}tr(${J(zh)})` : m);
    // 4) JSX adjacent / standalone text (left boundary > or /> only — never } )
    line = line.replace(new RegExp(`(/>|>)(\\s*)(${RUN})(?=\\s*(<|\\{|$))`, "g"), (m, lb, ws, run) =>
      keys.has(run.trim()) ? `${lb}${ws}{tr(${J(run.trim())})}` : m);
    const whole = line.match(new RegExp(`^(\\s*)(${RUN})(\\s*)$`));
    if (whole && keys.has(whole[2].trim())) line = `${whole[1]}{tr(${J(whole[2].trim())})}${whole[3]}`;
    // 5) template literals
    if (line.includes("`")) line = replaceTemplates(line);

    lines[li] = line;
  }
  content = lines.join("\n");
  if (content !== orig) {
    // ensure `tr` is imported
    if (!/import \{[^}]*\btr\b[^}]*\} from "@\/lib\/i18n"/.test(content)) {
      if (/from "@\/lib\/i18n"/.test(content)) {
        content = content.replace(/import \{([^}]*)\} from "@\/lib\/i18n";/, (m, n) => {
          const s = new Set(n.split(",").map((x) => x.trim()).filter(Boolean)); s.add("tr");
          return `import { ${[...s].join(", ")} } from "@/lib/i18n";`;
        });
      } else if (content.startsWith('"use client";')) {
        content = content.replace('"use client";', '"use client";\nimport { tr } from "@/lib/i18n";');
      } else {
        content = `import { tr } from "@/lib/i18n";\n${content}`;
      }
    }
    changed++;
    changedFiles.push(path);
    if (!check) writeFileSync(path, content, "utf8");
  }
}

if (check) {
  if (changed) {
    console.error(`${changed} file(s) have un-wrapped translated strings:\n  ${changedFiles.join("\n  ")}`);
    console.error(`Run: node scripts/i18n/wrap.mjs`);
    process.exit(1);
  }
  console.error("i18n wrap: up to date.");
} else {
  console.error(`wrapped ${changed} file(s).`);
}
