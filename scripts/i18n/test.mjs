// Run from any directory: node scripts/i18n/test.mjs (uses Node's built-in runner).
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import vm from "node:vm";
import test from "node:test";
import { writeAtomic, sourceFiles } from "./extract.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(join(root, "web/package.json"));
const ts = require("typescript");
const React = require("react");
const { renderToString } = require("react-dom/server");
const exec = promisify(execFile);
const read = (path) => readFileSync(path, "utf8");
const json = (path) => JSON.parse(read(path));
const dictionaries = Object.fromEntries(["en", "ko"].map((lang) => [lang, json(join(root, `web/src/lib/i18n/${lang}.json`))]));
const compilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true };

function loadRuntime(locale, options = {}) {
  const storage = {
    getItem: () => options.blockStorage ? (() => { throw new Error("denied"); })() : options.stored ?? locale,
    setItem: (_key, value) => { if (options.blockStorage) throw new Error("denied"); options.saved = value; },
  };
  const sandbox = {
    exports: {}, console,
    require: (path) => path === "./en.json" ? dictionaries.en : path === "./ko.json" ? dictionaries.ko : path === "react" ? options.react ?? React : require(path),
    ...(locale ? { window: { confirm: (text) => { options.dialogs = [...(options.dialogs ?? []), text]; return options.confirmResult ?? true; }, localStorage: storage, location: { reload: () => { options.reloads = (options.reloads ?? 0) + 1; } } }, localStorage: storage, navigator: { language: options.language ?? locale }, document: { documentElement: { lang: "en" } } } : {}),
  };
  vm.runInNewContext(ts.transpileModule(read(join(root, "web/src/lib/i18n/context.tsx")), { compilerOptions }).outputText, sandbox);
  return { ...sandbox.exports, sandbox };
}

function fixture(source, entries = { "立即同步": ["Sync now", "지금 동기화"] }) {
  const dir = mkdtempSync(join(tmpdir(), "artex-i18n-test-"));
  cpSync(join(root, "scripts/i18n"), join(dir, "scripts/i18n"), { recursive: true });
  mkdirSync(join(dir, "web/src/components"), { recursive: true });
  mkdirSync(join(dir, "web/src/lib/i18n"), { recursive: true });
  symlinkSync(join(root, "web/node_modules"), join(dir, "web/node_modules"), "dir");
  writeFileSync(join(dir, "web/package.json"), "{}");
  const file = join(dir, "web/src/components/demo.tsx");
  writeFileSync(file, source);
  for (const [i, lang] of ["en", "ko"].entries()) writeFileSync(join(dir, `web/src/lib/i18n/${lang}.json`), JSON.stringify(Object.fromEntries(Object.entries(entries).map(([key, values]) => [key, values[i]]))));
  const run = async (script, args = [], env = {}) => {
    const clean = { ...process.env, BATCH: "40", LIMIT: "1000", I18N_TIMEOUT_MS: "2000" };
    for (const key of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "I18N_BASE_URL", "I18N_MODEL"]) delete clean[key];
    try { return { code: 0, ...await exec(process.execPath, [join(dir, `scripts/i18n/${script}.mjs`), ...args], { cwd: dir, env: { ...clean, ...env }, timeout: 10000 }) }; }
    catch (error) { return { code: error.code, signal: error.signal, stdout: error.stdout ?? "", stderr: error.stderr ?? "" }; }
  };
  return { dir, file, run, close: () => rmSync(dir, { recursive: true, force: true }) };
}

async function withAPI(callback, response) {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (data) => { body += data; });
    req.on("end", () => {
      const output = response(JSON.parse(body), req);
      if (output === null) return; // A deliberately stalled provider for the timeout test.
      res.writeHead(output.status ?? 200, { "content-type": "application/json" });
      res.end(JSON.stringify(output.body ?? (req.url.endsWith("/messages") ? { content: [{ type: "text", text: JSON.stringify(output.map) }] } : { choices: [{ message: { content: JSON.stringify(output.map) } }] })));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try { await callback({ OPENAI_API_KEY: "fixture-only", I18N_BASE_URL: `http://127.0.0.1:${server.address().port}/v1` }); }
  finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
}

for (const locale of ["en", "ko"]) {
  test(`tr uses the real ${locale} dictionary and substitutes literally once`, () => {
    const { tr, getLocale } = loadRuntime(locale);
    assert.equal(getLocale(), locale);
    assert.equal(tr("登录"), dictionaries[locale]["登录"]);
    const value = "$& $$ $' $` {n1}";
    assert.equal(tr("未知测试 {n0} {n1}", { n0: value, n1: "X" }), `未知测试 ${value} X`);
    assert.equal(tr("未知 {n0} {n0}", { n0: 0 }), "未知 0 0");
    assert.equal(tr("未知 {n0} {n1}", { n0: false, n1: null }), "未知 false ");
    assert.equal(tr("constructor"), "constructor");
    assert.equal(tr("__proto__"), "__proto__");
  });
}

test("server and Korean first render agree; document language follows locale", () => {
  const server = loadRuntime();
  const client = loadRuntime("ko");
  const markup = (runtime) => renderToString(React.createElement(runtime.I18nProvider, null, React.createElement("p", null, runtime.tr("登录"))));
  assert.equal(markup(server), markup(client));
  const options = { react: { ...React, useState: () => [true, () => {}], useEffect: (fn) => fn() } };
  const mounted = loadRuntime("ko", options);
  mounted.I18nProvider({ children: "child" });
  assert.equal(mounted.sandbox.document.documentElement.lang, "ko");
});

test("locale detection survives blocked storage; failed persistence does not reload or change locale", () => {
  const options = { blockStorage: true, language: "ko-KR", react: { ...React, useState: () => [true, () => {}], useEffect: () => {} } };
  const runtime = loadRuntime("en", options);
  assert.equal(runtime.getLocale(), "ko");
  const context = runtime.I18nProvider({ children: null }).props.value;
  assert.equal(context.setLocale("en"), false);
  assert.equal(runtime.getLocale(), "ko");
  assert.equal(options.reloads ?? 0, 0);
  options.blockStorage = false;
  assert.equal(context.setLocale("en"), true);
  assert.equal(options.saved, "en");
  assert.equal(options.reloads, 1);
});

test("cancelled language reload preserves locale and storage without reporting a persistence failure", () => {
  const options = { confirmResult: false, react: { ...React, useState: () => [true, () => {}], useEffect: () => {} } };
  const runtime = loadRuntime("ko", options);
  const context = runtime.I18nProvider({ children: null }).props.value;
  assert.equal(context.setLocale("en"), null);
  assert.equal(runtime.getLocale(), "ko");
  assert.equal(options.saved, undefined);
  assert.equal(options.reloads ?? 0, 0);
  assert.equal(options.dialogs[0], dictionaries.ko["切换语言会重新加载页面，未保存的更改将丢失。是否继续？"]);
});

test("upload marker survives locale switches, including previously saved localized headers", () => {
  const path = join(root, "web/src/app/(main)/function/tasks/page.tsx");
  const source = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true);
  const selected = source.statements.filter((node) =>
    (ts.isFunctionDeclaration(node) && ["fmtBytes", "appendUploads"].includes(node.name?.text)) ||
    (ts.isVariableStatement(node) && node.declarationList.declarations.some((declaration) => /^UPLOAD_MARKER/.test(declaration.name.getText(source)))),
  ).map((node) => node.getText(source)).join("\n");
  for (const locale of ["en", "ko"]) {
    const runtime = loadRuntime(locale);
    const sandbox = { tr: runtime.tr, enStrings: dictionaries.en, koStrings: dictionaries.ko };
    vm.runInNewContext(ts.transpileModule(selected + "\nconst renderUpload = appendUploads;", { compilerOptions }).outputText, sandbox);
    for (const marker of ["【上传文件（绝对路径）】", dictionaries.en["【上传文件（绝对路径）】"], dictionaries.ko["【上传文件（绝对路径）】"]]) {
      sandbox.desc = `${marker}\n- /tmp/previous.txt`;
      const output = vm.runInNewContext('renderUpload(desc, [{path:"/tmp/new.txt",size:0}])', sandbox);
      assert.equal(output, `${sandbox.desc}\n- /tmp/new.txt（0 B）\n`);
    }
  }
});

