# Korean/English localization maintenance

[한국어: 업스트림 업데이트 절차](README.ko.md)

UI source strings and stable `builtin.tool.*.summary` IDs are dictionary keys in
`web/src/lib/i18n/{en,ko}.json`.
The browser locale is selected in the sidebar menu and saved as `artex_locale`.
Switching asks for confirmation, then reloads to refresh module-level label maps;
cancelling leaves both locale and storage unchanged. The provider waits
for client mount before showing translated content, so static HTML and initial
hydration agree; it also updates `<html lang>`. Blocked browser storage produces a
visible error instead of reloading into the wrong language.

## After an upstream merge

Run from the **repository root** (after `cd ARTEX`):

```bash
git status --short                   # preserve local changes first
# Once after cloning: git remote add upstream https://github.com/Autumn-27/ARTEX.git
git fetch upstream
git switch -c upstream-update-$(date +%Y%m%d-%H%M)
git merge upstream/main              # explicit user operation, never automated
# Resolve conflicts, preserving new logic AND existing tr() calls.
cd web
npm ci
npm run i18n:check
# ONLY after reviewing reported backend display-default changes:
# npm run i18n:catalog                # refreshes reviewed snapshots, NOT translations
export OPENAI_API_KEY=...             # or ANTHROPIC_API_KEY
npm run i18n:sync
npm run i18n:verify                   # tests + checks + actual binary frontend build
# Inspect populated EN/KO screens and git diff before committing/publishing.
```

The scripts resolve their paths relative to themselves, not the shell directory.
Node 22+ and the existing `web/node_modules/typescript` are required (`cd web && npm ci`).
No additional package or `rg` executable is required. Go (the version required by
`go.mod`) is also needed for the source-only built-in metadata check.

Without a working provider, use `npm run i18n:extract`, fill missing entries in
both dictionaries manually, then `npm run i18n:wrap` and `npm run i18n:verify`.
The fork's `localization-check` workflow runs verification on pushes/PRs; it does
not translate, merge upstream or publish anything.

## Commands

- `extract.mjs`: list keys missing from **either** dictionary, including already
  wrapped calls. Uses TypeScript's parser, not line-based regexes.
- `translate.mjs [en] [ko]`: fill only missing entries; preserve manual translations.
- `wrap.mjs`: apply validated display edits; `--check` performs the same inventory
  and fails on missing dictionaries, pending wraps, or unsupported client boundaries.
- `sync.mjs`: translate, then wrap. Any failed stage returns nonzero.
- `test.mjs`: isolated regression tests, including a local HTTP-compatible provider
  and populated built-in display components. Tests never use real API credentials,
  modify production dictionaries, or run tools displayed by the application.
- `catalog-check.mjs` (included in `npm run i18n:check`): checks exact-source
  snapshots, tool summaries, builtin Agents/variable help and reserved rule/asset
  labels in both dictionaries. `--update` (`npm run i18n:catalog`) explicitly refreshes
  reviewed snapshots; it can still fail on missing translations after writing.
  Review existing summaries for changed meaning and author short summaries for new
  `builtin.tool.<key>.summary` IDs in BOTH dictionaries. It never edits backend data.
- `catalog.go`: uses Go's parser to inventory metadata from the known tool factories
  and `actool.Spec` literals. It does not import or execute ARTEX or its handlers.
  The metadata check fails when known source defaults differ from
  `web/src/lib/builtin-tool-descriptions.json` or `builtin-metadata.json`. Summary IDs
  are derived from exact-known tool keys, so adding a tool does not require another
  label map. Agent positional declarations, global variable descriptions and reserved
  name literals are also inventoried. Unsupported changed declarations fail; entirely
  new factory/declaration/name-expression styles still require manual review.

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
- `--check` verifies this frontend AST inventory, **not** every possible rendered
  string or translation quality. The separate built-in metadata check covers known
  source factories only. Dynamic/indirect text and rich-text sentence grammar still
  require populated rendering checks and human review.
- Built-in tool cards show localized **summaries**, not rewritten model instructions.
  Only exact known defaults match; custom/edited/unknown descriptions stay original.
  Built-in Agent labels are display-only; asset notes require the exact known
  kind/pattern/note tuple plus builtin provenance. Command-rule names remain original
  (including Chinese reserved names): their API has no builtin provenance, and users
  can reuse a reserved name. Rule patterns, IDs, actions, prompts, schema/defaults and save payloads stay raw;
  Chinese may intentionally remain in editable originals or external/user content.

On merge conflicts, retain upstream logic AND display translation calls after
reviewing semantics. Never blindly accept all of one side.

## Installing the localized fork

Upstream Docker images/releases do **not** contain this fork's patches, and the
application's upstream self-updater can replace a localized build with an upstream
one. Build from the verified fork instead: Actions → `build-binary` → Run workflow
(`linux/amd64` for Linux x86-64; leave tag blank for artifacts without a release).
Download `artex-binaries`, verify `SHA256SUMS`, stop the service and back up/replace
only the binary, not configuration or database/data directories. The workflow embeds
`web/out`; rebuilding the frontend alone does not update an existing binary.
PostgreSQL is still required. Actual artifact execution, database connectivity and
WSL1/PTY compatibility must be validated independently of UI checks.
