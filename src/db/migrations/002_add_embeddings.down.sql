-- Migration 002 (DOWN) — remove coluna embedding.
-- SQLite só suporta DROP COLUMN desde 3.35; PRAGMA do worker garante ≥ 3.51.

ALTER TABLE memory_observations DROP COLUMN embedding;
