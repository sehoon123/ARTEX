# HXB-inspired ARTEX v2 architecture plan

> Status: design only — no HXB-AI runtime or offensive corpus has been imported.
>
> ARTEX base: `3ce884060268d5670e2d3a0429beb24b91380fd2`
>
> HXB-AI reference: [`inwpu/hxbai`](https://github.com/inwpu/hxbai) commit
> `6cf8eef60a7e8f3152e4442ebf219e3848c7ce07`, tree
> `78075780dc586da59db446a1cb2abdc1ac5256f3`

## 1. Decision

The integration is feasible, but it should be a **native conceptual port**, not a
repository merge or a nested HXB-AI runtime.

The recommended ARTEX v2 keeps ARTEX's current Go/PostgreSQL/Next.js stack and its
canonical task, graph, asset, traffic, evidence, finding, approval, and provider
models. It adds five durable control-plane capabilities inspired by HXB-AI:

1. evidence-backed claims and deterministic verification gates;
2. a read-only operational blackboard projected from canonical ARTEX data;
3. persistent progress/budget governance and stop-loss decisions;
4. optional portfolio scheduling with reversible bench/reactivate decisions;
5. reviewed, scoped knowledge/playbook retrieval with negative fingerprints.

HXB-AI is MIT licensed (`Copyright (c) 2026 inwpu`). ARTEX is AGPL-3.0. A combined
work can normally use MIT portions under AGPL, but copied or substantially adapted
material must retain the full MIT notice and have traceable provenance. This is a
technical compatibility assessment, not legal advice.

## 2. What must not be imported

The following HXB-AI parts are deliberately excluded from the ARTEX production
runtime:

- `ccrunner.py` and nested Claude Code execution with skipped permissions;
- the Kali/root Docker image, benchmark VPN/gateway/DNS pinning, TSec submission
  drivers, and mutable tool-download chain;
- regex shell/network hooks as a security boundary;
- plaintext cross-task credential pooling;
- process-local JSON/Markdown state as an authoritative store;
- the bundled exploit playbooks, default-password material, OOB helpers, and
  knowledge-card corpus until each item's provenance, license, and safety are
  reviewed;
- automatic replay of captured commands;
- an independent second task/workspace lifecycle alongside ARTEX.

The existing local `/home/sehun/Work/hxbai-webui` prototype is also **not** a
vendor source. Its nested checkout has the same upstream base commit but contains
uncommitted local modifications and additions. Useful concepts may be independently
reimplemented after comparison with current ARTEX contracts; files must not be
copied from that dirty worktree.

## 3. Reuse matrix

| HXB-AI concept | ARTEX decision | Reason and target form |
| --- | --- | --- |
| Blackboard | Reimplement | Read-only projection over ARTEX facts/assets/evidence/claims; candidate extraction never confirms truth |
| Verification | Reimplement, adapt gate order | Immutable claim/run/gate records; deterministic grounding and controls are authoritative, while independent model review is veto-only |
| Stop-loss | Reimplement | Persistent typed budget ledger and `continue/throttle/bench/stop/require_approval` decisions |
| Fleet scheduler | Reimplement later | Durable optional portfolio admission above the existing scheduler; first-success attempts only in isolated/idempotent runs |
| Keepalive | Reimplement only if needed | Fenced resource leases with CAS, expiry, owner, cleanup, and observable failure |
| Structured handoff | Adapt concept | Immutable compact handoff with achieved primitives, disproved paths, next action, and typed evidence refs |
| Run learning | Reimplement | Portfolio-scoped memory with expiry, provenance, redaction, and secret references; no credential values |
| Knowledge recall | Reimplement; adapt lexical baseline | Versioned reviewed entries, fingerprint/anti-fingerprint scoring, explanation and feedback |
| Playbook routing | Reimplement | Declarative versioned steps selected as hypotheses; never grants scope or execution authority |
| Family rotation | Adapt heuristic | Diversity/saturation calculated from structured tactic outcomes, not command-string regex counts |
| Event envelope | Adapt concept | Transactional outbox and durable event IDs/aggregate sequence; no plaintext JSONL authority |
| Long-task guard | Optional UX lint only | Warnings for likely blocking commands; not an enforcement layer |
| Bash/WebSearch guards | Reject implementation | Replace with fail-closed centralized policy plus OS/network enforcement |
| Task prompt | Reject format | Use typed, size-bounded, sanitized prompt sections and opaque references |
| HXB-AI runner/runtime | Reject | Keep ARTEX provider/harness and introduce isolated attempt contracts instead |

No component is approved for unqualified verbatim copying.

## 4. Target architecture

```text
                         ┌──────────────────────────────┐
                         │ Existing ARTEX control plane │
                         │ tasks / goals / intents      │
                         │ assets / traffic / evidence  │
                         │ findings / approvals / LLM   │
                         └──────────────┬───────────────┘
                                        │ canonical writes
                     ┌──────────────────▼──────────────────┐
                     │ Versioned domain event + evidence ref│
                     │ transactional outbox / redaction     │
                     └──────┬───────────┬───────────┬──────┘
                            │           │           │
                 ┌──────────▼───┐ ┌────▼──────┐ ┌──▼────────────┐
                 │ Blackboard   │ │ Claims &  │ │ Usage/progress │
                 │ projector    │ │ verifier  │ │ ledger         │
                 └──────┬───────┘ └────┬──────┘ └──┬────────────┘
                        │              │            │
                        │         verified/rejected │
                        │              │       ┌────▼────────────┐
                        │              │       │ Budget governor │
                        │              │       └────┬────────────┘
                        │              │            │ decisions
                  ┌─────▼──────────────▼────────────▼──────┐
                  │ Optional portfolio scheduler            │
                  │ admit / bench / reactivate / complete    │
                  └────────────────┬─────────────────────────┘
                                   │ selected hypotheses only
                         ┌─────────▼──────────┐
                         │ Reviewed knowledge │
                         │ and playbooks      │
                         └────────────────────┘

Every execution path → mandatory policy/approval → isolated runner → scoped egress
```

### Architectural invariants

- ARTEX's existing intent producers (seed/bootstrap, Planner, MainAgent, chat
  fallback, and finding follow-up) remain canonical and must converge on one typed,
  validated intent-submission service. Portfolio, knowledge, blackboard, verifier,
  and UI code never author executable intents directly.
