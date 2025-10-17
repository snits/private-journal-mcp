# pgvector Integration & Mnemosyne Removal Implementation Plan

> **For Claude:** Use `${SUPERPOWERS_SKILLS_ROOT}/skills/collaboration/executing-plans/SKILL.md` to implement this plan task-by-task.

**Goal:** Replace inefficient JavaScript-based similarity search with PostgreSQL pgvector queries and remove non-functional Mnemosyne integration code.

**Architecture:** Switch from fetching all rows and calculating cosine similarity in JavaScript to using pgvector's native `<=>` distance operator with HNSW index. Remove all Mnemosyne distillation code (semantic-search-tools.ts) and 6 related MCP tools from server.ts. Keep 4 core journal tools.

**Tech Stack:**
- PostgreSQL with pgvector 0.8.0
- HNSW index on `embedding_768d vector(768)` column
- nomic-embed-text model (768 dimensions)
- MCP server framework

**Database State (Verified):**
- ✓ pgvector 0.8.0 installed
- ✓ `embedding_768d vector(768)` column exists
- ✓ HNSW index `idx_journal_entries_embedding_768d_hnsw` ready
- Old `embedding bytea` column (will deprecate, not remove)

---

## Task 1: Update searchBySimilarity to Use pgvector

**Files:**
- Modify: `src/postgresql-journal-simple.ts:254-348`
- Test manually: MCP tool `search_journal`

**Context:** Current implementation fetches ALL rows with embeddings (~lines 292-303), calculates cosine similarity in JavaScript loop (lines 307-341), sorts in memory (line 344). This is inefficient and doesn't use the HNSW index.

**Step 1: Read current searchBySimilarity implementation**

```bash
cd ~/.config/superpowers/worktrees/private-journal-mcp/feature/pgvector-cleanup
```

Read `src/postgresql-journal-simple.ts:254-348` to understand current WHERE clause construction and parameter handling.

**Step 2: Replace search query with pgvector version**

In `src/postgresql-journal-simple.ts`, locate the `searchBySimilarity` method around line 254. Replace the SQL query construction and result processing:

**OLD pattern (lines 292-344):**
```typescript
const sql = `
  SELECT id, content, timestamp, file_path, agent_id, model_id,
         visibility_level, entry_type, searchable_text, sections, embedding
  FROM ai_memory.journal_entries
  ${whereClause}
  ORDER BY timestamp DESC
`;

const result = await client.query(sql, params);

// Calculate similarity scores
for (const row of result.rows) {
  const embeddingArray = Array.from(new Float32Array(...));
  const score = this.embeddingService.cosineSimilarity(queryEmbedding, embeddingArray);
  if (score > 0.1) {
    results.push({...});
  }
}

return results.sort((a, b) => b.score - a.score).slice(0, limit);
```

**NEW pattern:**
```typescript
// Add embedding parameter and similarity threshold
const embeddingParam = `[${queryEmbedding.join(',')}]`;
params.push(embeddingParam);
const embeddingParamIndex = params.length;

const minSimilarity = options.min_relevance || 0.6;
params.push(minSimilarity);
const minSimilarityIndex = params.length;

params.push(limit);
const limitIndex = params.length;

const sql = `
  SELECT id, content, timestamp, file_path, agent_id, model_id,
         visibility_level, entry_type, searchable_text, sections,
         1 - (embedding_768d <=> $${embeddingParamIndex}::vector) AS score
  FROM ai_memory.journal_entries
  WHERE embedding_768d IS NOT NULL
    ${whereClause ? `AND ${whereClause.replace('WHERE ', '')}` : ''}
    AND (1 - (embedding_768d <=> $${embeddingParamIndex}::vector)) >= $${minSimilarityIndex}
  ORDER BY embedding_768d <=> $${embeddingParamIndex}::vector
  LIMIT $${limitIndex}
`;

const result = await client.query(sql, params);

// Results already sorted by similarity, just map to SearchResult format
const results: SearchResult[] = result.rows.map(row => ({
  id: row.id,
  content: row.content,
  timestamp: new Date(row.timestamp),
  filePath: row.file_path,
  score: row.score,
  entryType: row.entry_type,
  sections: row.sections,
  agentId: row.agent_id,
  modelId: row.model_id,
  visibilityLevel: row.visibility_level,
}));

return results;
```

**Key changes:**
- Use `embedding_768d` column instead of `embedding bytea`
- Calculate similarity in SQL: `1 - (embedding_768d <=> $X::vector) AS score`
- Order by distance: `ORDER BY embedding_768d <=> $X::vector` (uses HNSW index)
- Filter by minimum similarity in SQL instead of JavaScript
- Remove JavaScript cosine similarity loop
- Remove in-memory sorting and slicing

**Step 3: Test the search functionality**

Start the MCP server in the worktree:

```bash
cd ~/.config/superpowers/worktrees/private-journal-mcp/feature/pgvector-cleanup
npm run build
# In a separate terminal, configure Claude Code to use the worktree server
# Test with: mcp__private-journal__search_journal query="technical insights"
```

Expected: Returns results with similarity scores, faster than before.

**Step 4: Verify HNSW index is used**

Check PostgreSQL query plan:

```bash
psql -U postgres -d mnemosyne_prod -c "EXPLAIN ANALYZE
  SELECT id, 1 - (embedding_768d <=> '[0.1,0.2,...]'::vector) AS score
  FROM ai_memory.journal_entries
  WHERE embedding_768d IS NOT NULL
  ORDER BY embedding_768d <=> '[0.1,0.2,...]'::vector
  LIMIT 10;"
```

Expected output should show: `Index Scan using idx_journal_entries_embedding_768d_hnsw`

**Step 5: Commit**

```bash
git add src/postgresql-journal-simple.ts
git commit -s -m "feat: use pgvector for semantic search instead of JS cosine similarity

Replace fetch-all-and-sort-in-memory with native pgvector queries.
Uses existing HNSW index for fast similarity search.

Assisted-By: Claude (claude-sonnet-4-5)"
```

---

## Task 2: Update Write Methods to Use embedding_768d

**Files:**
- Modify: `src/postgresql-journal-simple.ts:100-112` (processThoughts write)
- Modify: `src/postgresql-journal-simple.ts:209-214` (migrateEntry write)

**Context:** Write methods currently store embeddings in `embedding bytea` column using `Buffer.from(new Float32Array(...))`. Need to also/instead write to `embedding_768d vector(768)` using array literal format.

**Step 1: Update processThoughts write method**

In `src/postgresql-journal-simple.ts` around line 100-112, locate the INSERT statement.

**OLD pattern:**
```typescript
const embedding = Buffer.from(new Float32Array(embeddingArray).buffer);

const sql = `
  INSERT INTO ai_memory.journal_entries
  (..., embedding)
  VALUES (..., $N)
`;

params.push(embedding);
```

**NEW pattern:**
```typescript
const embeddingArrayLiteral = `[${embeddingArray.join(',')}]`;

const sql = `
  INSERT INTO ai_memory.journal_entries
  (..., embedding_768d)
  VALUES (..., $N::vector)
`;

params.push(embeddingArrayLiteral);
```

**Step 2: Update migrateEntry write method**

In `src/postgresql-journal-simple.ts` around line 209-214, locate the UPDATE or INSERT statement.

Apply the same transformation as Step 1.

**Step 3: Test writing new entries**

```bash
# Test with MCP tool
# mcp__private-journal__process_thoughts with test content
```

Verify in database:

```bash
psql -U postgres -d mnemosyne_prod -c "
  SELECT id, embedding_768d IS NOT NULL as has_new_embedding
  FROM ai_memory.journal_entries
  ORDER BY timestamp DESC
  LIMIT 5;"
```

Expected: `has_new_embedding` should be `t` for newly written entries.

**Step 4: Commit**

```bash
git add src/postgresql-journal-simple.ts
git commit -s -m "feat: write embeddings to vector column instead of bytea

Store embeddings in embedding_768d column using array literal format
compatible with pgvector. Old embedding column no longer used.

Assisted-By: Claude (claude-sonnet-4-5)"
```

---

## Task 3: Remove Mnemosyne Tools from server.ts

**Files:**
- Modify: `src/server.ts` (remove 6 tools and their handlers)

**Context:** server.ts currently registers 10 MCP tools. We're removing 6 Mnemosyne tools and keeping 4 core journal tools.

**Tools to KEEP:**
- `process_thoughts` (line ~206)
- `search_journal` (line ~259)
- `read_journal_entry` (line ~337)
- `list_recent_entries` (line ~351)

**Tools to REMOVE:**
- `semantic_search_insights` (line ~378)
- `find_related_insights` (line ~478)
- `distill_and_search` (line ~519)
- `get_semantic_search_stats` (line ~565)
- `semantic_search_chunks` (line ~575)
- `expand_chunk` (line ~601)

**Step 1: Read server.ts tool registrations**

Read `src/server.ts` to locate:
- Tool registration lines (~200-650)
- Tool handler cases in switch statement (~858-1242)
- SemanticSearchTools import and initialization (~line 19, 176)

**Step 2: Remove SemanticSearchTools import**

Around line 19, remove:
```typescript
import { SemanticSearchTools } from './semantic-search-tools.js';
```

Around line 176, remove initialization:
```typescript
const semanticSearchTools = new SemanticSearchTools(...);
```

**Step 3: Remove 6 tool registrations**

Delete tool registration objects for the 6 Mnemosyne tools (lines ~378-640).

**Step 4: Remove 6 tool handlers**

