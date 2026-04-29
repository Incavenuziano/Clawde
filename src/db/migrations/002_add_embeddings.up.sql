-- Migration 002 (UP) — adiciona coluna embedding BLOB em memory_observations.
-- ADR 0010: 384 dim × 4 bytes = 1536 bytes por embedding.
-- BLOB nullable: observations sem embedding (provider noop) gravam null.

ALTER TABLE memory_observations ADD COLUMN embedding BLOB;
