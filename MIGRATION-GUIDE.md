# Database Schema Migration Guide

This guide covers migrating the `ai_memory.journal_entries` table to support project-aware entries and pgvector-based semantic search.

## Overview

This migration adds:
- `project` column for filtering entries by project name
- `project_context` JSONB column for storing git metadata
- `embedding` vector(768) column for pgvector semantic search
- HNSW index for fast vector similarity search
- Partial B-tree index on project column

## Migration Status Check

Before starting, check your current schema status:

```bash
./verify-schema.ts
```

This will tell you:
- Which columns are missing
- Which indexes need to be created
- How many entries need embedding conversion
- Recommended next steps

## Migration Steps

### Prerequisites

1. Ensure PostgreSQL is running and accessible
2. Verify your `.env` file has correct database credentials:
   ```
   DB_HOST=localhost
   DB_PORT=5432
   DB_NAME=mnemosyne_prod
   DB_USER=postgres
   DB_PASSWORD=your_password
   ```
3. Ensure pgvector extension is installed (verify-schema.ts will check this)

### Step 1: Add Missing Columns

Add the `project`, `project_context`, and `embedding` columns:

```bash
psql -h localhost -U postgres -d mnemosyne_prod -f 001-add-project-columns.sql
```

Expected output:
```
NOTICE:  === Column Addition Verification ===
NOTICE:  project column: ✓ EXISTS
NOTICE:  project_context column: ✓ EXISTS
NOTICE:  embedding column: ✓ EXISTS
NOTICE:  All columns added successfully!
```

**What this does:**
- Adds `project VARCHAR(100)` - stores project name
- Adds `project_context JSONB` - stores full git metadata
- Adds `embedding vector(768)` - pgvector column for embeddings
- Verifies all columns were created successfully

### Step 2: Migrate Embeddings

Convert existing bytea embeddings to pgvector format:

```bash
./migrate-embeddings-to-vector.ts
```

This script:
- Processes entries in batches of 100 (configurable with `--batch-size=N`)
- Converts bytea embeddings to vector(768) format
- Verifies each embedding is 768-dimensional
- Provides progress updates and final statistics
- Uses transactions to ensure data integrity

**Expected runtime:** ~30-60 seconds for 2,000 entries

Expected output example:
```
=== Embedding Migration to pgvector ===
Entries to migrate: 1954
Batch size: 100

Processing batch 1/20 (100 entries)...
  ✓ Batch complete (100/1954 migrated)
...

=== Migration Summary ===
Total entries: 1954
Successfully migrated: 1954
Errors: 0
Success rate: 100.0%
Time taken: 45.23s

✓ Migration complete! All valid entries now use pgvector format.
```

**Note:** This migration does NOT re-generate embeddings from content. It only converts the existing bytea format to pgvector format. The embeddings remain unchanged.

### Step 3: Create Indexes

Create performance indexes for semantic search and project filtering:

```bash
psql -h localhost -U postgres -d mnemosyne_prod -f 002-add-indexes.sql
```

**What this does:**
- Creates HNSW index on `embedding` for fast vector similarity search
  - Uses `m=16` for balanced recall/build time
  - Uses `ef_construction=64` for index quality
- Creates partial B-tree index on `project` column (only for non-NULL values)
- Uses `CREATE INDEX CONCURRENTLY` to avoid blocking table access

**Expected runtime:** 1-5 minutes depending on data volume and server resources

Expected output:
```
NOTICE:  === Index Creation Verification ===
NOTICE:  HNSW vector index: ✓ EXISTS
NOTICE:  Project index: ✓ EXISTS
NOTICE:  All indexes created successfully!
```

**Performance impact:**
- HNSW index reduces semantic search time from ~400-850ms to ~6ms
- Project index enables fast filtering of entries by project

### Step 4: Rename Embedding Column (existing databases only)

If your database was set up before the `embedding_768d` -> `embedding` rename, run:

```bash
psql -h localhost -U postgres -d mnemosyne_prod -f sql/004-rename-embedding-column.sql
```

This drops the legacy `embedding bytea` column, renames `embedding_768d` to `embedding`, and renames the HNSW index. Fresh databases using the current schema files already have the correct column name and can skip this step.

### Step 5: Verify Migration