- A blackboard entry, confidence score, knowledge match, or playbook step is not an
  authorization decision.
- A finding status and a verification verdict are separate state machines.
- An errored or budget-exhausted intent is not automatically a semantic dead end.
- Existing task status remains canonical; portfolio scheduling state is orthogonal.
- Existing absolute task timeout remains distinct from active-time/token/session
  budgets.
- No positive verdict can be produced only by an LLM.
- Evidence replay goes through the same scope, approval, sandbox, and egress policy
  as the original action.
- Secrets are represented by opaque `secret_ref`; values never enter events,
  prompts, handoffs, search indexes, or cross-task memory.
- REST snapshots are authoritative. Events are at-least-once invalidations and are
  deduplicated by event ID plus aggregate sequence.

## 5. Core algorithms

### 5.1 Observation → claim → verified fact

HXB-AI immediately turns regex matches into facts and can satisfy a stage when a
matching fact kind exists. ARTEX v2 must use a stricter pipeline:

```text
tool/evidence output
  → bounded typed candidate extractor
  → observation candidate (untrusted)
  → claim draft + evidence references
  → deterministic verification gates
  → verified/rejected/inconclusive claim
  → existing finding/goal/asset adapter
```

Candidate identity should include normalized type, value, task, asset scope, source
artifact digest, and extractor version. Conflicting observations are retained; a
higher score must not overwrite prior provenance.

### 5.2 Three-gate verification

The initial gate order is inspired by HXB-AI but uses stronger ARTEX semantics:

1. **Grounding** — evidence exists, digest matches, value occurs in an allowed
   evidence region, and is not model narration/self-echo/static source bait.
2. **Negative control** — an explicit baseline/control/retest result rules out the
   expected benign explanation. Vulnerability-class-specific deterministic oracles
   are versioned.
3. **Independent review** — a separate reviewer receives only sanitized claim data
   and minimal evidence windows. It may reject or explain uncertainty but cannot
   override a failed deterministic gate.

The initial policy has the following truth table:

| Grounding | Negative control | Required independent review | Verdict |
| --- | --- | --- | --- |
| `fail` | any | any | `rejected` |
| `pass` | `fail` | any | `rejected` |
| `pass` | `pass` | `reject` | `rejected` |
| `pass` | `pass` | `pass` | `verified` |
| `missing/error` | any | any | `inconclusive` |
| `pass` | `missing/error` | any | `inconclusive` |
| `pass` | `pass` | `missing/error` | `inconclusive` |

