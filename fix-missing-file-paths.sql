-- ABOUTME: Migration script to fix missing file_path values in journal_entries
-- ABOUTME: Reconstructs file_path from timestamp and entry metadata for entries that were migrated without paths

-- Context: This script fixes a data migration issue where entries migrated from the old system
-- (August 1-13, 2025 and some scattered entries) lack file_path values. These entries appear
-- in search results but can't be read because the path is empty.
--
-- Recovery strategy:
-- - Simple entries: YYYY-MM-DD/HH-MM-SS-MMMMMM.md
-- - Thoughts with project notes: project/YYYY-MM-DD/HH-MM-SS-MMMMMM.md
-- - Thoughts without project notes: user/YYYY-MM-DD/HH-MM-SS-MMMMMM.md
-- - Other entry types: YYYY-MM-DD/HH-MM-SS-MMMMMM.md (default)

-- Timestamp format: YYYY-MM-DD for date, HH24-MI-SS-MMMMMM for time with microseconds

-- Fix 'simple' entry types (no prefix needed)
UPDATE ai_memory.journal_entries
SET file_path = TO_CHAR(timestamp, 'YYYY-MM-DD') || '/' ||
                TO_CHAR(timestamp, 'HH24-MI-SS') || '-' ||
                LPAD(CAST(EXTRACT(MICROSECOND FROM timestamp)::integer AS TEXT), 6, '0') || '.md'
WHERE entry_type = 'simple' AND (file_path IS NULL OR file_path = '');

-- Fix 'thoughts' entry types with project notes (prefix 'project/')
UPDATE ai_memory.journal_entries
SET file_path = 'project/' ||
                TO_CHAR(timestamp, 'YYYY-MM-DD') || '/' ||
                TO_CHAR(timestamp, 'HH24-MI-SS') || '-' ||
                LPAD(CAST(EXTRACT(MICROSECOND FROM timestamp)::integer AS TEXT), 6, '0') || '.md'
WHERE entry_type = 'thoughts'
  AND (file_path IS NULL OR file_path = '')
  AND sections::text LIKE '%Project Notes%';

-- Fix 'thoughts' entry types without project notes (prefix 'user/')
UPDATE ai_memory.journal_entries
SET file_path = 'user/' ||
                TO_CHAR(timestamp, 'YYYY-MM-DD') || '/' ||
                TO_CHAR(timestamp, 'HH24-MI-SS') || '-' ||
                LPAD(CAST(EXTRACT(MICROSECOND FROM timestamp)::integer AS TEXT), 6, '0') || '.md'
WHERE entry_type = 'thoughts'
  AND (file_path IS NULL OR file_path = '')
  AND sections::text NOT LIKE '%Project Notes%';

-- Fix any remaining entry types (test, etc.) - use default format without prefix
UPDATE ai_memory.journal_entries
SET file_path = TO_CHAR(timestamp, 'YYYY-MM-DD') || '/' ||
                TO_CHAR(timestamp, 'HH24-MI-SS') || '-' ||
                LPAD(CAST(EXTRACT(MICROSECOND FROM timestamp)::integer AS TEXT), 6, '0') || '.md'
WHERE file_path IS NULL OR file_path = '';

-- Verify the migration results
SELECT COUNT(*) FILTER (WHERE file_path IS NULL OR file_path = '') as remaining_empty,
       COUNT(*) as total_entries,
       COUNT(*) FILTER (WHERE file_path IS NOT NULL AND file_path != '') as fixed_entries,
       COUNT(*) FILTER (WHERE file_path IS NOT NULL AND file_path LIKE 'project/%') as project_entries,
       COUNT(*) FILTER (WHERE file_path IS NOT NULL AND file_path LIKE 'user/%') as user_entries,
       COUNT(*) FILTER (WHERE file_path IS NOT NULL AND file_path NOT LIKE 'project/%' AND file_path NOT LIKE 'user/%') as unprefixed_entries
FROM ai_memory.journal_entries;
