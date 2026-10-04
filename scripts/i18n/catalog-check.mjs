// Known source defaults only. No application imports, initialization or tool handlers.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { ROOT, EN, KO, loadJSON, writeAtomic } from "./extract.mjs";

try {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length && args[0] !== "--update")) throw new Error("Usage: catalog-check.mjs [--update]");
  const scan = (args = []) => JSON.parse(execFileSync("go", ["run", join(ROOT, "scripts/i18n/catalog.go"), ROOT, ...args], { cwd: ROOT, encoding: "utf8", timeout: 60000 }));
  const entries = scan();
  if (new Set(entries.map((entry) => entry.key)).size !== entries.length) throw new Error("Duplicate tool metadata keys require manual review");
  const current = Object.fromEntries(entries.map((entry) => [entry.key, entry.text]));
  const metadata = scan(["--metadata"]);
  const snapshots = [
    [join(ROOT, "web/src/lib/builtin-tool-descriptions.json"), current],
    [join(ROOT, "web/src/lib/builtin-metadata.json"), metadata],
  ];
  for (const [path, value] of snapshots) {
    const original = JSON.parse(readFileSync(path, "utf8"));
    if (!isDeepStrictEqual(value, original)) {
      if (!args.length) throw new Error(`Built-in metadata changed: ${path}. Review source changes; use --update only to refresh reviewed snapshots, then review both dictionaries.`);
      writeAtomic(path, JSON.stringify(value, null, 2) + "\n");
      console.error(`Updated ${path}; review summaries/labels and git diff. No translations or backend data were modified.`);
    }
  }
  const labels = [...Object.values(metadata.agents).flatMap((a) => [a.name, a.description]), ...metadata.variableHelp, ...metadata.interceptNames, ...metadata.assetNotes].filter((text) => /\p{Script=Han}/u.test(text));
  for (const [locale, path] of [["en", EN], ["ko", KO]]) {
    const dictionary = loadJSON(path);
    const missing = [...Object.keys(current).map((key) => `builtin.tool.${key}.summary`), ...labels].filter((key) => !Object.hasOwn(dictionary, key));
    if (missing.length) throw new Error(`${locale} missing builtin display translations:\n${missing.join("\n")}\nFill both dictionaries; tool summaries are UI-only, not model instructions.`);
  }
  console.log(`i18n catalog check: ${entries.length} tool defaults, ${Object.keys(metadata.agents).length} Agents, ${metadata.variableHelp.length} variable hints, ${metadata.interceptNames.length} intercept names and ${metadata.assetNotes.length} asset notes match reviewed snapshots.`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
