-- 005-cutover-qwen3-embeddings.sql
-- Cuts over from nomic-embed-text to qwen3-embedding:4b by swapping embedding columns.
--
-- WARNING: This migration is destructive. It drops the nomic embedding column.
-- 8,437 entries with nomic embeddings but no searchable_text will lose their vector data.
-- Only run after verifying qwen3 A/B evaluation results are satisfactory.
-- Requires reembed-qwen3.ts to have been run first.

BEGIN;

-- Drop the nomic embedding column
ALTER TABLE ai_memory.journal_entries
    DROP COLUMN embedding;

-- Rename qwen3 column to the standard name
ALTER TABLE ai_memory.journal_entries
    RENAME COLUMN embedding_qwen3 TO embedding;

-- Rename the HNSW index (instant metadata operation, no rebuild)
ALTER INDEX ai_memory.idx_journal_entries_embedding_qwen3_hnsw
    RENAME TO idx_journal_entries_embedding_hnsw;

COMMIT;
