# Korean/English localization maintenance

Chinese source strings are dictionary keys in `web/src/lib/i18n/{en,ko}.json`.
The browser locale is selected in the sidebar menu and saved as `artex_locale`.
Switching asks for confirmation, then reloads to refresh module-level label maps;
cancelling leaves both locale and storage unchanged. The provider waits
for client mount before showing translated content, so static HTML and initial
hydration agree; it also updates `<html lang>`. Blocked browser storage produces a
visible error instead of reloading into the wrong language.

## After an upstream merge

Run from the **repository root** (after `cd ARTEX`):

```bash
git fetch upstream
# Merge upstream separately, resolving conflicts before running the codemod.
export OPENAI_API_KEY=...             # or ANTHROPIC_API_KEY
node scripts/i18n/sync.mjs
cd web
npm run i18n:test
npm run i18n:check
npm run build:static                  # the actual binary's frontend build
# Review git diff before committing or publishing.
```

The scripts resolve their paths relative to themselves, not the shell directory.
Node 22+ and the existing `web/node_modules/typescript` are required (`cd web && npm ci`).
No additional package or `rg` executable is required.

## Commands

- `extract.mjs`: list keys missing from **either** dictionary, including already
  wrapped calls. Uses TypeScript's parser, not line-based regexes.
- `translate.mjs [en] [ko]`: fill only missing entries; preserve manual translations.
- `wrap.mjs`: apply validated display edits; `--check` performs the same inventory
  and fails on missing dictionaries, pending wraps, or unsupported client boundaries.
- `sync.mjs`: translate, then wrap. Any failed stage returns nonzero.
- `test.mjs`: isolated regression tests, including a local HTTP-compatible provider.
  Tests never use real API credentials, modify production dictionaries, or run tools
  displayed by the application.

Provider selection: `ANTHROPIC_API_KEY` first (default model
`claude-haiku-4-5-20251001`); otherwise `OPENAI_API_KEY` (default `gpt-4o-mini`).
Override with `I18N_MODEL`; OpenAI-compatible endpoints can use `I18N_BASE_URL`.
`BATCH` is a positive integer (default 40), `LIMIT` a nonnegative per-locale cap,
and `I18N_TIMEOUT_MS` a positive timeout (default 60000). Provider/model availability
must be verified separately with your credentials. The previous Haiku 3.5 default
was [retired on February 19, 2026](https://platform.claude.com/docs/en/about-claude/model-deprecations).

## Safety and scope

- Extraction and wrapping share one AST inventory. Escapes, comments, JSX entities,
  punctuation-only fragments, numeric JSX entities, nested/multiline templates, and directives use
  the installed TypeScript parser. Nested raw display branches in templates are
  reported for manual wrapping before their parent can be changed; nested existing
  `tr()` calls still participate in dictionary checks. Generated template parameters
  preserve native coercion, comment trivia, and local `String` bindings.
- Automatic positions are JSX text; explicit display attributes such as `title`,
  `placeholder`, `aria-label`, `label`, `description`; toast/alert/confirm and
  error/message setter arguments. Conditional/fallback strings are changed only in
  those positions. Object properties such as `label` or `description` are inventoried
  but require manual review: their names alone do not prove display-only semantics.
- Protocol values (`value`, IDs, names, comparisons, arbitrary templates/setters),
  type declarations, comments, and unknown code contexts are not translated blindly.
  The upload marker is deliberately stable across languages.
- Reuses a safe translation import or generates a collision-free alias. It never
  inserts an import before a directive, wraps an existing translated call, or adds
  client-only translation calls to an unreviewed server module.
- `lib/status.ts` and `navigation/sidebar/sidebar-items.ts` remain raw key maps;
  callers translate labels at render. `config/app-config.ts`, mock data, backend
  messages, user content, and generated text are outside this frontend codemod.
- Invalid dictionaries, HTTP/JSON failures, omitted keys, empty values and changed
  placeholder occurrence counts fail explicitly. All API responses are validated
  before saving; each dictionary is replaced by a same-directory atomic rename.
  Source replacements are atomic per file too. A filesystem/process failure between
  renames can still leave a multi-file run incomplete: re-run extraction/check after
  interrupted runs.
- `--check` verifies this AST inventory, **not** every possible rendered string or
  translation quality. Dynamic/indirect text and rich-text sentence grammar still
  require rendering checks and human review.

On merge conflicts, prefer the upstream line and rerun the pipeline only after
reviewing whether that string is display text or a stable protocol value.
