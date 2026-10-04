// Parser-backed, dictionary-checked display edits. --check never writes source.
import { relative } from "node:path";
import { loadJSON, writeAtomic, EN, KO, ROOT, sourceFiles, scanSource, ts } from "./extract.mjs";

try {
  const check = process.argv.includes("--check");
  const dictionaries = { en: loadJSON(EN), ko: loadJSON(KO) };
  const updates = [];
  const issues = [];
  for (const path of sourceFiles()) {
    const file = scanSource(path);
    const edits = [];
    for (const candidate of file.candidates) {
      const location = `${relative(ROOT, path)}:${candidate.line}`;
      const missing = Object.entries(dictionaries).filter(([, dict]) => !Object.hasOwn(dict, candidate.key)).map(([lang]) => lang);
      if (missing.length) { issues.push(`${location}: missing ${missing.join("/")}: ${JSON.stringify(candidate.key)}`); continue; }
      if (candidate.kind === "key" || candidate.excluded) continue;
      if (candidate.kind === "manual") { issues.push(`${location}: review these display/key or nested-expression semantics manually: ${JSON.stringify(candidate.key)}`); continue; }
      if (!file.clientSafe) { issues.push(`${location}: needs a reviewed client boundary before translating ${JSON.stringify(candidate.key)}`); continue; }
      edits.push(candidate);
    }
    if (!edits.length) continue;
    let output = file.text;
    for (const edit of edits.sort((a, b) => b.start - a.start)) output = output.slice(0, edit.start) + edit.replacement + output.slice(edit.end);
    if (file.needsImport) {
      const declaration = `import { ${file.alias === "tr" ? "tr" : `tr as ${file.alias}`} } from "@/lib/i18n";`;
      output = output.slice(0, file.importOffset) + (file.importOffset ? "\n" : "") + declaration + "\n" + output.slice(file.importOffset);
    }
    const parsed = ts.createSourceFile(path, output, ts.ScriptTarget.Latest, true);
    if (parsed.parseDiagnostics.length) throw new Error(`Refusing invalid transformed source: ${relative(ROOT, path)}`);
    updates.push({ path, output });
  }
  // Validate the entire plan before writing. Each file replacement is atomic; an
  // interrupted multi-file run may still be partial and can be safely rerun.
  if (issues.length) throw new Error(`i18n check failed:\n${issues.join("\n")}`);
  if (check && updates.length) throw new Error(`${updates.length} file(s) need wrapping:\n${updates.map(({ path }) => relative(ROOT, path)).join("\n")}`);
  if (!check) for (const { path, output } of updates) writeAtomic(path, output);
  console.error(check ? "i18n check: dictionaries and display wraps are up to date." : `wrapped ${updates.length} file(s).`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
