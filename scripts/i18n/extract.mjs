// Shared parser-backed inventory. Reuses the web project's existing TypeScript dependency.
import { existsSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const WEB_SRC = join(ROOT, "web/src");
export const EN = join(WEB_SRC, "lib/i18n/en.json");
export const KO = join(WEB_SRC, "lib/i18n/ko.json");
const require = createRequire(join(ROOT, "web/package.json"));
export const ts = require("typescript");
export const WRAP_EXCLUDE = ["lib/status.ts", "navigation/sidebar/sidebar-items.ts", "config/app-config.ts", "lib/i18n/"];
const hasHan = (text) => /[\p{Script=Han}\u3001-\u303f\uff08\uff09\uff0c\uff0e\uff1a\uff1b\uff1f\uff01]/u.test(text);
const displayAttributes = new Set(["title", "placeholder", "aria-label", "alt", "label", "description", "hint", "tooltip", "sub", "successMessage", "selectAllLabel"]);
const displayProperties = new Set(["label", "title", "description", "placeholder", "hint", "tooltip", "sub"]);
// ponytail: explicit display sinks only; add type/data-flow analysis if broader
// automation is needed. Uncertain object fields and nested branches fail closed.

export function sourceFiles(dir = WEB_SRC) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return ["mock", "i18n", "node_modules", "__tests__"].includes(entry.name) ? [] : sourceFiles(path);
    return entry.isFile() && /\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [path] : [];
  }).sort();
}

export function writeAtomic(path, text) {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, text, { encoding: "utf8", flag: "wx", mode: statSync(path).mode & 0o777 });
    renameSync(temp, path);
  } finally { rmSync(temp, { force: true }); }
}

export function placeholders(text) {
  return (text.match(/\{[^{}]+\}/g) ?? []).sort();
}