In the switch statement handling tool calls (lines ~858-1242), remove the 6 case blocks for Mnemosyne tools.

**Step 5: Test MCP server tools list**

```bash
npm run build
# Restart MCP server
# Check available tools in Claude Code
```

Expected: Only 4 tools visible (`process_thoughts`, `search_journal`, `read_journal_entry`, `list_recent_entries`).

**Step 6: Commit**

```bash
git add src/server.ts
git commit -s -m "refactor: remove non-functional Mnemosyne MCP tools

Remove semantic_search_insights, find_related_insights, distill_and_search,
get_semantic_search_stats, semantic_search_chunks, expand_chunk.

Keep core journal tools: process_thoughts, search_journal,
read_journal_entry, list_recent_entries.

Assisted-By: Claude (claude-sonnet-4-5)"
```

---

## Task 4: Delete semantic-search-tools.ts

**Files:**
- Delete: `src/semantic-search-tools.ts`

**Context:** This 1467-line file contains the entire Mnemosyne integration that's no longer used. Safe to delete after removing server.ts dependencies in Task 3.

**Step 1: Verify no remaining imports**

```bash
cd ~/.config/superpowers/worktrees/private-journal-mcp/feature/pgvector-cleanup
grep -r "semantic-search-tools" src/ --exclude=semantic-search-tools.ts
```

Expected: No results (all imports removed in Task 3).

**Step 2: Delete the file**

```bash
rm src/semantic-search-tools.ts
```

**Step 3: Verify build succeeds**

```bash
npm run build
```

Expected: Clean build with no errors.

**Step 4: Commit**

```bash
git add src/semantic-search-tools.ts
git commit -s -m "refactor: remove Mnemosyne distillation implementation

Delete semantic-search-tools.ts (1467 lines) containing 4-tier fallback
system for distilled insights. Mnemosyne functionality not ready for use.

Can be restored from git history if Mnemosyne is resumed later.

Assisted-By: Claude (claude-sonnet-4-5)"
```

---

## Task 5: Performance Verification

**Files:**
- None (testing/verification only)

**Context:** Verify the pgvector implementation is actually faster and uses the HNSW index.

**Step 1: Baseline search performance**

Run a search query and note the response time:

```bash
# Use MCP tool with verbose timing
time mcp__private-journal__search_journal query="database performance" limit=20
```

Note the query time.

**Step 2: Check PostgreSQL query plan**

```bash
psql -U postgres -d mnemosyne_prod -c "
  SET enable_seqscan = off;
  EXPLAIN (ANALYZE, BUFFERS)
  SELECT id, 1 - (embedding_768d <=> '[0.1,0.2,...]'::vector) AS score
  FROM ai_memory.journal_entries
  WHERE embedding_768d IS NOT NULL
  ORDER BY embedding_768d <=> '[0.1,0.2,...]'::vector
  LIMIT 10;"
```

Expected output includes:
- `Index Scan using idx_journal_entries_embedding_768d_hnsw`
- Execution time significantly less than old approach
- "Buffers: shared hit=..." showing efficient buffer usage

**Step 3: Document performance improvement**

Add a note to the feature branch describing:
- Old approach: Fetch N rows, O(N) similarity calculations in JS
- New approach: HNSW index scan, similarity in SQL
- Measured improvement (e.g., "200ms → 15ms for 1000 entries")

**Step 4: No commit needed**

This is verification only, no code changes.

---

## Success Criteria

**Code:**
- ✓ searchBySimilarity uses pgvector `<=>` operator
- ✓ Write methods store embeddings in `embedding_768d` column
- ✓ Only 4 MCP tools registered (no Mnemosyne tools)
- ✓ semantic-search-tools.ts deleted
- ✓ Clean build with no errors

**Testing:**
- ✓ search_journal tool returns results with scores
- ✓ process_thoughts writes to embedding_768d column
- ✓ PostgreSQL query plan shows HNSW index usage
- ✓ Search performance improved over baseline

**Documentation:**
- ✓ All commits follow conventional commit format
- ✓ Commits include agent attribution
- ✓ Performance notes captured

---

## Notes for Implementation

**DRY Principle:** Don't duplicate the array literal format. Consider extracting `formatEmbeddingForPgvector(arr: number[]): string` helper if used in multiple places.

**YAGNI:** Don't add migration code to backfill old embeddings. Old entries will continue to work with search (pgvector handles NULL gracefully). New entries will use new column.

**TDD:** For each change, test immediately. Don't batch multiple changes before testing.

**Frequent Commits:** One commit per task. Don't combine "update search + update write" into one commit.

**Safety:** Database columns/tables are NOT modified or dropped. Code changes only. Database cleanup can happen later if desired.

**Rollback:** If anything breaks, all changes can be reverted via git. Old `embedding bytea` column is still present as safety net.