The first release supports only the required-review mode shown above. Model review
is veto-only: its `pass` never establishes truth, while `reject` can prevent a false
positive and absence remains `inconclusive`. Any future advisory/optional mode needs
a new stored policy version, truth table, migration and UI state; a policy cannot be
relaxed after seeing a result. No review or override can turn a deterministic `fail`
or `error` into `verified`.

Override and rerun require an authenticated reason, expected revision, and audit
record. An override is a separate disposition (`accepted_risk`, `false_rejection`,
or `manual_followup`), never a synthesized `verified` verdict, and never mutates
gate history. Promotion creates or links an existing ARTEX finding; it does not
create a parallel finding system.

Existing findings, graph facts, and reports migrate as `legacy_unassessed`, not
`verified`. A migration may attach recoverable provenance and schedule a new
verification run, but it must not synthesize gate passes from old prose. New facts
without claim/evidence provenance remain observations until assessed.

### 5.3 Material-progress classifier

Stop-loss must not count raw commands or arbitrary regex facts. A versioned
classifier awards material progress only for events such as:

- newly verified claim or reproduced primitive;
- goal advancement accepted by canonical goal logic;
- new scoped asset/service with evidence;
- new negative result that closes a distinct hypothesis;
- new usable handoff with a concrete next action and evidence refs.

Duplicate events, model narration, unchanged scans, and repeated command families do
not count.

### 5.4 Persistent budget governor

Per-task policy dimensions:

- wall time and active execution time;
- model tokens/cost;
- session/attempt count;
- consecutive no-progress sessions;
- unreachable probes;
- repeated tactic/family saturation;
- risk/capability budget.

The governor appends usage and decision events, then projects:

```text
health: healthy | warning | exhausted
decision: continue | throttle | bench | stop | require_approval
```

`bench` is reversible portfolio state; `stop` is terminal only for the governing
policy version. A verified near-completion primitive may change thresholds but may
not bypass hard scope/risk limits.

### 5.5 Portfolio scheduler

The portfolio layer groups existing ARTEX tasks and supplies a versioned ranking to
ARTEX's existing single admission path. It does not add a second runnable queue,
replace the trigger scheduler, or bypass the worker concurrency limit.

Concretely, `admitTask`/`admitTaskWhen` remain the only new/resume/rerun/follow-up
admission entry, and `reconcileConcurrency` remains the only queued-work reconciler.
A feature-flagged policy hook may choose among already eligible queued tasks; when
disabled, invalid, or unavailable it preserves the current FIFO behavior. Only the
existing admission service writes canonical task/run state. Portfolio transitions
record policy intent and explanation, then call that service with an expected
revision rather than starting a task themselves.

A first implementation should use a deterministic score with explainable terms:

```text
score = configured_priority
      + starvation_bonus
      + near_completion_bonus
      + recent_material_progress
      + expiring_resource_bonus
      - predicted_cost
      - policy_risk
      - repeated_dead_end_penalty
```

States:

```text
eligible → admitted → running → complete
    │          │          │
    └→ benched ←───────────┘
    └→ blocked / exhausted
```

Transitions are persisted with reason codes. Benching a queued task calls the
canonical dequeue/pause operation. Benching a running task requests the canonical
pause/cancel path and becomes effective only after the run and descendants are
confirmed stopped; failure leaves an explicit `bench_pending`/blocked condition,
not a false `benched` state. Reactivation always returns through `admitTask` with an
expected revision.

Best-of-N is off by default and is allowed only when attempts have isolated
workspaces, independent budgets, an idempotent/read-only capability set,
cancellation that kills descendants, and no shared mutable target state.

### 5.6 Knowledge retrieval

The first safe version is lexical and explainable:

- exact/distinctive fingerprint match receives a high weight;
- general query/fact token overlap receives a lower weight;
- any anti-fingerprint match vetoes the candidate;
- task category and preconditions filter before ranking;
- retrieval returns a hypothesis and explanation, never an action;
- feedback records useful/not-useful/wrong-context without silently modifying the
  reviewed entry.

Entries have `draft|published|deprecated|quarantined` lifecycle and
`hypothesis|observed|reproduced` evidence level. Publication requires provenance,
redaction, content safety review, and human/policy approval.

### 5.7 Structured handoff

An immutable handoff stores:

- achieved primitives;
- disproved approaches with reason;
- exact next action as a typed proposal, not executable text;
- delta since the previous handoff;
- evidence/artifact/claim/asset references;
- source `explicit|derived`, integrity/degraded reason, producer/version.

