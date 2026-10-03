// One-shot i18n sync: translate every new Chinese string, then wrap it in tr().
// Use after merging upstream changes.  node scripts/i18n/sync.mjs
import { execSync } from "node:child_process";

function run(cmd) {
  console.error(`\n$ ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

// 1) fill en.json + ko.json for any new Chinese (LLM; needs ANTHROPIC_API_KEY or OPENAI_API_KEY)
run("node scripts/i18n/translate.mjs");
// 2) wrap newly-translated Chinese in the source (idempotent, exact-key-gated)
run("node scripts/i18n/wrap.mjs");

console.error("\ni18n sync complete. Review `git diff`, then `cd web && npx next build` to verify.");
