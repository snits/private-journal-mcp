-- ABOUTME: Creates performance indexes for journal_entries table
-- ABOUTME: Includes HNSW vector index for fast semantic search and project filtering index

-- Create HNSW index on embedding_768d for fast vector similarity search
-- This index dramatically improves semantic search performance (from ~400ms to ~6ms)
-- Parameters:
--   m=16: Number of bi-directional links per node (balances recall and build time)
--   ef_construction=64: Size of dynamic candidate list during index construction
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_journal_entries_embedding_768d_hnsw
ON ai_memory.journal_entries
USING hnsw (embedding_768d vector_cosine_ops)
WITH (m='16', ef_construction='64');

-- Create partial B-tree index on project column for fast project filtering
-- Partial index only includes rows where project IS NOT NULL
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_journal_entries_project
ON ai_memory.journal_entries(project)
WHERE project IS NOT NULL;

-- Optional: Create indexes on other frequently queried columns
-- Uncomment if needed based on query patterns

-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_journal_entries_user_id
-- ON ai_memory.journal_entries(user_id);

-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_journal_entries_timestamp
-- ON ai_memory.journal_entries(timestamp DESC);

-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_journal_entries_visibility_level
-- ON ai_memory.journal_entries(visibility_level);

-- Verify index creation
DO $$
DECLARE
    hnsw_exists BOOLEAN;
    project_exists BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'ai_memory'
          AND tablename = 'journal_entries'
          AND indexname = 'idx_journal_entries_embedding_768d_hnsw'
    ) INTO hnsw_exists;

    SELECT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'ai_memory'
          AND tablename = 'journal_entries'
          AND indexname = 'idx_journal_entries_project'
    ) INTO project_exists;

    RAISE NOTICE '=== Index Creation Verification ===';
    RAISE NOTICE 'HNSW vector index: %', CASE WHEN hnsw_exists THEN '✓ EXISTS' ELSE '✗ MISSING' END;
    RAISE NOTICE 'Project index: %', CASE WHEN project_exists THEN '✓ EXISTS' ELSE '✗ MISSING' END;

    IF NOT (hnsw_exists AND project_exists) THEN
        RAISE EXCEPTION 'Not all indexes were created successfully';
    END IF;

    RAISE NOTICE 'All indexes created successfully!';
END $$;