It never embeds a full transcript, raw credential, or arbitrary target text in a
higher-trust system instruction.

## 6. Backend packages and persistence

Suggested additive Go packages:

```text
control/event       versioned domain events + transactional outbox
control/blackboard  read-only projection
control/claim       claims, evidence binding and lifecycle
control/verify      deterministic gate registry and run coordinator
control/progress    material-progress classifier
control/budget      usage ledger, policy and governor
control/portfolio   admission/bench/reactivate policy
control/handoff     immutable structured handoffs
knowledge           reviewed entries, revisions, retrieval and feedback
playbook            versioned declarative registry and selector
runtimepolicy       isolation attestation, capability and egress policy
```

Proposed tables/resources:

- `domain_events`, `event_outbox`, `evidence_refs`;
- `claims`, `claim_evidence_refs`, `verification_runs`,
  `verification_gate_results`;
- `task_handoffs`;
- `task_budget_policy`, `task_budget_usage_events`, `task_budget_state`,
  `task_budget_decisions`;
- `portfolios`, `portfolio_tasks`, `portfolio_memories`, `resource_leases`;
- `knowledge_entries`, `knowledge_revisions`, `knowledge_retrievals`,
  `knowledge_feedback`;
- `playbooks`, `playbook_versions`, `playbook_runs`;
- `runtime_attestations`, `policy_evaluations`.

The blackboard is a projection, not a writable table. Existing goals, graph facts,
assets, findings, evidence, traffic, retests, approvals, and task states remain the
sources of truth.

Before domain events become an input to policy, every legacy writer for the affected
aggregate must be routed through a shared Go domain service that commits the state
change and outbox event in the same PostgreSQL transaction. A shadow migration uses
snapshot checkpoints plus a replay watermark to avoid write gaps. It does not
backfill unverifiable claims or fabricate historical token/active-time usage; those
fields begin as `unknown_before_rollout` with an explicit measurement start.

Pre-finding claims also require a generic immutable evidence-artifact service. The
current finding-traffic evidence endpoints remain compatibility adapters, but they
cannot serve as the only claim evidence contract. Artifact records own digest,
media type, length, redaction metadata, capture policy, blob locator, retention,
and access scope; claims store only typed evidence references.

Task export/import packages include schema-versioned claims, gate runs, handoffs,
budget events/decisions, task-scoped playbook runs, runtime/policy attestations,
knowledge retrieval/feedback records, event watermarks, and the minimal referenced
artifacts in a checksummed manifest. Task deletion cascades task-owned projections
and references only after a deletion barrier; shared blob GC waits until no live or
archived reference/hold remains. Published knowledge and portfolio memory derived
from a task have separate provenance/retention records, retain a tombstoned source
reference after authorized task deletion, and are never silently deleted or
retained.

### API outline

```text
GET  /api/operations/summary
GET  /api/operations/verification
GET  /api/operations/blackboard
GET  /api/operations/handoffs
GET  /api/portfolios
POST /api/portfolios
GET  /api/portfolios/{id}/tasks
POST /api/portfolios/{id}/control
GET  /api/portfolios/{id}/events

GET  /api/tasks/{id}/blackboard
GET  /api/tasks/{id}/claims
POST /api/tasks/{id}/claims
POST /api/tasks/{id}/claims/{claimID}/verification-runs
POST /api/verification-runs/{runID}/override
POST /api/tasks/{id}/claims/{claimID}/promote
GET  /api/exploration/findings/{id}/verifications
GET  /api/tasks/{id}/handoffs
GET  /api/tasks/{id}/budget
PUT  /api/tasks/{id}/budget
GET  /api/tasks/{id}/budget/events
GET  /api/tasks/{id}/coverage-matrix
GET  /api/evidence/{evidenceID}
GET  /api/evidence/{evidenceID}/preview

GET  /api/knowledge/entries
POST /api/tasks/{id}/knowledge/recall
POST /api/knowledge/retrievals/{id}/feedback
GET  /api/playbooks
GET  /api/tasks/{id}/policy
POST /api/tasks/{id}/policy/simulate
GET  /api/runtime/isolation
```

Mutations use idempotency keys and expected revisions. Large/raw evidence is fetched
lazily through existing authenticated evidence routes, never embedded in portfolio
or SSE summaries.

## 7. UI/UX plan

### Information architecture

