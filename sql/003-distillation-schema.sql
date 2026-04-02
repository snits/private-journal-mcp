-- 003-distillation-schema.sql
-- Distillation module: structured insight extraction from journal entries

BEGIN;

-- Drop old distillation infrastructure (no production data worth preserving)
DROP VIEW IF EXISTS ai_memory.distillation_stats;
DROP VIEW IF EXISTS ai_memory.recent_distillations;
DROP TABLE IF EXISTS ai_memory.quality_metrics CASCADE;
DROP TABLE IF EXISTS ai_memory.distillation_jobs CASCADE;
DROP TABLE IF EXISTS ai_memory.distillation_batches CASCADE;
DROP TABLE IF EXISTS ai_memory.distillations CASCADE;

-- Structured insights extracted from journal entries by LLM
CREATE TABLE ai_memory.distillations (
    id            uuid DEFAULT public.uuid_generate_v4() NOT NULL PRIMARY KEY,
    title         varchar(200) NOT NULL,
    summary       text NOT NULL,
    key_insights  text[] NOT NULL DEFAULT '{}'::text[],
    category      varchar(50) NOT NULL,
    model         varchar(100) NOT NULL,
    embedding public.vector(768),
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT distillations_title_not_empty
        CHECK (length(title) > 0),
    CONSTRAINT distillations_summary_not_empty
        CHECK (length(summary) > 0),
    CONSTRAINT distillations_category_valid
        CHECK (category IN (
            'technical', 'reflection', 'planning',
            'learning', 'insight', 'collaboration', 'general'
        ))
);

CREATE INDEX idx_distillations_embedding_hnsw
    ON ai_memory.distillations
    USING hnsw (embedding public.vector_cosine_ops);

CREATE INDEX idx_distillations_category
    ON ai_memory.distillations (category);

CREATE TRIGGER update_distillations_updated_at
    BEFORE UPDATE ON ai_memory.distillations
    FOR EACH ROW EXECUTE FUNCTION ai_memory.update_updated_at_column();

CREATE TRIGGER audit_distillations
    AFTER INSERT OR DELETE OR UPDATE ON ai_memory.distillations
    FOR EACH ROW EXECUTE FUNCTION ai_memory.audit_trigger_function();

-- Join table linking distillations to source journal entries (1:1 in V1, many:1 later)
CREATE TABLE ai_memory.distillation_sources (
    distillation_id uuid NOT NULL
        REFERENCES ai_memory.distillations(id) ON DELETE CASCADE,
    entry_id        bigint NOT NULL
        REFERENCES ai_memory.journal_entries(id) ON DELETE CASCADE,
    created_at      timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (distillation_id, entry_id)
);

CREATE INDEX idx_distillation_sources_entry_id
    ON ai_memory.distillation_sources (entry_id);

-- Add category column to journal entries
ALTER TABLE ai_memory.journal_entries
    ADD COLUMN IF NOT EXISTS category varchar(50) DEFAULT NULL;

-- Use DO block to conditionally add constraint (idempotent)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'journal_entries_category_valid'
    ) THEN
        ALTER TABLE ai_memory.journal_entries
            ADD CONSTRAINT journal_entries_category_valid
                CHECK (category IS NULL OR category IN (
                    'technical', 'reflection', 'planning',
                    'learning', 'insight', 'collaboration', 'general'
                ));
    END IF;
END $$;

-- Backfill categories from type column
UPDATE ai_memory.journal_entries
SET category = CASE type
    WHEN 'technical'  THEN 'technical'
    WHEN 'reflection' THEN 'reflection'
    WHEN 'planning'   THEN 'planning'
    WHEN 'insight'    THEN 'insight'
    WHEN 'debug'      THEN 'technical'
    WHEN 'learning'   THEN 'learning'
    ELSE 'general'
END
WHERE category IS NULL;

COMMIT;