test("expanded transcript renders the command rather than JSON in both locales", async () => {
  for (const locale of ["en", "ko"]) {
    let detail;
    let state = 0;
    const runtime = loadRuntime(locale);
    const hooks = { useState: (initial) => { const index = state++; return [initial, (value) => { if (index === 1) detail = value; }]; }, useRef: (value) => ({ current: value }), useEffect: (effect) => effect() };
    const stub = new Proxy({}, { get: () => () => null });
    const sandbox = { exports: {}, require: (path) => path === "react" ? hooks : path === "@/lib/i18n" ? runtime : path === "react/jsx-runtime" ? require(path) : stub };
    const source = read(join(root, "web/src/components/transcript.tsx")) + "\nexport { ToolBlock };\n";
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions }).outputText, sandbox);
    sandbox.exports.ToolBlock({ focused: true, group: { type: "tool", worker: "mainagent", use: { seq: 1, tool: "Bash", summary: "Bash {}" }, result: { seq: 2, is_error: false } }, getDetail: async (seq) => seq === 1 ? '{"command":"echo hello"}' : "hello" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(detail.includes("\necho hello"), detail);
    assert.ok(!detail.includes('"command"'), detail);
    assert.ok(!detail.includes("\\n"), detail);
  }
});

test("missing tool-name metadata never uses a translated label to parse stored summary prefixes", () => {
  for (const locale of ["en", "ko"]) {
    const runtime = loadRuntime(locale);
    const hooks = { ...React, useState: (value) => [value, () => {}], useRef: () => ({ current: null }), useEffect: (fn) => fn() };
    const sandbox = { exports: {}, require: (path) => path === "react" ? hooks : path === "@/lib/i18n" ? runtime : path === "react/jsx-runtime" ? require(path) : new Proxy({}, { get: () => () => null }) };
    vm.runInNewContext(ts.transpileModule(read(join(root, "web/src/components/transcript.tsx")) + "\nexport { ToolBlock };", { compilerOptions }).outputText, sandbox);
    const text = (node) => typeof node === "string" ? node : Array.isArray(node) ? node.map(text).join(" ") : node?.props ? text(node.props.children) : "";
    const result = sandbox.exports.ToolBlock({ group: { type: "tool", use: { seq: 1, summary: "工具 hello" } }, getDetail: () => { throw new Error("collapsed tools must not load details"); } });
    assert.ok(text(result).includes(dictionaries[locale]["工具"]));
    assert.ok(text(result).includes("hello"));
    assert.ok(!text(result).includes("工具"), text(result));
  }
});

test("graph edge and legend labels use the selected locale", () => {
  for (const locale of ["en", "ko"]) {
    let displayedEdges;
    const runtime = loadRuntime(locale);
    const hooks = { useState: (value) => [value, () => {}], useMemo: (fn) => fn(), useEffect: (fn) => fn() };
    const stub = () => null;
    const flow = new Proxy({
      useNodesState: () => [[], () => {}, () => {}],
      useEdgesState: () => [[], (value) => { displayedEdges = value; }, () => {}],
      MarkerType: { ArrowClosed: "arrow" }, Position: { Left: "left", Right: "right" }, BackgroundVariant: { Dots: "dots" },
    }, { get: (object, key) => object[key] ?? stub });
    const sandbox = { exports: {}, require: (path) => path === "react" ? hooks : path === "@/lib/i18n" ? runtime : path === "@xyflow/react" ? flow : path === "react/jsx-runtime" ? require(path) : new Proxy({}, { get: () => stub }) };
    const source = read(join(root, "web/src/components/exploration-graph.tsx")) + "\nexport { ExplorationGraphInner };";
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions }).outputText, sandbox);
    const result = sandbox.exports.ExplorationGraphInner({ nodes: [{ id: "1", type: "task" }, { id: "2", type: "intent" }], edges: [{ src: "1", dst: "2", rel: "spawns" }] });
    const text = (node) => typeof node === "string" ? node : Array.isArray(node) ? node.map(text).join(" ") : node?.props ? text(node.props.children) : "";
    assert.equal(displayedEdges[0].label, dictionaries[locale]["派生"]);
    for (const key of ["派生", "意图链", "产出", "证明"]) assert.ok(text(result).includes(dictionaries[locale][key]));
  }
});

test("whole deletion/count phrases render without Chinese punctuation or corrupted parameter text", () => {
  const key = "删除对话「{n0}」？";
  const path = join(root, "web/src/app/(main)/chat/page.tsx");
  const source = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true);
  let fragment;
  function visit(node) { if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === "AlertDialogTitle" && node.getText(source).includes(key)) fragment = node.getText(source); ts.forEachChild(node, visit); }
  visit(source);
  assert.ok(fragment, "Deletion confirmation must translate the whole sentence");
  for (const locale of ["en", "ko"]) {
    const runtime = loadRuntime(locale);
    const name = "$& {n1} name";
    const sandbox = { exports: {}, tr: runtime.tr, conv: { title: name }, AlertDialogTitle: ({ children }) => React.createElement("h2", null, children), require };
    vm.runInNewContext(ts.transpileModule(`export const view = ${fragment};`, { compilerOptions }).outputText, sandbox);
    const markup = renderToString(sandbox.exports.view);
    assert.ok(markup.includes("$&amp; {n1} name"), markup);
    assert.ok(!/[「」（）？]/.test(markup), markup);
    assert.ok(!/ {2}/.test(runtime.tr("共 {n0} 个 Agent", { n0: 3 })));
  }
});