export function validateTranslation(key, value) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Empty/non-string translation for ${JSON.stringify(key)}`);
  if (JSON.stringify(placeholders(key)) !== JSON.stringify(placeholders(value))) throw new Error(`Placeholder mismatch for ${JSON.stringify(key)}`);
}

export function loadJSON(path) {
  // Never turn missing, unreadable or corrupt dictionaries into empty dictionaries.
  const text = readFileSync(path, "utf8");
  const dict = JSON.parse(text);
  if (!dict || typeof dict !== "object" || Array.isArray(dict)) throw new Error(`Invalid dictionary: ${path}`);
  const seen = new Set();
  const parsed = ts.parseJsonText(path, text);
  for (const property of parsed.statements[0]?.expression?.properties ?? []) {
    const key = property.name.text;
    if (seen.has(key)) throw new Error(`Duplicate dictionary key ${JSON.stringify(key)} in ${path}`);
    seen.add(key);
  }
  for (const [key, value] of Object.entries(dict)) validateTranslation(key, value);
  return dict;
}

function displayPosition(node, source) {
  const parent = node.parent;
  if (!parent) return false;
  if (ts.isJsxAttribute(parent)) return displayAttributes.has(parent.name.getText(source)) ? "display" : false;
  if (ts.isJsxExpression(parent)) return !ts.isJsxAttribute(parent.parent) || displayAttributes.has(parent.parent.name.getText(source)) ? "display" : false;
  // A field called label/description may be persisted or used as a key. Do not infer semantics.
  if (ts.isTemplateSpan(parent) && parent.expression === node) return displayPosition(parent.parent, source);
  if (ts.isPropertyAssignment(parent)) return displayProperties.has(parent.name.getText(source).replace(/^["']|["']$/g, "")) ? "manual" : false;
  if (ts.isCallExpression(parent) && parent.arguments[0] === node) {
    const name = parent.expression.getText(source);
    return /^(?:toast(?:\.(?:success|error|info|warning|message|loading))?|alert|(?:window\.)?confirm|window\.alert|set\w*Error|set\w*Message)$/.test(name) ? "display" : false;
  }
  if (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isSatisfiesExpression(parent) || ts.isNonNullExpression(parent)) return displayPosition(parent, source);
  if (ts.isConditionalExpression(parent) && node !== parent.condition) return displayPosition(parent, source);
  if (ts.isBinaryExpression(parent) && ([ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.PlusToken].includes(parent.operatorToken.kind) || (parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && node === parent.right))) return displayPosition(parent, source);
  return false;
}

function jsxValue(node, source) {
  // Let TypeScript apply JSX's entity decoding and whitespace rules, not a second homemade parser.
  const input = ts.isJsxText(node) ? `<span>${node.getFullText(source)}</span>` : `<span title=${node.getText(source)} />`;
  const output = ts.transpileModule(`const value = ${input};`, { compilerOptions: { jsx: ts.JsxEmit.React, jsxFactory: "__jsx", target: ts.ScriptTarget.ES2022 } }).outputText;
  const parsed = ts.createSourceFile("jsx.js", output, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const call = parsed.statements[0].declarationList.declarations[0].initializer;
  return ts.isJsxText(node) ? call.arguments[2]?.text ?? "" : call.arguments[1].properties[0].initializer.text;
}

export function scanSource(path, text = readFileSync(path, "utf8")) {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  if (source.parseDiagnostics.length) throw new Error(`Cannot parse ${relative(ROOT, path)}: ${ts.flattenDiagnosticMessageText(source.parseDiagnostics[0].messageText, " ")}`);
  const imports = source.statements.filter(ts.isImportDeclaration).filter((node) => node.moduleSpecifier.text === "@/lib/i18n");
  const translationNames = new Set(imports.filter((node) => !node.importClause?.isTypeOnly).flatMap((node) => node.importClause?.namedBindings?.elements ?? []).filter((node) => !node.isTypeOnly && (node.propertyName ?? node.name).text === "tr").map((node) => node.name.text));
  const identifiers = new Set();
  const bindings = new Map();
  function bind(name) {
    if (ts.isIdentifier(name)) bindings.set(name.text, (bindings.get(name.text) ?? 0) + 1);
    else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) for (const item of name.elements) if (ts.isBindingElement(item)) bind(item.name);
  }
  function inventory(node) {
    if (ts.isIdentifier(node)) identifiers.add(node.text);
    if (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isImportSpecifier(node) || ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isClassDeclaration(node) || ts.isClassExpression(node) || ts.isEnumDeclaration(node)) if (node.name) bind(node.name);
    ts.forEachChild(node, inventory);
  }
  inventory(source);
  let alias = [...translationNames].find((name) => bindings.get(name) === 1);
  let needsImport = !alias;
  if (!alias) {
    alias = identifiers.has("tr") ? "i18nTr" : "tr";
    for (let index = 2; identifiers.has(alias); index++) alias = `i18nTr${index}`;
  }
  const directives = [];
  for (const node of source.statements) {
    if (!ts.isExpressionStatement(node) || !ts.isStringLiteral(node.expression)) break;
    directives.push(node);
  }
  const excluded = WRAP_EXCLUDE.some((part) => relative(WEB_SRC, path).replaceAll("\\", "/").startsWith(part));
  const clientSafe = !directives.some((node) => node.expression.text === "use server") && (directives.some((node) => node.expression.text === "use client") || translationNames.size > 0);
  const candidates = [];
  const add = (node, key, expression, kind = "display") => {
    candidates.push({ key, kind, start: node.getStart(source), end: node.end, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, replacement: expression, excluded });
  };
  function visit(node, insideTranslation = false, manual = false) {
    const translation = ts.isCallExpression(node) && ts.isIdentifier(node.expression) && translationNames.has(node.expression.text);
    if (translation && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) add(node.arguments[0], node.arguments[0].text, null, "key");
    if (!insideTranslation && !translation) {
      if (ts.isJsxText(node) && (hasHan(node.text) || /&#(?:x[\da-f]+|\d+);/i.test(node.text))) {
        const value = jsxValue(node, source);
        const key = value.trim();
        if (hasHan(key)) {
          const leading = value.slice(0, value.indexOf(key));
          const trailing = value.slice(value.indexOf(key) + key.length);
          add(node, key, `{${leading ? `${JSON.stringify(leading)} + ` : ""}${alias}(${JSON.stringify(key)})${trailing ? ` + ${JSON.stringify(trailing)}` : ""}}`);
        }
      } else if (ts.isStringLiteralLike(node) && displayPosition(node, source)) {
        const value = ts.isJsxAttribute(node.parent) ? jsxValue(node, source) : node.text;
        if (hasHan(value)) add(node, value, ts.isJsxAttribute(node.parent) ? `{${alias}(${JSON.stringify(value)})}` : `${alias}(${JSON.stringify(value)})`, manual ? "manual" : displayPosition(node, source));
      } else if (ts.isTemplateExpression(node) && displayPosition(node, source)) {
        const key = node.head.text + node.templateSpans.map((span, index) => `{n${index}}${span.literal.text}`).join("");
        if (hasHan(key)) {
          const params = node.templateSpans.map((span, index) => {
            const expression = source.text.slice(span.expression.getFullStart(), span.literal.getStart(source));
            return `n${index}: \`\${${expression}}\``; // Preserve native coercion and comment trivia.
          }).join(", ");
          add(node, key, `${alias}(${JSON.stringify(key)}, { ${params} })`, manual ? "manual" : displayPosition(node, source));
          // Inventory nested keys, but require raw display branches to be reviewed
          // before replacing their parent template. Never generate overlapping edits.
          for (const span of node.templateSpans) visit(span.expression, false, true);
          return;
        }
      }
    }
    ts.forEachChild(node, (child) => visit(child, insideTranslation || translation, manual));
  }
  if (!relative(WEB_SRC, path).replaceAll("\\", "/").startsWith("config/app-config.ts")) visit(source);
  return { path, text, candidates, alias, needsImport, clientSafe, importOffset: directives.at(-1)?.end ?? 0 };
}

export function extractStrings() {
  const path = join(WEB_SRC, "lib/builtin-metadata.json");
  const metadata = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
  const labels = metadata ? [...Object.values(metadata.agents).flatMap((a) => [a.name, a.description]), ...metadata.variableHelp, ...metadata.interceptNames, ...metadata.assetNotes].filter(hasHan) : [];
  return [...new Set([...sourceFiles().flatMap((path) => scanSource(path).candidates.map((candidate) => candidate.key)), ...labels])].sort();
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    const all = extractStrings();
    const en = loadJSON(EN), ko = loadJSON(KO);
    const missing = all.filter((key) => !Object.hasOwn(en, key) || !Object.hasOwn(ko, key));
    console.error(`AST translation keys: ${all.length} | missing from en/ko: ${missing.length}`);
    for (const key of missing) console.log(key);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