Confirm everything is correct:

```bash
./verify-schema.ts
```

Expected output for successful migration:
```
=== Database Schema Verification ===
Database: mnemosyne_prod
Host: localhost:5432

--- Required Columns ---
✓ project              character varying         (nullable: YES)
✓ project_context      jsonb                     (nullable: YES)
✓ embedding            USER-DEFINED              (nullable: YES)

--- Required Indexes ---
✓ idx_journal_entries_embedding_hnsw
  Type: HNSW vector similarity index
✓ idx_journal_entries_project
  Type: Partial B-tree index on project column

--- Data Migration Status ---
Total entries: 1954
With legacy embedding (bytea): 1954
With vector embedding (vector): 1954
With project name: 0
With project context: 0

✓ All entries with embeddings have been migrated to vector format

=== Summary ===
✓ Schema is complete and up to date

--- Extensions ---
✓ pgvector extension installed (version 0.6.2)
```

## Post-Migration

### Backfilling Project Data (Optional)

New entries will automatically capture project context. For existing entries, you can:

1. **Do nothing** - Old entries will have NULL `project` and `project_context`
2. **Manual backfill** - Extract project names from `file_path`:
   ```sql
   UPDATE ai_memory.journal_entries
   SET project = 'legacy'
   WHERE file_path LIKE 'project/%' AND project IS NULL;
   ```
3. **Custom migration** - Write a script to parse git context from historical data

### Cleanup

The legacy `embedding bytea` column is automatically dropped by `sql/004-rename-embedding-column.sql`. No manual cleanup is needed.

## Rollback (Emergency Only)

If something goes wrong, you can rollback individual steps:

### Rollback Indexes
```sql
DROP INDEX CONCURRENTLY IF EXISTS ai_memory.idx_journal_entries_embedding_hnsw;
DROP INDEX CONCURRENTLY IF EXISTS ai_memory.idx_journal_entries_project;
```

### Rollback Columns (DANGEROUS - will lose data)
```sql
-- WARNING: This will delete all project data and migrated embeddings!
ALTER TABLE ai_memory.journal_entries DROP COLUMN project;
ALTER TABLE ai_memory.journal_entries DROP COLUMN project_context;
ALTER TABLE ai_memory.journal_entries DROP COLUMN embedding;
```

## Troubleshooting

### "pgvector extension not found"
```sql
CREATE EXTENSION vector;
```

### "permission denied for schema ai_memory"
Ensure your database user has the necessary permissions:
```sql
GRANT USAGE ON SCHEMA ai_memory TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA ai_memory TO postgres;
```

### Migration script fails with "dimension mismatch"
Some entries may have corrupted embeddings. The script will skip these and report them. You can:
1. Note the IDs and manually fix them
2. Re-generate embeddings for failed entries
3. Delete entries with corrupted embeddings

### Index creation takes too long
The `CREATE INDEX CONCURRENTLY` allows table access during creation but takes longer. If needed, you can:
1. Run during off-hours
2. Reduce `ef_construction` parameter (trade quality for speed)
3. Remove `CONCURRENTLY` flag (faster but blocks table access)

## Migration Checklist

- [ ] Run `./verify-schema.ts` to check current status
- [ ] Backup database: `pg_dump -h localhost -U postgres mnemosyne_prod > backup.sql`
- [ ] Run `001-add-project-columns.sql` to add columns
- [ ] Run `002-add-indexes.sql` to create indexes
- [ ] Run `sql/004-rename-embedding-column.sql` (existing databases only)
- [ ] Run `./verify-schema.ts` to confirm success
- [ ] Test semantic search with HNSW index
- [ ] Test project filtering with project column
- [ ] (Optional) Backfill project data for existing entries

## Files Created

- `001-add-project-columns.sql` - Adds required columns
- `002-add-indexes.sql` - Creates performance indexes
- `sql/004-rename-embedding-column.sql` - Renames embedding column (existing databases)
- `verify-schema.ts` - Verification and status reporting
- `MIGRATION-GUIDE.md` - This document

## Questions?

If you encounter issues not covered here, check:
1. PostgreSQL logs: `/var/log/postgresql/` or via `journalctl -u postgresql`
2. Application logs when running migration scripts
3. `verify-schema.ts` output for specific missing components