test("bulk deletion and page indicators translate whole phrases without doubled spaces", () => {
  for (const [path, key, globals] of [
    ["web/src/app/(main)/chat/page.tsx", "删除选中的 {n0} 个对话？", { selectedConversationCount: 3 }],
    ["web/src/app/(main)/function/sync/page.tsx", "第 {n0} 页", { page: 2 }],
  ]) {
    const source = ts.createSourceFile(path, read(join(root, path)), ts.ScriptTarget.Latest, true);
    let fragment;
    function visit(node) { if (ts.isJsxElement(node) && ["AlertDialogTitle", "span"].includes(node.openingElement.tagName.getText(source)) && node.getText(source).includes(key)) fragment = node.getText(source); ts.forEachChild(node, visit); }
    visit(source);
    assert.ok(fragment, key);
    for (const locale of ["en", "ko"]) {
      const sandbox = { exports: {}, ...globals, tr: loadRuntime(locale).tr, AlertDialogTitle: ({ children }) => React.createElement("h2", null, children), require };
      vm.runInNewContext(ts.transpileModule(`export const view = ${fragment};`, { compilerOptions }).outputText, sandbox);
      const markup = renderToString(sandbox.exports.view);
      assert.ok(!/ {2}/.test(markup), markup);
      if (globals.page) assert.ok(markup.includes(dictionaries[locale][key].replace("{n0}", "2")), markup);
    }
  }
});

test("all retry trigger and exclusion explanations render translated in both locales", () => {
  for (const locale of ["en", "ko"]) {
    const sandbox = { exports: {}, require: (path) => path === "react" ? React : path === "@/lib/i18n" ? loadRuntime(locale) : path === "react/jsx-runtime" ? require(path) : new Proxy({}, { get: () => () => null }) };
    vm.runInNewContext(ts.transpileModule(read(join(root, "web/src/app/(main)/system/llm/_components/retry.tsx")), { compilerOptions }).outputText, sandbox);
    const text = (node) => typeof node === "string" ? node : Array.isArray(node) ? node.map(text).join(" ") : node?.props ? text(node.props.children) : "";
    assert.deepEqual(Object.keys(sandbox.exports.RETRY_LAYERS), ["connect", "empty", "stream", "breaker", "intent"]);
    for (const [layer, meta] of Object.entries(sandbox.exports.RETRY_LAYERS)) {
      assert.ok(Object.hasOwn(dictionaries[locale], meta.trigger), layer);
      const result = sandbox.exports.RetryRuleFields({ layer, idPrefix: "fixture", value: { attempts: 0, interval_ms: 0 }, onChange: () => {} });
      assert.ok(text(result).includes(dictionaries[locale][meta.trigger]), layer);
      assert.ok(!/\p{Script=Han}/u.test(text(result)), text(result));
    }
  }
});

