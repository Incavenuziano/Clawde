-- Migration 001 (DOWN) — derruba todo o schema inicial.
-- Ordem reversa de criação respeitando FKs.

-- FTS5 + triggers (memory)
DROP TRIGGER IF EXISTS memory_fts_update;
DROP TRIGGER IF EXISTS memory_fts_delete;
DROP TRIGGER IF EXISTS memory_fts_insert;
DROP TABLE  IF EXISTS memory_fts;
DROP TABLE  IF EXISTS memory_observations;

-- events + retention_grant
DROP TRIGGER IF EXISTS events_no_delete;
DROP TRIGGER IF EXISTS events_no_update;
DROP TABLE  IF EXISTS _retention_grant;
DROP TABLE  IF EXISTS events;

-- quota
DROP TABLE  IF EXISTS quota_ledger;

-- FTS5 + triggers (messages)
DROP TRIGGER IF EXISTS messages_fts_update;
DROP TRIGGER IF EXISTS messages_fts_delete;
DROP TRIGGER IF EXISTS messages_fts_insert;
DROP TABLE  IF EXISTS messages_fts;
DROP TABLE  IF EXISTS messages;

-- sessions
DROP TABLE  IF EXISTS sessions;

-- task_runs (depende de tasks)
DROP TABLE  IF EXISTS task_runs;

-- tasks + trigger
DROP TRIGGER IF EXISTS tasks_no_update;
DROP TABLE  IF EXISTS tasks;

-- migrations (último; desliga versionamento)
DROP TABLE  IF EXISTS _migrations;