Keep `/dashboard` as platform telemetry and `/function/tasks` as the task registry.
Add an **Operations** navigation group:

- `/function/operations` — live command center;
- `/function/operations/portfolio` — scheduling/admission view;
- `/function/operations/verification` — claim/evidence verification queue;
- `/function/operations/blackboard` — cross-task searchable projection;
- `/function/operations/handoffs` — session-boundary timeline;
- `/function/knowledge` — cards, versions and recall explanation;
- `/system/runtime` — actual isolation/policy attestation.

Keep `/system/intercept/approvals` as the only approval queue. New screens deep-link
to existing approvals, findings, assets, sessions, graph, coverage, traffic, and
report views rather than duplicating them.

First make task-detail tabs URL-addressable:

```text
/function/tasks/detail?id=42&tab=sessions
/function/tasks/detail?id=42&tab=graph&node=123
/function/tasks/detail?id=42&tab=findings&finding=77
/function/tasks/detail?id=42&tab=intercept&approval=88
```

### Operations dashboard

Desktop uses a 12-column layout:

1. attention strip: aged approvals, inconclusive verification, budget warning,
   unknown/degraded isolation;
2. capacity meters: admitted/running/queued tasks, busy workers, sandbox leases;
3. ranked task table with scheduling reason and last material signal;
4. budget/security rail;
5. verification aging and recent handoffs.

Mobile order is attention → capacity → task cards → handoffs. No drag handle is
shown until a versioned reorder API exists.

### Verification queue

List/detail split on desktop and card/detail flow on mobile:

- claim and source header;
- lazy, redacted evidence previews;
- three ordered gate rows with state, reason, implementation version, and refs;
- clear `verified|rejected|inconclusive` badge with text and icon, not color alone;
- audited rerun/override actions requiring a reason;
- promotion/link action into the canonical finding page.

Confidence is never displayed as truth. Gate provenance and reasons remain visible.

### Blackboard

Use three semantic columns: **facts / hypotheses / dead ends**. There is no drag and
drop or direct editing. Selecting an entry opens provenance, relations, assets,
conflicts, revisions, claims, and evidence links. Mobile uses one segmented list.
An operational failure or exhausted budget is not rendered as a dead end unless a
canonical negative observation supports it.

### Portfolio

Use filterable table/swimlane views with URL-backed filters. Each task row separates:

- canonical task status;
- portfolio scheduling state and reason;
- current execution/attempt;
- goal/claim/progress summary;
- budget health and next threshold;
- policy/isolation status.

Bulk pause/resume should use existing task operations. Bench/reactivate remains a
separate portfolio action with optimistic revision checks and audit reason.

### Handoffs

Show a task/day grouped vertical timeline containing summary, next action, excluded
paths, delta, integrity state, and deep links. Full transcripts and raw payloads are
not shown in this cross-task view.

### Knowledge

Cards show lifecycle/evidence level, fingerprint/preconditions, anti-fingerprint,
review provenance and version. “Why recalled?” expands a deterministic explanation:
score contributions, matched tokens/facts, exclusions, algorithm version, and the
mandatory **hypothesis, not answer** notice. Accepting a card creates a hypothesis;
it never runs a command.

### Runtime isolation

Display an attestation matrix, not an inferred green badge:

- process/user isolation;
- workspace scope and mount mode;
- environment allowlist;
- target/control egress enforcement;
- capability/approval policy version;
- child cleanup and last attested time.

Missing telemetry is `unknown`. “Docker” alone is not proof of isolation. Current
native host execution should be represented honestly as non-attested until a real
runner exists.

### Common UX states

- skeletons preserve layout;
- a panel error retains stale last-good data with timestamp/retry;
- distinguish true empty, filtered empty, permission denied, and not-yet-enabled;
- cursor pagination for event/verification/knowledge lists;
- 44px mobile targets, visible focus, keyboard actions, `aria-sort`, progress labels,
  reduced-motion support, and text summaries for charts;
- no raw secret, tool input, full evidence, or transcript in search/SSE/list payloads.

## 8. Security prerequisites

The following must land before autonomous replay, best-of attempts, knowledge-driven
execution, or public HXB mode:

1. mandatory fail-closed guard on every agent and policy error path;
2. unprivileged ephemeral per-run isolation with task-scoped, symlink-safe workspace;
3. replacement environment allowlist that excludes application/DB/JWT/model/MCP
   secrets;