test("atomic writes preserve the live file on failure, its permissions, and leave no temp files", () => {
  const dir = mkdtempSync(join(tmpdir(), "artex-i18n-atomic-"));
  const path = join(dir, "source.tsx");
  try {
    writeFileSync(path, "before"); chmodSync(path, 0o600);
    assert.throws(() => writeAtomic(path, undefined));
    assert.equal(read(path), "before");
    assert.deepEqual(readdirSync(dir), ["source.tsx"]);
    writeAtomic(path, "after");
    assert.equal(read(path), "after");
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.deepEqual(readdirSync(dir), ["source.tsx"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("AST wrapping preserves values, comparisons, comments and directives; second run is identical", async () => {
  const source = '// 中文说明\n"use client";\nconst protocol = true ? "立即同步" : "other";\n/*\n label: "立即同步"\n*/\nexport function Demo() { return <select value="立即同步"><option value="立即同步" title="立即同步">立即同步</option>{protocol === "立即同步" ? "立即同步" : ""}</select>; }\n';
  const f = fixture(source);
  try {
    assert.equal((await f.run("wrap", ["--check"])).code, 1);
    assert.equal(read(f.file), source);
    assert.equal((await f.run("wrap")).code, 0);
    const output = read(f.file);
    assert.ok(output.includes('value="立即同步"'));
    assert.ok(output.includes('true ? "立即同步"'));
    assert.ok(output.includes('protocol === "立即同步"'));
    assert.ok(output.includes('label: "立即同步"'));
    const parsed = ts.createSourceFile("demo.tsx", output, ts.ScriptTarget.Latest, true);
    assert.equal(parsed.statements[0].expression.text, "use client");
    assert.equal(parsed.parseDiagnostics.length, 0);
    assert.match(output, /title=\{\w+\("立即同步"\)\}/);
    assert.equal((await f.run("wrap", ["--check"])).code, 0);
    assert.equal((await f.run("wrap")).code, 0);
    assert.equal(read(f.file), output);
  } finally { f.close(); }
});

test("AST wrapping preserves cooked escapes, HTML entities and nested multiline template expressions", async () => {
  const source = '"use client";\nimport { toast } from "sonner";\nconst tr = 42;\nexport function Demo({ n }: {n:number}) { toast.success(`处理 ${\n({ count: n }).count\n} 个告警`); toast.success("第一行\\n第二行"); return <p title="中文 &quot;标题&quot;">中文 &amp; 测试</p>; }\n';
  const f = fixture(source, { "处理 {n0} 个告警": ["Processed {n0} alerts", "경고 {n0}건 처리"], "第一行\n第二行": ["First\nSecond", "첫째\n둘째"], '中文 "标题"': ['Title "test"', '"제목"'], "中文 & 测试": ["Chinese & test", "중국어 & 테스트"] });
  try {
    assert.equal((await f.run("wrap")).code, 0);
    const output = read(f.file);
    assert.match(output, /tr as i18nTr/);
    assert.ok(output.includes('i18nTr("处理 {n0} 个告警"'));
    assert.ok(output.includes('i18nTr("第一行\\n第二行")'));
    assert.ok(output.includes('i18nTr("中文 & 测试")'));
    assert.equal(ts.createSourceFile("demo.tsx", output, ts.ScriptTarget.Latest, true).parseDiagnostics.length, 0);
    assert.equal((await f.run("wrap", ["--check"])).code, 0);
  } finally { f.close(); }
});

test("check fails for unknown visible strings and for missing Korean in already wrapped strings", async () => {
  const f = fixture('"use client";\nimport {tr} from "@/lib/i18n";\nexport const Demo=()=> <p>{tr("立即同步")}新的界面标题</p>;\n');
  try {
    writeFileSync(join(f.dir, "web/src/lib/i18n/ko.json"), "{}");
    const result = await f.run("wrap", ["--check"]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /ko|Korean/);
    assert.match(result.stderr, /新的界面标题/);
    const extraction = await f.run("extract");
    assert.ok(extraction.stdout.includes("立即同步"));
  } finally { f.close(); }
});

test("template conversion preserves native coercion, trivia and local String bindings", async () => {
  const source = '"use client"; import {toast} from "sonner"; export function show(value:unknown){const String=()=>"WRONG"; toast.success(`回归专用类型转换 ${ /*before*/ value /*after*/ }`)}';
  const f = fixture(source, { "回归专用类型转换 {n0}": ["Check {n0}", "값 검사 {n0}"] });
  const runtime = loadRuntime("en");
  assert.equal(runtime.tr("回归专用类型转换 {n0}"), "回归专用类型转换 {n0}");
  try {
    assert.equal((await f.run("wrap")).code, 0);
    const output = read(f.file);
    assert.ok(output.includes("/*before*/"));
    assert.ok(output.includes("/*after*/"));
    const captures = [];
    for (const code of [source, output]) {
      const values = [];
      const sandbox = { exports: {}, require: (path) => path === "@/lib/i18n" ? runtime : { toast: { success: (value) => values.push(value) } } };
      vm.runInNewContext(ts.transpileModule(code, { compilerOptions }).outputText, sandbox);
      for (const value of [undefined, null, false, 0, { toString: () => "object" }]) sandbox.exports.show(value);
      assert.throws(() => sandbox.exports.show(Symbol("fixture")));
      captures.push(values);
    }
    assert.deepEqual(captures[0], captures[1]);
  } finally { f.close(); }
});

test("raw status key maps still require both dictionaries without client imports or source edits", async () => {
  const f = fixture('"use client"; export const Demo=()=> <p>立即同步</p>;');
  const path = join(f.dir, "web/src/lib/status.ts");
  const original = 'export const statuses = { fresh: { label: "新增状态标签", tone: "neutral" } };';
  writeFileSync(path, original);
  try {
    assert.equal((await f.run("wrap", ["--check"])).code, 1);
    for (const lang of ["en", "ko"]) {
      const dict = join(f.dir, `web/src/lib/i18n/${lang}.json`);
      writeFileSync(dict, JSON.stringify({ ...json(dict), "新增状态标签": lang === "en" ? "New status" : "새 상태" }));
    }
    assert.equal((await f.run("wrap")).code, 0);
    assert.equal((await f.run("wrap", ["--check"])).code, 0);
    assert.equal(read(path), original);
  } finally { f.close(); }
});

test("numeric JSX entities are decoded before inventory and wrapping", async () => {
  const f = fixture('"use client"; export const Demo=()=> <p>&#x4e2d;&#25991;</p>;', { "中文": ["Chinese", "중국어"] });
  try {
    assert.equal((await f.run("wrap")).code, 0);
    assert.ok(read(f.file).includes('tr("中文")'));
    assert.equal((await f.run("wrap", ["--check"])).code, 0);
  } finally { f.close(); }
});

test("numeric and repeated placeholders cannot disappear in provider output", async () => {
  const f = fixture('"use client"; import {tr} from "@/lib/i18n"; export const Demo=({n})=> <p>{tr("待办 {0} {0}",{0:n})}</p>;');
  const path = join(f.dir, "web/src/lib/i18n/en.json");
  const before = read(path);
  try {
    await withAPI(async (env) => { assert.equal((await f.run("translate", ["en"], env)).code, 1); assert.equal(read(path), before); }, () => ({ map: { "待办 {0} {0}": "Todo {0}" } }));
  } finally { f.close(); }
});

test("server source is not given a client-only import", async () => {
  const source = '"use server";\nexport async function Demo() { return <p>立即同步</p>; }\n';
  const f = fixture(source);
  try { assert.notEqual((await f.run("wrap")).code, 0); assert.equal(read(f.file), source); }
  finally { f.close(); }
});

test("API failure stops sync without changing either dictionary or source", async () => {
  const f = fixture('"use client";\nexport const Demo=()=> <p>新的界面标题</p>;\n');
  const before = [read(f.file), ...["en", "ko"].map((lang) => read(join(f.dir, `web/src/lib/i18n/${lang}.json`)))];
  try {
    await withAPI(async (env) => {
      const result = await f.run("sync", [], env);
      assert.notEqual(result.code, 0);
      assert.deepEqual([read(f.file), ...["en", "ko"].map((lang) => read(join(f.dir, `web/src/lib/i18n/${lang}.json`)))], before);
    }, () => ({ status: 401, body: { error: "fixture authentication failure" } }));
  } finally { f.close(); }
});

test("malformed dictionary is reported, never silently replaced", async () => {
  const f = fixture('"use client";\nexport const Demo=()=> <p>新的界面标题</p>;\n');
  const path = join(f.dir, "web/src/lib/i18n/en.json");
  writeFileSync(path, '{"manual": broken');
  try {
    await withAPI(async (env) => { assert.notEqual((await f.run("translate", [], env)).code, 0); assert.equal(read(path), '{"manual": broken'); }, () => ({ map: { "新的界面标题": "New title" } }));
  } finally { f.close(); }
});

for (const [name, map] of [ ["missing key", {}], ["missing placeholder", { "删除 {n0} 条": "Delete items" }], ["extra placeholder", { "删除 {n0} 条": "Delete {n0} {n1}" }], ["empty translation", { "删除 {n0} 条": " " }], ["not an object", []], ["array containing a valid map", [{ "删除 {n0} 条": "Delete {n0} items" }]] ]) {
  test(`translator rejects ${name} and leaves dictionaries unchanged`, async () => {
    const f = fixture('"use client";\nexport const Demo=({n}: {n:number})=> <p>{`删除 ${n} 条`}</p>;\n');
    const path = join(f.dir, "web/src/lib/i18n/en.json");
    const before = read(path);
    try {
      await withAPI(async (env) => { assert.notEqual((await f.run("translate", ["en"], env)).code, 0); assert.equal(read(path), before); }, () => ({ map }));
    } finally { f.close(); }
  });
}

test("local compatible API exercises translate→wrap→check, preserves manual entries, resumes Korean gaps", async () => {
  const source = '"use client";\nexport const Demo=({n}: {n:number})=> <p title="立即同步">{`删除 ${n} 条`}</p>;\n';
  const f = fixture(source);
  try {
    await withAPI(async (env) => {
      assert.equal((await f.run("sync", [], env)).code, 0);
      assert.equal(json(join(f.dir, "web/src/lib/i18n/en.json"))["立即同步"], "Sync now");
      assert.ok(read(f.file).includes('tr("删除 {n0} 条"'));
      assert.equal((await f.run("wrap", ["--check"])).code, 0);
      const ko = json(join(f.dir, "web/src/lib/i18n/ko.json"));
      delete ko["删除 {n0} 条"];
      writeFileSync(join(f.dir, "web/src/lib/i18n/ko.json"), JSON.stringify(ko));
      assert.equal((await f.run("translate", ["ko"], env)).code, 0);
      assert.equal(json(join(f.dir, "web/src/lib/i18n/ko.json"))["删除 {n0} 条"], "항목 {n0}개 삭제");
    }, (request) => ({ map: { "删除 {n0} 条": request.messages[0].content.includes("Korean") ? "항목 {n0}개 삭제" : "Delete {n0} items" } }));
  } finally { f.close(); }
});

test("Anthropic branch sends supported model and Messages protocol using a local HTTP fixture", async () => {
  const f = fixture('"use client"; export const Demo=()=> <p>新的界面标题</p>;');
  const prelude = join(f.dir, "anthropic-fetch-fixture.mjs");
  writeFileSync(prelude, 'const realFetch=globalThis.fetch; globalThis.fetch=(url,options)=>{if(url!=="https://api.anthropic.com/v1/messages")throw new Error("Unexpected external URL");return realFetch(process.env.I18N_BASE_URL+"/messages",options)};');
  let requestBody;
  try {
    await withAPI(async (env) => {
      const result = await f.run("translate", ["en"], { ...env, ANTHROPIC_API_KEY: "fixture-only", NODE_OPTIONS: `--import=${prelude}` });
      assert.equal(result.code, 0, result.stderr);
      assert.equal(requestBody.model, "claude-haiku-4-5-20251001");
      assert.equal(requestBody.max_tokens, 8000);
      assert.ok(requestBody.system.includes("English"));
      assert.equal(json(join(f.dir, "web/src/lib/i18n/en.json"))["新的界面标题"], "New title");
    }, (request, req) => { requestBody = request; assert.equal(req.headers["x-api-key"], "fixture-only"); assert.equal(req.headers["anthropic-version"], "2023-06-01"); return { map: { "新的界面标题": "New title" } }; });
  } finally { f.close(); }
});

test("model/base URL override keeps OpenAI requests free of model-specific sampling parameters", async () => {
  const f = fixture('"use client"; export const Demo=()=> <p>新的界面标题</p>;');
  let requestBody;
  try {
    await withAPI(async (env) => {
      assert.equal((await f.run("translate", ["en"], { ...env, I18N_MODEL: "fixture-model", I18N_BASE_URL: env.I18N_BASE_URL + "/" })).code, 0);
      assert.equal(requestBody.model, "fixture-model");
      assert.equal(requestBody.response_format.type, "json_object");
      assert.ok(!Object.hasOwn(requestBody, "temperature"));
    }, (request) => { requestBody = request; return { map: { "新的界面标题": "New title" } }; });
  } finally { f.close(); }
});

test("prototype-like translation keys remain own dictionary entries", async () => {
  const f = fixture('"use client"; import {tr} from "@/lib/i18n"; export const Demo=()=> <p>{tr("__proto__")}</p>;');
  try {
    await withAPI(async (env) => {
      assert.equal((await f.run("translate", ["en"], env)).code, 0);
      const dict = json(join(f.dir, "web/src/lib/i18n/en.json"));
      assert.ok(Object.hasOwn(dict, "__proto__"));
      assert.equal(dict.__proto__, "Prototype");
    }, () => ({ map: JSON.parse('{"__proto__":"Prototype"}') }));
  } finally { f.close(); }
});

test("punctuation-only JSX fragments are translated without touching protocol punctuation", async () => {
  const f = fixture('"use client"; const protocol="）"; export const Demo=({n})=><p><option value="）" />{n}）</p>;', { "）": [")", ")"] });
  try {
    assert.equal((await f.run("wrap")).code, 0);
    assert.ok(read(f.file).includes('value="）"'));
    assert.ok(read(f.file).includes('protocol="）"'));
    assert.ok(read(f.file).includes('tr("）")'));
    assert.equal((await f.run("wrap", ["--check"])).code, 0);
  } finally { f.close(); }
});

test("catch shadowing and nested translated calls are inventoried safely", async () => {
  const f = fixture('"use client"; import {tr} from "@/lib/i18n"; try {} catch(tr) {const view=<p>立即同步</p>}', { "立即同步": ["Sync now", "지금 동기화"], "父 {n0}": ["Parent {n0}", "부모 {n0}"] });
  try {
    assert.equal((await f.run("wrap")).code, 0);
    assert.match(read(f.file), /tr as i18nTr/);
    writeFileSync(f.file, '"use client"; import {tr} from "@/lib/i18n"; const view=<p>{tr("父 {n0}",{n0:tr("缺失子项")})}</p>');
    const result = await f.run("wrap", ["--check"]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /缺失子项/);
  } finally { f.close(); }
});

test("nested raw display branches are reported before template replacement, never silently left untranslated", async () => {
  const source = '"use client"; import {toast} from "sonner"; toast.success(`提示：${ok ? "成功" : "失败"}`);';
  const f = fixture(source, { "提示：{n0}": ["Notice: {n0}", "안내: {n0}"], "成功": ["Success", "성공"], "失败": ["Failure", "실패"] });
  try {
    const result = await f.run("wrap");
    assert.equal(result.code, 1);
    assert.match(result.stderr, /成功/);
    assert.match(result.stderr, /失败/);
    assert.equal(read(f.file), source);
    writeFileSync(f.file, '"use client"; import {tr} from "@/lib/i18n"; import {toast} from "sonner"; toast.success(`提示：${ok ? tr("成功") : tr("失败")}`);');
    assert.equal((await f.run("wrap")).code, 0);
    assert.equal((await f.run("wrap", ["--check"])).code, 0);
  } finally { f.close(); }
});

test("provider timeout and missing credentials fail without touching source", async () => {
  const f = fixture('"use client"; export const Demo=()=> <p>新的界面标题</p>;');
  const before = read(f.file);
  try {
    assert.equal((await f.run("sync")).code, 1);
    await withAPI(async (env) => {
      const result = await f.run("translate", [], { ...env, I18N_TIMEOUT_MS: "50" });
      assert.equal(result.code, 1);
      assert.equal(read(f.file), before);
    }, () => null);
  } finally { f.close(); }
});

test("failure in Korean after successful English responses saves neither dictionary", async () => {
  const f = fixture('"use client"; export const Demo=()=> <p>新的界面标题</p>;');
  const paths = ["en", "ko"].map((lang) => join(f.dir, `web/src/lib/i18n/${lang}.json`));
  const before = paths.map(read);
  try {
    await withAPI(async (env) => { assert.equal((await f.run("translate", [], env)).code, 1); assert.deepEqual(paths.map(read), before); },
      (request) => request.messages[0].content.includes("Korean") ? { status: 503, body: {} } : { map: { "新的界面标题": "New title" } });
  } finally { f.close(); }
});

test("duplicate dictionary keys are rejected, and type-only imports do not authorize client translation", async () => {
  const f = fixture('import type {Locale} from "@/lib/i18n"; export const Demo=()=> <p>立即同步</p>;');
  try {
    const before = read(f.file);
    assert.equal((await f.run("wrap")).code, 1);
    assert.equal(read(f.file), before);
    writeFileSync(join(f.dir, "web/src/lib/i18n/en.json"), '{"立即同步":"First","立即同步":"Second"}');
    const result = await f.run("translate");
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Duplicate/);
  } finally { f.close(); }
});

test("function-expression shadowing gets a safe alias; persisted description fields are not rewritten", async () => {
  const f = fixture('"use client"; import {tr} from "@/lib/i18n"; const Demo=function tr(){return <p>立即同步</p>};');
  try {
    assert.equal((await f.run("wrap")).code, 0);
    assert.match(read(f.file), /tr as i18nTr/);
    assert.ok(read(f.file).includes('i18nTr("立即同步")'));
    assert.equal((await f.run("wrap", ["--check"])).code, 0);
    const payload = '"use client"; const payload={description:"立即同步"}; export const Demo=()=> <p>立即同步</p>;';
    writeFileSync(f.file, payload);
    assert.equal((await f.run("wrap")).code, 1);
    assert.equal(read(f.file), payload);
  } finally { f.close(); }
});

test("invalid batch/limit fail promptly instead of looping or reporting false completion", async () => {
  const f = fixture('"use client";\nexport const Demo=()=> <p>新的界面标题</p>;\n');
  try { for (const env of [{ BATCH: "0" }, { BATCH: "NaN" }, { LIMIT: "-1" }]) { const result = await f.run("translate", [], env); assert.ok(result.signal == null); assert.equal(result.code, 1); } }
  finally { f.close(); }
});

function loadBuiltinLabels(locale) {
  const runtime = loadRuntime(locale);
  const originals = json(join(root, "web/src/lib/builtin-tool-descriptions.json"));
  const sandbox = { exports: {}, require: (path) => path === "@/lib/i18n" ? runtime : path === "./builtin-tool-descriptions.json" ? originals : path === "./builtin-metadata.json" ? json(join(root, "web/src/lib/builtin-metadata.json")) : require(path) };
  vm.runInNewContext(ts.transpileModule(read(join(root, "web/src/lib/builtin-labels.ts")), { compilerOptions }).outputText, sandbox);
  return { ...sandbox.exports, originals, runtime };
}

function displayComponent(path, locale, exports) {
  const labels = loadBuiltinLabels(locale);
  const passthrough = ({ children }) => React.createElement("span", null, children);
  const ui = new Proxy({}, { get: () => passthrough });
  const sandbox = { exports: {}, require: (path) => path === "@/lib/i18n" ? labels.runtime : path === "@/lib/builtin-labels" ? labels : path === "@/lib/utils" ? { cn: (...parts) => parts.filter(Boolean).join(" "), copyText: async () => true } : path === "react" ? React : path === "react/jsx-runtime" ? require(path) : ui };
  vm.runInNewContext(ts.transpileModule(read(join(root, path)) + `\nexport { ${exports} };`, { compilerOptions }).outputText, sandbox);
  return { ...sandbox.exports, ...labels };
}

for (const locale of ["en", "ko"]) {
  test(`populated builtin tool cards render ${locale} summaries without changing source data`, () => {
    const labels = displayComponent("web/src/app/(main)/system/tools/page.tsx", locale, "ToolGridCard");
    for (const [key, description] of Object.entries(labels.originals)) {
      const tool = { key, description, system: true, agents: ["worker"], schema: { properties: {} }, enabled: true };
      const before = JSON.stringify(tool);
      const html = renderToString(React.createElement(labels.ToolGridCard, { tool, onClick: () => {} }));
      assert.ok(html.includes(renderToString(React.createElement(React.Fragment, null, dictionaries[locale][`builtin.tool.${key}.summary`]))), key);
      assert.ok(!/[\u4e00-\u9fff]/.test(html), key);
      assert.equal(JSON.stringify(tool), before);
      assert.equal(labels.toolDescription({ ...tool, system: false }), description);
      assert.equal(labels.toolDescription({ ...tool, description: "用户改写的说明" }), "用户改写的说明");
    }
    assert.equal(labels.toolDescription({ key: "constructor", system: true, description: "未知工具" }), "未知工具");
  });

  test(`builtin agents and reserved intercept labels render ${locale}; custom data remains verbatim`, () => {
    const labels = displayComponent("web/src/app/(main)/system/agents/page.tsx", locale, "AgentGridCard");
    const agent = { key: "goals", name: "目标拆解", description: "把渗透任务目标拆解成若干独立、可验证的子目标。", builtin: true, enabled: true };
    const before = JSON.stringify(agent);
    const html = renderToString(React.createElement(labels.AgentGridCard, { agent, onOpen: () => {}, onDeleted: () => {} }));
    assert.ok(html.includes(dictionaries[locale][agent.name]));
    assert.ok(!/[\u4e00-\u9fff]/.test(html));
    assert.equal(JSON.stringify(agent), before);
    assert.equal(labels.agentName({ ...agent, builtin: false }), agent.name);
    assert.equal(labels.agentName({ ...agent, name: "规划" }), "规划", "An edited builtin name must not be hidden by another known key");
    assert.equal(labels.agentName({ ...agent, key: "constructor" }), agent.name);
    assert.equal(labels.agentDescription({ ...agent, builtin: false }), agent.description);
    assert.equal(labels.agentDescription({ ...agent, description: "任务总目标" }), "任务总目标", "Edited builtin descriptions stay original");
    assert.equal(labels.agentDescription({ builtin: true }), "");
    // Built-in command-rule names are localized via an exact match against the catalogued
    // set; user-created names stay raw. Display-only; stored rule.name is unchanged.
    assert.equal(typeof labels.interceptRuleName, "function");
    const builtinRule = json(join(root, "web/src/lib/builtin-metadata.json")).interceptNames[0];
    assert.ok(builtinRule, "catalogue has built-in command-rule names");
    assert.equal(labels.interceptRuleName(builtinRule), dictionaries[locale][builtinRule]);
    assert.equal(labels.interceptRuleName("用户自定义命令规则"), "用户自定义命令规则", "user-created rule names stay raw");
    assert.equal(labels.interceptRuleName(""), "");
    assert.match(read(join(root, "web/src/app/(main)/system/intercept/page.tsx")), /InterceptRuleName\(rule\.name\)/);
    const approvals = read(join(root, "web/src/components/approval-records.tsx"));
    assert.match(approvals, /InterceptRuleName\(row\.rule_name\)/);
    assert.match(approvals, /InterceptRuleName\(audit\.rule_name\)/);
    const metadata = json(join(root, "web/src/lib/builtin-metadata.json"));
    assert.equal(labels.variableDescription({ name: "Now", description: metadata.globalVariables.Now }), dictionaries[locale][metadata.globalVariables.Now]);
    assert.equal(labels.variableDescription({ name: "Now", description: "任务总目标" }), "任务总目标", "Global help must match the same name, not any other known variable");
    assert.equal(labels.variableDescription({ name: "Custom", description: "任务总目标" }), "任务总目标");
    for (const [key, builtin] of Object.entries(metadata.agents)) for (const [name, description] of Object.entries(builtin.variables)) {
      assert.equal(labels.variableDescription({ name, description }, { key, builtin: true }), dictionaries[locale][description]);
      assert.equal(labels.variableDescription({ name, description }, { key, builtin: false }), description);
      assert.equal(labels.variableDescription({ name: "Custom", description }, { key, builtin: true }), description);
    }
    for (const rule of metadata.assetRules) {
      assert.equal(labels.assetNote({ ...rule, builtin: true }), dictionaries[locale][rule.note]);
      assert.equal(labels.assetNote({ ...rule, builtin: false }), rule.note);
      assert.equal(labels.assetNote({ ...rule, builtin: true, pattern: "edited.example" }), rule.note);
      assert.equal(labels.assetNote({ ...rule, builtin: true, kind: "exact_domain" }), rule.note);
      assert.equal(labels.assetNote({ ...rule, builtin: true, note: "规划" }), "规划", "Edited builtin asset notes stay original");
    }
  });

  test(`localized asset-rule groupings retain all seven original option values in ${locale}`, () => {
    const path = join(root, "web/src/app/(main)/system/intercept/assets/page.tsx");
    const source = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true);
    const declarations = source.statements.filter((node) => ts.isVariableStatement(node) && node.declarationList.declarations.some((d) => ["KIND_OPTIONS", "KIND_GROUPS"].includes(d.name.getText(source)))).map((n) => n.getText(source)).join("\n");
    const sandbox = { exports: {}, tr: loadRuntime(locale).tr };
    vm.runInNewContext(ts.transpileModule(declarations + "\nexport { KIND_OPTIONS, KIND_GROUPS };", { compilerOptions }).outputText, sandbox);
    const { KIND_OPTIONS: options, KIND_GROUPS: groups } = sandbox.exports;
    assert.equal(groups.length, 3);
    assert.equal(groups.flatMap((g) => options.filter((o) => o.group === g)).length, 7);
    assert.equal(options.map((o) => o.value).join(","), "exact_domain,exact_ip,exact_url,fuzzy_domain,fuzzy_ip,fuzzy_url,cidr");
    assert.ok(!/[\u4e00-\u9fff]/.test(groups.join(" ")));
  });

  test(`webhook help is localized in ${locale} while template tokens remain literal`, () => {
    const sandbox = { exports: {}, require: (path) => path === "@/lib/i18n" ? loadRuntime(locale) : require(path) };
    vm.runInNewContext(ts.transpileModule(read(join(root, "web/src/app/(main)/system/notify/_components/channel-fields.ts")), { compilerOptions }).outputText, sandbox);
    const help = sandbox.exports.CHANNEL_FIELDS.webhook.find((field) => field.key === "body_template").help;
    assert.ok(!/[\u4e00-\u9fff]/.test(help));
    for (const token of ["{{.Title}}", "{{.Batch}}", "{{.Count}}", "{{.HomeURL}}", "{{.SentAt}}", "range .Items", ".StatusLabel", "{{json .Xxx}}", "{{.Xxx}}"] ) assert.ok(help.includes(token), token);
  });
}

test("new Specs with computed descriptions fail instead of silently passing the metadata inventory", async () => {
  const dir = mkdtempSync(join(tmpdir(), "artex-catalog-source-"));
  try {
    mkdirSync(join(dir, "traffic"));
    writeFileSync(join(dir, "traffic/meta.go"), 'package traffic\nvar metadata = actool.Spec{Name: "new_tool", Description: computeDescription()}\n');
    await assert.rejects(exec("go", ["run", join(root, "scripts/i18n/catalog.go"), dir], { timeout: 60000 }), /Unsupported description for new_tool/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("static backend tool metadata matches the display snapshot without executing any tool", async () => {
  const { stdout } = await exec("go", ["run", join(root, "scripts/i18n/catalog.go"), root], { cwd: root, timeout: 60000 });
  const entries = JSON.parse(stdout);
  assert.equal(new Set(entries.map((entry) => entry.key)).size, entries.length, "Duplicate tool keys need manual review");
  const current = Object.fromEntries(entries.map((entry) => [entry.key, entry.text]));
  assert.deepEqual(current, json(join(root, "web/src/lib/builtin-tool-descriptions.json")), "Backend metadata changed: review/update display summaries and their exact-source snapshot");
  for (const key of Object.keys(current)) for (const locale of ["en", "ko"]) assert.ok(dictionaries[locale][`builtin.tool.${key}.summary`], `${locale}: ${key}`);
});

for (const locale of ["en", "ko"]) {
  test(`shared status metadata translates ${locale} labels without changing keys, tones or unknown values`, () => {
    const sandbox = { exports: {}, require: (path) => path === "@/lib/i18n" ? loadRuntime(locale) : require(path) };
    vm.runInNewContext(ts.transpileModule(read(join(root, "web/src/lib/status.ts")) + "\nexport { maps };", { compilerOptions }).outputText, sandbox);
    const { maps, statusMeta } = sandbox.exports;
    for (const [domain, entries] of Object.entries(maps)) for (const [key, meta] of Object.entries(entries)) {
      const before = JSON.stringify(meta), display = statusMeta(domain, key);
      assert.equal(display.label, dictionaries[locale][meta.label] ?? meta.label);
      assert.equal(display.tone, meta.tone);
      assert.equal(JSON.stringify(meta), before);
      assert.ok(!/\p{Script=Han}/u.test(display.label));
    }
    assert.equal(statusMeta("delivery", "用户状态").label, "用户状态");
    assert.equal(statusMeta("delivery", "constructor").label, "constructor");
  });

  test(`chat default-profile label and tooltip render ${locale} without rewriting profile names`, () => {
    const view = displayComponent("web/src/app/(main)/chat/page.tsx", locale, "LLMProfileRow");
    const profiles = [{ id: "1", name: "Fixture LLM", is_default: true }];
    const before = JSON.stringify(profiles);
    const html = renderToString(React.createElement(view.LLMProfileRow, { profiles, selected: null, onChange: () => {} }));
    assert.ok(html.includes(`title="${view.runtime.tr("默认（{n0}）", { n0: profiles[0].name })}"`));
    assert.ok(!/\p{Script=Han}/u.test(html));
    assert.equal(JSON.stringify(profiles), before);
    const custom = renderToString(React.createElement(view.LLMProfileRow, { profiles: [{ ...profiles[0], name: "用户模型名称" }], selected: 1, onChange: () => {} }));
    assert.ok(custom.includes('title="用户模型名称"'));
  });

  test(`CopyButton defaults and activity-time tooltip use ${locale} display text`, () => {
    const copy = displayComponent("web/src/components/copy-button.tsx", locale, "CopyButton");
    const html = renderToString(React.createElement(copy.CopyButton, { text: "fixture-only" }));
    assert.ok(html.includes(dictionaries[locale]["复制"]));
    assert.ok(!/\p{Script=Han}/u.test(html));
    const time = displayComponent("web/src/components/transcript.tsx", locale, "ActivityTime");
    const date = renderToString(React.createElement(time.ActivityTime, { ts: "2026-10-03T12:34:00Z" }));
    assert.ok(date.includes("title="));
    assert.ok(!/\p{Script=Han}/u.test(date));
  });
}

test("conditional display hints are wrapped but logical predicates/protocol comparisons are preserved", async () => {
  const f = fixture('"use client"; export function Demo({loading,flag}) { const protocol = flag === "立即同步"; return <p>{loading && "立即同步"}{flag === "立即同步" && <i>{flag}</i>}</p> }');
  try {
    const result = await f.run("wrap");
    assert.equal(result.code, 0, result.stderr);
    assert.match(read(f.file), /loading && tr\("立即同步"\)/);
    assert.equal(read(f.file).match(/flag === "立即同步"/g).length, 2);
    assert.equal((await f.run("wrap", ["--check"])).code, 0);
  } finally { f.close(); }
});

test("known builtin Agent/variable/rule metadata matches its reviewed source-only snapshot", async () => {
  const { stdout } = await exec("go", ["run", join(root, "scripts/i18n/catalog.go"), root, "--metadata"], { cwd: root, timeout: 60000 });
  const metadata = JSON.parse(stdout);
  assert.deepEqual(metadata, json(join(root, "web/src/lib/builtin-metadata.json")));
  const labels = [...Object.values(metadata.agents).flatMap((a) => [a.name, a.description]), ...metadata.variableHelp, ...metadata.interceptNames, ...metadata.assetNotes];
  for (const locale of ["en", "ko"]) for (const key of labels.filter((s) => /\p{Script=Han}/u.test(s))) assert.ok(dictionaries[locale][key], `${locale}: ${key}`);
});

test("reviewed snapshot refresh reports untranslated new metadata instead of silently passing", async () => {
  const f = fixture('"use client"; export const Demo=()=>null;', { "名称": ["Name", "이름"], "说明": ["Description", "설명"], "变量": ["Variable", "변수"], "[内置] 规则": ["Rule", "규칙"], "[内置] 资产": ["Asset", "자산"] });
  try {
    for (const dir of ["agent", "server", "traffic", "db"]) mkdirSync(join(f.dir, dir));
    writeFileSync(join(f.dir, "agent/meta.go"), 'package agent\nvar tool=readTool("fixture_tool", "模型说明")\n');
    writeFileSync(join(f.dir, "db/db.go"), 'package db\nvar builtinAgents=[]builtinAgent{{"a", "名称", "role", "说明", nil}}\nfunc seedDefaultAssetInterceptRules(){ rules:=[]struct{kind,pattern,note string}{{"fuzzy_domain", ".gov", "[内置] 资产"}}; _=rules }\nconst rule="[内置] 规则"\n');
    writeFileSync(join(f.dir, "server/server_mgmt.go"), 'package server\nvar globalPromptVars=[]db.PromptVar{{Name:"Now", Description:"变量"}}\n');
    for (const lang of ["en", "ko"]) {
      const p = join(f.dir, `web/src/lib/i18n/${lang}.json`), d = json(p);
      d["builtin.tool.fixture_tool.summary"] = "UI summary";
      writeFileSync(p, JSON.stringify(d));
    }
    const { stdout } = await exec("go", ["run", join(root, "scripts/i18n/catalog.go"), f.dir, "--metadata"], { timeout: 60000 });
    const metadata = join(f.dir, "web/src/lib/builtin-metadata.json");
    writeFileSync(metadata, stdout);
    writeFileSync(join(f.dir, "web/src/lib/builtin-tool-descriptions.json"), JSON.stringify({ fixture_tool: "模型说明" }));
    assert.equal((await f.run("catalog-check")).code, 0);
    const file = join(f.dir, "db/db.go"); writeFileSync(file, read(file).replace('"名称"', '"新增名称"'));
    const before = read(metadata);
    const check = await f.run("catalog-check"); assert.notEqual(check.code, 0); assert.match(check.stderr, /Built-in metadata changed/); assert.equal(read(metadata), before);
    const updated = await f.run("catalog-check", ["--update"]); assert.notEqual(updated.code, 0); assert.match(updated.stderr, /missing builtin display translations/); assert.match(read(metadata), /新增名称/);
    assert.ok(!Object.hasOwn(json(join(f.dir, "web/src/lib/i18n/en.json")), "新增名称"));
    const missing = await f.run("extract"); assert.match(missing.stdout, /新增名称/);
    writeFileSync(file, read(file).replace('"新增名称"', 'computedName()'));
    const unsupported = await f.run("catalog-check", ["--update"]); assert.notEqual(unsupported.code, 0); assert.match(unsupported.stderr, /Unsupported builtin display label/);
  } finally { f.close(); }
});

test("UI date formatters cannot silently reintroduce forced Chinese locale after an upstream merge", () => {
  for (const path of sourceFiles()) {
    const source = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true);
    function visit(node) {
      if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && node.arguments?.[0] && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === "zh-CN" && /toLocale(?:DateString|String|TimeString)|Intl\.DateTimeFormat/.test(node.expression.getText(source))) assert.fail(`${path}: hardcoded Chinese display date locale`);
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
});

test("English display text needs Korean or an intentional-raw entry; allowlisted brand terms stay raw", async () => {
  const f = fixture('"use client"; export const Demo=()=> <p>Settings</p>;', { "Settings": ["Settings", "설정"] });
  try {
    assert.equal((await f.run("wrap")).code, 0);
    assert.ok(read(f.file).includes('tr("Settings")'));
    assert.equal((await f.run("wrap", ["--check"])).code, 0);
    writeFileSync(f.file, '"use client"; export const Demo=()=> <p>Dashboard</p>;');
    const miss = await f.run("wrap", ["--check"]);
    assert.equal(miss.code, 1);
    assert.match(miss.stderr, /Dashboard/);
    writeFileSync(f.file, '"use client"; export const Demo=()=> <p>ARTEX</p>;');
    const ok = await f.run("wrap", ["--check"]);
    assert.equal(ok.code, 0, ok.stderr);
    assert.ok(read(f.file).includes("<p>ARTEX</p>"));
  } finally { f.close(); }
});

test("Chinese outside a display position must be a dictionary key or intentional-raw; comparisons are not wrapped", async () => {
  const f = fixture('"use client"; export function Demo(x){ return x === "归档不存在" ? 1 : 2; }', { "归档不存在": ["Archive missing", "아카이브 없음"] });
  try {
    assert.equal((await f.run("wrap", ["--check"])).code, 0);
    assert.ok(read(f.file).includes('=== "归档不存在"'));
    writeFileSync(f.file, '"use client"; export function Demo(x){ return x === "未登记错误" ? 1 : 2; }');
    const miss = await f.run("wrap", ["--check"]);
    assert.equal(miss.code, 1);
    assert.match(miss.stderr, /未登记错误/);
    writeFileSync(f.file, '"use client"; export const parts = ["a", "b"].join("、");');
    assert.equal((await f.run("wrap", ["--check"])).code, 0);
  } finally { f.close(); }
});

test("file-scoped intentional-raw entries do not exempt the same text in another file", async () => {
  const f = fixture('"use client"; export const Demo=()=> <p>host</p>;', {});
  try {
    const r = await f.run("wrap", ["--check"]);
    assert.equal(r.code, 1); // "host" is allowlisted only inside function/traffic/page.tsx
    assert.match(r.stderr, /host/);
  } finally { f.close(); }
});

test("unused-key report lists orphan keys and dynamic tr(expr) sites without failing", async () => {
  const f = fixture('"use client"; import {tr} from "@/lib/i18n"; export const Demo=({k})=> <p>{tr(k)}</p>;', { "孤立键": ["Orphan", "고아"] });
  try {
    const r = await f.run("unused");
    assert.equal(r.code, 0);
    assert.match(r.stdout, /孤立键/);
    assert.match(r.stdout, /tr\(k\)/);
  } finally { f.close(); }
});
