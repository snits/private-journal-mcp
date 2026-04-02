-- 004-rename-embedding-column.sql
-- Renames embedding_768d to embedding on journal_entries, removing the
-- dimension-specific suffix so future model changes don't require column renames.
--
-- Only needed for databases that applied the original schema files (001, 002, 003)
-- before the column rename. Fresh databases using the updated schema files already
-- have the correct column name and do not need this migration.

BEGIN;

-- Drop the legacy bytea embedding column (dead code, unused by application)
ALTER TABLE ai_memory.journal_entries
    DROP COLUMN IF EXISTS embedding;

-- Rename the pgvector column
ALTER TABLE ai_memory.journal_entries
    RENAME COLUMN embedding_768d TO embedding;

-- Rename the HNSW index (instant metadata operation, no rebuild)
ALTER INDEX ai_memory.idx_journal_entries_embedding_768d_hnsw
    RENAME TO idx_journal_entries_embedding_hnsw;

-- Rename on distillations table too (created by 003 with embedding_768d on older databases)
ALTER TABLE ai_memory.distillations
    RENAME COLUMN embedding_768d TO embedding;

ALTER INDEX ai_memory.idx_distillations_embedding_768d_hnsw
    RENAME TO idx_distillations_embedding_hnsw;

COMMIT;