4. OS/network-layer deny-by-default target egress checked after DNS and every
   redirect, with separate model/control channels;
5. immutable human approval bound to scope, destination, expanded payload digest,
   capability, rate and time budget for high-impact actions;
6. process-group cancellation and verified descendant cleanup;
7. redacted/encrypted or secret-reference-only persistence with TTL/deletion;
8. prompt-injection tests treating target, MCP, model, evidence, knowledge and
   handoff text as hostile.

Knowledge and playbooks cannot bypass these controls.

## 9. Delivery plan

### Phase S — security foundation (release blocker)

- central mandatory guard and fail-closed policy loading;
- isolated runner contract, env allowlist and task workspace jail;
- target capability/egress policy and attestation;
- credential DTO masking and sensitive storage modes.

### Phase 0 — contracts and provenance

- add this source lock and the future MIT notice/provenance map;
- freeze vocabulary/state machines/event envelope/evidence-ref contract;
- add the generic immutable evidence-artifact service;
- route affected legacy writes through domain services and add an outbox without
  behavior changes;
- define legacy `legacy_unassessed` and `unknown_before_rollout` migration semantics
  plus archive/import/delete ownership;
- feature flags default off.

### Phase 1 — read models

- blackboard projection;
- structured immutable handoffs;
- observation claim drafts;
- URL-addressable task tabs and read-only Operations skeleton.

### Phase 2 — verification

- claims and immutable verification runs;
- grounding and negative-control registries;
- required veto-only independent reviewer;
- finding/goal adapters and verification UI.

### Phase 3 — economics

- usage/progress ledger;
- budget policies and shadow governor;
- compare shadow decisions with existing absolute timeout;
- enforce throttle/bench only after review.

### Phase 4 — portfolio

- portfolio/task membership and scheduling states;
- admission/bench/reactivate with explainable score;
- fenced resource leases if a target provider needs them;
- isolated best-of only after idempotency and cancellation gates pass.

### Phase 5 — knowledge and playbooks

- reviewed entry/revision lifecycle;
- lexical recall plus anti-fingerprint and explanation;
- feedback and controlled promotion from verified claims;
- declarative versioned playbooks as Planner hypotheses.

## 10. Test and release gates

Minimum tests before any enforcement/automation:

- candidate extraction cannot confirm a fact, goal, or finding;
- conflicting observations retain every provenance chain;
- duplicate/replayed events and process restarts are idempotent;
- deterministic gate errors can never produce `verified`;
- LLM absence produces `inconclusive`, not approval;
- self-echo/static bait/target narration do not pass grounding;
- budget decisions survive restart and distinguish bench from terminal stop;
- only versioned material-progress events advance progress;
- first success safely cancels/drains other attempts and kills descendants;
- lease ownership/fencing prevents stale cleanup from touching a new owner;
- knowledge remains a hypothesis and cannot expand scope or authorize tools;
- unknown, encoded, redirected and DNS-rebound egress fails closed;
- env-canary and secret values never appear in prompt/event/handoff/UI/SSE;
- symlink and path-race tests cannot escape the task workspace;
- Go unit/property/fuzz/race tests, frontend i18n/static build, dependency/security
  audits, synthetic localhost/fake-model integration;
- independent security and license review with zero open Critical/High release
  findings;
- signed immutable release artifacts and attestations.

## 11. Fork workflow

Use a feature branch from a clean fork main rather than merging HXB-AI history:

```text
main
└── feature/hxbai-architecture-v2
    ├── docs/source lock and architecture contract
    ├── security foundation
    ├── P0 events/evidence
    ├── P1 blackboard/handoff
    ├── P2 verification
    ├── P3 budget governor
    ├── P4 portfolio
    └── P5 knowledge/playbooks
```

Track HXB-AI only by full source SHA and manually reviewed diffs. Do not rebase or
force-push after a subsystem has entered review; merge updated fork `main` and rerun
review instead. Each adapted destination records source file/blob, exact upstream
SHA, modification date, tests, and applicable MIT notice.

Before publishing an improved fork release, also change self-update, Docker and
release artifact origins so they cannot silently replace fork hardening with an
upstream `Autumn-27` artifact.

## 12. Definition of success

ARTEX v2 succeeds if it gains HXB-AI's evidence discipline, cross-session continuity,
budget control, scheduling efficiency and explainable knowledge reuse **without**
adding a second runtime, losing ARTEX's durable state, weakening authorization, or
turning target-controlled text into ambient host authority.
