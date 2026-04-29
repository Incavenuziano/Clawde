# ADR 0014: Explicit Worker Trigger After Enqueue

- Status: Accepted
- Date: 2026-04-29
- Deciders: Clawde maintainers
- Supersedes: parts of ADR 0002 (trigger strategy)

## Context

`clawde-worker.path` originally observed `%h/.clawde/state.db` mtime as the main
trigger. With SQLite WAL mode, writes frequently land in `state.db-wal`, and
`state.db` mtime may lag checkpoints. This causes missed or delayed worker starts
under normal enqueue traffic.

Polling by timer is robust but increases idle wakeups and latency variance.

## Decision

Receiver now triggers worker explicitly after successful enqueue (`deduped=false`)
by running:

`systemctl --user start clawde-worker.service`

This call is executed in detached mode through `SystemdWorkerTrigger`, injected
into route deps via `WorkerTrigger` interface for testability.

Trigger errors do not fail enqueue responses; they are logged as warnings.

## Fallback

`clawde-worker.path` remains optional fallback, but no longer watches
`state.db`/`state.db-wal`. It now watches an explicit signal file:

`%h/.clawde/run/queue.signal`

The trigger helper touches/appends this file before starting systemd, keeping a
single, explicit signaling path.

## Consequences

Positive:
- Lower enqueue-to-worker latency (immediate start request).
- Deterministic trigger source (receiver write path), independent of WAL
  checkpoint timing.
- Easier testing via `WorkerTrigger` fake in integration tests.

Trade-offs:
- Receiver needs permission to call `systemctl --user start`.
- Trigger start is best-effort; hard failures rely on fallback `.path`.

## Alternatives Considered

1. Keep `.path` on `state.db`: rejected due to WAL checkpoint coupling.
2. Watch `state.db-wal`: rejected as primary due to noisy over-triggering.
3. Timer polling (`OnCalendar=*:*:0/5`): rejected as primary due to latency and
   unnecessary wakeups during idle periods.
