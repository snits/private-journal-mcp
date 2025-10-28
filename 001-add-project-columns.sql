-- ABOUTME: Adds project and project_context columns to support project-aware journal entries
-- ABOUTME: Also adds embedding_768d column for pgvector support

-- Add project column for filtering by project name
ALTER TABLE ai_memory.journal_entries
ADD COLUMN IF NOT EXISTS project VARCHAR(100);

-- Add project_context for storing full git metadata and context
ALTER TABLE ai_memory.journal_entries
ADD COLUMN IF NOT EXISTS project_context JSONB;

-- Add pgvector column for semantic search with HNSW indexing
ALTER TABLE ai_memory.journal_entries
ADD COLUMN IF NOT EXISTS embedding_768d vector(768);

-- Verify additions
DO $$
DECLARE
    project_exists BOOLEAN;
    project_context_exists BOOLEAN;
    embedding_768d_exists BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'ai_memory'
          AND table_name = 'journal_entries'
          AND column_name = 'project'
    ) INTO project_exists;

    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'ai_memory'
          AND table_name = 'journal_entries'
          AND column_name = 'project_context'
    ) INTO project_context_exists;

    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'ai_memory'
          AND table_name = 'journal_entries'
          AND column_name = 'embedding_768d'
    ) INTO embedding_768d_exists;

    RAISE NOTICE '=== Column Addition Verification ===';
    RAISE NOTICE 'project column: %', CASE WHEN project_exists THEN '✓ EXISTS' ELSE '✗ MISSING' END;
    RAISE NOTICE 'project_context column: %', CASE WHEN project_context_exists THEN '✓ EXISTS' ELSE '✗ MISSING' END;
    RAISE NOTICE 'embedding_768d column: %', CASE WHEN embedding_768d_exists THEN '✓ EXISTS' ELSE '✗ MISSING' END;

    IF NOT (project_exists AND project_context_exists AND embedding_768d_exists) THEN
        RAISE EXCEPTION 'Not all columns were created successfully';
    END IF;

    RAISE NOTICE 'All columns added successfully!';
END $$;
