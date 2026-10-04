// Translate first; a nonzero translator/check result stops the pipeline.
import { execFileSync } from "node:child_process";
import { ROOT } from "./extract.mjs";

try {
  for (const script of ["translate", "wrap"]) {
    console.error(`\n$ node scripts/i18n/${script}.mjs`);
    execFileSync(process.execPath, [`scripts/i18n/${script}.mjs`], { cwd: ROOT, stdio: "inherit" });
  }
  console.error("\ni18n sync complete. Review git diff, run i18n:test and build:static before committing.");
} catch (error) { console.error("i18n sync failed; source wrapping/completion stopped."); process.exitCode = error.status || 1; }
