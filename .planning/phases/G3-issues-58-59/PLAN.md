# G3 Execution Plan — Issues #58 and #59

Date: 2026-05-04  
Mode: Controlled remediation (dual-IA, cross-review, guarded merge by operator)

## Objective

Close two production-blocking bugs discovered in manual testing with clean, auditable PR slices:

- #58 `implementer` cannot write files in headless daemon mode
- #59 review pipeline not wired from config in `worker/main.ts`

## Scope Freeze

In scope for this phase:

- Bugfix for #58
- Bugfix for #59

Out of scope for this phase:

- New Telegram features (PR #48)
- Mixed-scope PR resurrection (PR #60)
- Any unrelated refactor

## Ownership and Review Matrix

| Slice | Issue | Implementer | Reviewer | Lane |
|---|---|---|---|---|
| S1 | #58 | Codex | Claude | **Guarded** (permission bypass — operator decides merge) |
| S2 | #59 | Claude | Codex | Autonomous (runtime wiring) |

Rules:

1. Implementer never approves own PR.
2. Reviewer runs local CI before approval.
3. Operator remains merge gate.

## Branch Plan

- S1: `fix/issue-58-headless-write`
- S2: `fix/issue-59-review-wiring-clean`

**Execution: serial (not parallel).**
S2 must branch from `main` only after S1 is merged.
Reason: both slices touch `src/worker/runner.ts`; parallel merge would cause conflicts.

If S2 must run in parallel due to urgency: S2 must explicitly rebase on top of S1's
branch before opening its PR.

PR #60 is treated as reference only (do not merge as-is). PR #60 contains a prior
mixed-scope fix attempt combining #58 and #59 in the same PR. Do not merge — use
only as technical reference when implementing the separate slices.

## Slice S1 — Issue #58

### Problem

Headless worker runs with default interactive permission behavior, causing write-capable agents to report success text while filesystem edits are blocked.

### Allowed files

- `src/sdk/types.ts`
- `src/sdk/client.ts`
- `src/worker/runner.ts`
- `tests/unit/sdk/*`
- `tests/integration/worker*`

### Acceptance Criteria

1. Headless run with write-capable agent (`allowedTools` contains Edit, Write or Bash)
   can create/modify a file in the ephemeral workspace. Test: create a mock task with a
   write-capable agent, verify the file exists on disk after the run.
2. Agent with `sandboxLevel >= 2` does NOT receive `allowDangerouslySkipPermissions=true`,
   even if Write is in `allowedTools`. **Mandatory unit test for this boundary.**
3. Agent without Write/Edit/Bash in `allowedTools` does NOT receive the bypass.
4. `allowDangerouslySkipPermissions` is set ONLY inside `runAgentWithLedger` (runner.ts),
   not in `RealAgentClient` itself nor in CLI call paths (reflect, smoke-test).
5. Regression test: before fix, a task with a write-capable agent returns succeeded but
   file does not exist; after fix, file exists. Automated test, not only manual smoke.

## Slice S2 — Issue #59

### Problem

`review_required=true` in config has no effect because `worker/main.ts` does not wire `deps.review` into `runProcessLoop`.

### Allowed files

- `src/worker/main.ts`
- `src/worker/runner.ts` (only if wiring contract requires minor adapter)
- `src/review/*` (only if key mapping/contract fix is needed)
- `src/config/schema.ts` (only if ReviewConfigSchema field names need correction)
- `config/clawde.toml.example` (required — fix wrong TOML key `enabled` → `review_required`)
- `tests/integration/review*`
- `tests/integration/worker*`

### Acceptance Criteria

1. With `review_required=true`, worker path executes review pipeline stages.
2. Expected review events are present (`review.implementer.*`, reviewer verdict events).
3. `review_required=false` preserves legacy non-review path.
4. `config/clawde.toml.example` uses `review_required = true/false` (not `enabled`).
   Test: `clawde config validate config/clawde.toml.example` returns exit 0.
5. Integration tests use a mock for `deps.review.run` — they do not invoke the real SDK.

## Execution Protocol (GSD + GitHub)

For each slice:

1. Plan confirmation:
   - Plan already approved in this document. Do not re-plan in G2.
   - Confirm with operator that this PLAN.md is in approved state before executing.
2. Implementation:
   - `$gsd-execute-phase G3 --wave 1 --interactive`
3. Local validation (mandatory):
   - `bun run typecheck`
   - `bun run lint`
   - `bun run ci`
   - `bun run build:worker`
4. Open PR with:
   - issue link (`Closes #58` or `Closes #59`)
   - exact acceptance checklist
   - CI result summary
5. Cross-review by the other IA (no self-review).
6. Operator merge decision.

## CI and Quality Gates

A PR is review-ready only when all are true:

1. CI green locally (`bun run ci`)
2. `bun run build:worker` exits 0 (verifies worker bundle compiles)
3. Diff scoped to allowed files, OR files outside scope listed with explicit justification
   accepted by reviewer (not by implementer)
4. At least one **automated** test proving bug behavior is fixed (not only manual smoke)
5. No mixed feature work in the same PR

## Communication Protocol

Revision cycle: maximum 2 rounds of request-changes per PR.
If still blocked after 2 rounds, escalate to operator before continuing.

Status messages to operator:

- Start: `S1 (#58) in-progress on fix/issue-58-headless-write.`
- Ready review: `S1 (#58) PR #N pronto pra review por Claude.`
- Review done: `S1 (#58) approved.`
- Merge done: `S1 (#58) merged.`

(Same pattern for S2 with roles swapped.)

## Close-Out Criteria for This Phase

Phase is complete when:

1. #58 and #59 are closed by clean PRs.
2. PR #60 is closed or explicitly marked superseded.
3. `STATUS.md` reflects merged state.
4. Remaining open work is only feature/docs backlog.
