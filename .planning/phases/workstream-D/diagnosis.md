# Workstream D — Diagnosis

Date: 2026-05-04
Branch: `task/auto-sandbox-fixes`
Lane: guarded
Issues: `#49`, `#51`

## Summary

Workstream D is not a single clean bugfix. It is two different classes of problem:

1. `#51` is a real, present bug on `origin/main` and is low-risk to fix.
2. `#49` is **not just missing code**. There is evidence of a prior implementation
   on remote branch `origin/feat/sandbox-bwrap-wiring-f6b` (`8974064`), but that
   implementation is **not present on `origin/main`**. So the current problem is
   partly runtime security and partly branch/reconciliation drift.

Because this is a guarded lane, we should not silently re-implement `#49` from
scratch without acknowledging that an existing unmerged solution already exists
and may conflict with newer runtime work.

## 1. `#49` scope — where bwrap is, and where it is not

### Present on `origin/main`

- `src/sandbox/matrix.ts` materializes level 1/2/3 configs and returns:
  - `runDirect=true` for level 1
  - `bwrap` config for level 2/3
- `src/sandbox/bwrap.ts` and tests exist
- `tests/integration/sandbox-bwrap.test.ts` proves the lower-level bwrap helpers
  work in isolation

### Missing on `origin/main`

- there is **no** `src/sandbox/wrapper.ts`
- there is **no** worker-side invocation path that calls `runBwrapped()`
- `src/worker/runner.ts` only uses hook-level enforcement through
  `makePreToolUseHandler(...)`
- `src/worker/runner.ts` does **not** call `materializeSandbox(...)`
- `pathToClaudeCodeExecutable` / wrapper injection for bwrap is absent on
  `origin/main`

### Conclusion

On `origin/main`, OS-level bwrap enforcement is **not wired** into task
execution. Sandbox level 2/3 behavior currently exists as support code and
tests, but the worker does not actually route Claude through it.

## 2. Existing prior fix branch for `#49`

Remote history shows:

- branch: `origin/feat/sandbox-bwrap-wiring-f6b`
- commit: `897406448d0a78f96812f3e1d2ce855779b0625c`

That branch adds:

- `src/sandbox/wrapper.ts`
- worker-side wrapper creation
- SDK executable override wiring
- cleanup of temp wrapper

It appears to implement a filesystem-focused bwrap wrapper for level >= 2
agents while intentionally leaving full network isolation deferred.

### Important mismatch

That branch is **not merged into `origin/main`**, while issue `#49` contains a
comment saying the gap was closed.

So the real state is:

- issue thread says "implemented"
- default branch code says "not implemented"

This must be treated as branch drift, not as a mere missing patch.

## 3. `#49` decision

### Decision

Do **not** re-implement `#49` from scratch on this guarded branch yet.

Instead:

1. treat `origin/feat/sandbox-bwrap-wiring-f6b` as the canonical prior attempt
2. reconcile it against current runtime expectations before merge
3. specifically re-check naming/typing drift against newer SDK executable-path
   work

### Why

- Workstream A introduced newer executable-path wiring on branch
  `task/auto-runtime-sdk-resolution`
- the old F6B branch used a slightly different runtime shape
- blindly duplicating it here risks:
  - duplicate wrapper logic
  - divergent option names in SDK plumbing
  - security claims that differ from actual code paths

### Operational recommendation

For `#49`, the next safe move is:

- rebase/cherry-pick/reconcile `8974064` **after** Workstream A lands, or
- manually port that branch into this guarded branch with explicit review

Until then, `#49` should remain open or be referenced as partially addressed,
not silently closed again.

## 4. `#51` scope and root cause

Agent configs currently include:

- `.claude/agents/implementer/sandbox.toml`
- `.claude/agents/verifier/sandbox.toml`

Both have:

```toml
level = 1
allowed_writes = ["/workspace"]
```

But on level 1:

- there is no bwrap mount providing `/workspace`
- worker-level path checks run in the host/worktree path space
- ephemeral workspaces live under real host paths like `/tmp/clawde-*`

Hook-level enforcement in `src/hooks/handlers.ts` does:

- if `allowed_writes.length > 0`
- and path is not allowed
- block `Edit`/`Write`

So for level 1 agents, `allowed_writes = ["/workspace"]` is stale and actively
wrong. It encodes a sandbox path that only makes sense once a wrapper-mounted
workspace exists.

## 5. `#51` decision

### Decision

Apply **Option A** for the immediate guarded fix:

- remove hardcoded `allowed_writes = ["/workspace"]` from level 1 agents that
  rely on host-path workspaces
- replace with `allowed_writes = []`
- document explicitly that path-based write allowlisting is only meaningful once
  the workspace is mounted into a sandbox path (level 2+)

### Why this is the safest immediate fix

- smallest scope
- no runtime code changes required
- aligns config with actual level 1 behavior
- unblocks implementer/verifier on real host workspaces

### Why not Option B/C now

- Option B (`preToolHandler` path remapping) introduces runtime logic coupling
  between host paths and sandbox virtual paths
- Option C (dynamic allowlist injection per task run) adds more moving parts and
  still depends on knowing whether the active path space is host or sandboxed

Those approaches may be worth revisiting once `#49` is truly merged and the
runtime path model is stable.

## 6. Concrete execution decision for Workstream D

### Safe next step

Proceed with:

- config-only fix for `#51`
- tests proving level 1 agents are no longer blocked by stale `/workspace`
  assumptions

### Guardrail for `#49`

Do not close `#49` from this branch unless:

- the existing F6B implementation is reconciled into the branch, and
- tests prove the worker actually routes Claude through bwrap for level >= 2

Otherwise:

- reference `#49`
- keep it open
- document that the current D branch only fixes `#51` and records `#49`
  reconciliation status

## 7. Acceptance consequences

If we follow this diagnosis:

- `#51` can be fixed now
- `#49` becomes either:
  - follow-up guarded merge from `feat/sandbox-bwrap-wiring-f6b`, or
  - explicit non-closure with documented branch drift

That is the most honest and safest path from the repo state currently visible on
`origin/main`.
