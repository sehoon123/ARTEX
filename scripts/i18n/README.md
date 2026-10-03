# i18n automation (fork-maintained Korean/English)

Upstream ARTEX ships **Chinese-only**. This fork keeps an automated pipeline so you
don't hand-translate: it finds new Chinese strings, machine-translates them, and
wraps them in `tr()` — safely and repeatably.

## How it works

- `web/src/lib/i18n/{en,ko}.json` — the dictionaries. **The Chinese string is the key.**
  Missing key → UI falls back to the original Chinese (never breaks).
- `tr("中文")` / `tr("删除 {n0} 条", { n0: n })` — looked up at render; language is
  chosen in the sidebar user menu (auto-detects browser language first visit).
- The three scripts below are the whole toolchain. No build-system changes, so the
  app still builds with Turbopack + React Compiler unchanged.

## Everyday use (after pulling upstream)

```bash
git remote add upstream https://github.com/Autumn-27/ARTEX.git   # one-time
git fetch upstream && git merge upstream/main                    # resolve conflicts if any

export ANTHROPIC_API_KEY=...        # or OPENAI_API_KEY — the same key ARTEX uses
cd .. && node scripts/i18n/sync.mjs # translate new strings + wrap them
cd web && npx next build            # verify (exit 0)
git add -A && git commit -m "i18n: sync with upstream"
```

`sync.mjs` = `translate.mjs` (fill dict gaps via LLM) + `wrap.mjs` (wrap in source).

## Individual commands

```bash
node scripts/i18n/extract.mjs              # list Chinese strings missing a translation
node scripts/i18n/translate.mjs            # LLM-fill en.json + ko.json gaps (keeps existing)
node scripts/i18n/translate.mjs ko         # only Korean;  LIMIT=100 caps cost per run
node scripts/i18n/wrap.mjs                 # wrap translated Chinese in tr() (idempotent)
node scripts/i18n/wrap.mjs --check         # CI: fail if any translated string is un-wrapped
```

Provider auto-detect: `ANTHROPIC_API_KEY` → Claude (`I18N_MODEL`, default
`claude-3-5-haiku-latest`); else `OPENAI_API_KEY` → OpenAI (`gpt-4o-mini`),
with `I18N_BASE_URL` for a compatible gateway.

## Safety / design notes

- `wrap.mjs` only wraps a string **already present in `ko.json`**, and only in display
  positions (JSX text, display attrs, `toast`/`alert`/`throw` args, ternary/`||`/`??`
  branches, template literals). So **logic strings** (`.includes("归档不存在")`, regex
  like `/漏洞|资产/`, `startsWith("[模型]")`) are never touched.
- Excluded from wrapping (`WRAP_EXCLUDE` in `extract.mjs`): `lib/status.ts` and
  `navigation/sidebar/sidebar-items.ts` (their Chinese is a key consumed via
  `tr(x.label)` at render) and `config/app-config.ts` (imported by a Server Component).
- Manual edits to `en.json`/`ko.json` are preserved — `translate.mjs` only fills gaps.
  To re-translate one string, delete its key and re-run.
- Placeholders `{n0} {n1} …` and `{args}` are preserved by the translator prompt.

## Keeping upstream merges clean

Only two kinds of local change exist: the small `lib/i18n/` module + the `tr()` wraps.
If a merge conflicts on a wrapped line, take **upstream's** version of that line and
re-run `node scripts/i18n/wrap.mjs` — it will re-wrap deterministically.
