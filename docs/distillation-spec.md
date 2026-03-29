# Distillation Module Specification

## Overview

Add memory distillation to private-journal-mcp: structured insight extraction from
raw journal entries via LLM, stored alongside entries in the same PostgreSQL database
and searchable through the existing `search_journal` tool.

**Design basis:** [Mnemosyne Revival Design Meeting Report (2026-03-29)](../../mnemosyne/.claude/scratchpad/meetings/mnemosyne-revival/report.md)

**Scope:** ~670–1,000 lines of new TypeScript, ~200 lines of modified code, 2 new
tables, 1 new column, 1 new MCP tool, 1 enhanced MCP tool.

## Schema

All tables live in the existing `ai_memory` schema on the `mnemosyne_prod` database.

### Migration: Remove Old Distillation Infrastructure

The following tables, views, and triggers from the original mnemosyne system must be
dropped before creating the new schema. They contain no production data worth preserving.

```sql
-- Drop views first (depend on tables)
DROP VIEW IF EXISTS ai_memory.distillation_stats;
DROP VIEW IF EXISTS ai_memory.recent_distillations;

-- Drop tables (cascades triggers and FK constraints)
DROP TABLE IF EXISTS ai_memory.quality_metrics CASCADE;
DROP TABLE IF EXISTS ai_memory.distillation_jobs CASCADE;
DROP TABLE IF EXISTS ai_memory.distillation_batches CASCADE;
DROP TABLE IF EXISTS ai_memory.distillations CASCADE;
```

### New Table: `distillations`

Stores structured insights extracted from journal entries by an LLM.

```sql
CREATE TABLE ai_memory.distillations (
    id            uuid DEFAULT public.uuid_generate_v4() NOT NULL PRIMARY KEY,
    title         varchar(200) NOT NULL,
    summary       text NOT NULL,
    key_insights  text[] NOT NULL DEFAULT '{}'::text[],
    category      varchar(50) NOT NULL,
    model         varchar(100) NOT NULL,       -- e.g. "llama3.1:8b", "claude-sonnet-4"
    embedding_768d public.vector(768),
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

-- HNSW index matching journal_entries pattern
CREATE INDEX idx_distillations_embedding_768d_hnsw
    ON ai_memory.distillations
    USING hnsw (embedding_768d vector_cosine_ops);

CREATE INDEX idx_distillations_category
    ON ai_memory.distillations (category);

-- Auto-update timestamp trigger (reuses existing function)
CREATE TRIGGER update_distillations_updated_at
    BEFORE UPDATE ON ai_memory.distillations
    FOR EACH ROW EXECUTE FUNCTION ai_memory.update_updated_at_column();

-- Audit trigger (reuses existing function)
CREATE TRIGGER audit_distillations
    AFTER INSERT OR DELETE OR UPDATE ON ai_memory.distillations
    FOR EACH ROW EXECUTE FUNCTION ai_memory.audit_trigger_function();
```

### New Table: `distillation_sources`

Join table linking distillations to their source journal entries. V1 uses 1:1
(one entry produces one distillation). The join table enables future many:1
consolidation (multiple entries synthesized into one insight) without schema migration.

```sql
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
```

### Altered Table: `journal_entries`

Add `category` column. This column does not currently exist (contrary to the design
meeting's assumption that it existed but defaulted to NULL).

```sql
ALTER TABLE ai_memory.journal_entries
    ADD COLUMN category varchar(50) DEFAULT NULL;

-- Populate existing entries via heuristic extraction (see §Heuristic Category Extraction)
-- Then optionally add constraint:
ALTER TABLE ai_memory.journal_entries
    ADD CONSTRAINT journal_entries_category_valid
        CHECK (category IS NULL OR category IN (
            'technical', 'reflection', 'planning',
            'learning', 'insight', 'collaboration', 'general'
        ));
```

### Shared Category Taxonomy

Both `journal_entries.category` and `distillations.category` use the same set:

| Category        | Meaning                                      |
|-----------------|----------------------------------------------|
| `technical`     | Project notes, technical insights, debugging |
| `reflection`    | Feelings, emotional processing               |
| `planning`      | Plans, roadmaps, scheduling                  |
| `learning`      | World knowledge, skill acquisition           |
| `insight`       | Distilled observations and realizations      |
| `collaboration` | User context, communication notes            |
| `general`       | Fallback for uncategorizable content         |

## Environment Configuration

Add three new environment variables for text generation (alongside existing
`OPENAI_EMBEDDING_*` variables for embeddings):

```
TEXT_GEN_BASE_URL=http://localhost:11434/v1    # OpenAI-compatible chat completions endpoint
TEXT_GEN_MODEL=llama3.1:8b                     # Model name for distillation
TEXT_GEN_API_KEY=                               # API key (optional for local models)
```

These follow the same pattern as the embedding config: any OpenAI-compatible endpoint
works (Ollama, vLLM, cloud providers).

## Text Generation Client

New file: `src/text-generation-client.ts`

Follows the existing `openai-client.ts` pattern. Uses the OpenAI-compatible chat
completions API (`POST /chat/completions`) instead of the embeddings API.

### Interface

```typescript
interface TextGenerationConfig {
    baseUrl: string;     // from TEXT_GEN_BASE_URL
    model: string;       // from TEXT_GEN_MODEL
    apiKey?: string;     // from TEXT_GEN_API_KEY
    timeout?: number;    // default: 60000ms (longer than embedding — LLM generation is slower)
}

interface TextGenerationClient {
    /**
     * Send a prompt and return the generated text.
     * Uses POST ${baseUrl}/chat/completions with role: "user".
     */
    generate(prompt: string, options?: {
        temperature?: number;   // default: 0.3 (low for structured output)
        maxTokens?: number;     // default: 1024
    }): Promise<string>;

    /** Check if the text generation endpoint is reachable. */
    healthCheck(): Promise<boolean>;
}
```

### Implementation Notes

- Single `fetch` call per generation — no streaming needed for structured output
- `AbortController` for timeout (matching openai-client.ts pattern)
- Parse `response.choices[0].message.content` from the OpenAI chat completions format
- No retry logic — caller handles errors
- No `PQueue` concurrency control (unlike `openai-client.ts`) — sequential processing
- ~80–100 lines

## Distillation Service

New file: `src/distillation/distillation-service.ts`

Orchestrates the distillation pipeline: query entries, build prompts, call LLM,
parse output, store results.

Instantiate as a peer to `journalManager` in the `PrivateJournalServer` constructor.
Dependencies: database pool, `EmbeddingService` (singleton via `getInstance()`),
`TextGenerationClient`. LLM orchestration does not belong in the journal manager.

### Interface

```typescript
interface DistillationOptions {
    daysBack: number;           // how far back to look for entries (default: 30)
    category?: string;          // optional: only distill entries matching this category
    limit?: number;             // max entries to process (default: 50)
}

interface DistillationResult {
    title: string;
    summary: string;
    keyInsights: string[];
    category: string;
}

interface DistillationSummary {
    entriesFound: number;       // total matching entries
    entriesSkipped: number;     // already have distillations
    distillationsCreated: number;
    errors: number;
}

interface DistillationService {
    /**
     * Distill journal entries into structured insights.
     * Skips entries that already have distillations (via distillation_sources).
     * Processes sequentially — no batch infrastructure.
     */
    distillEntries(options: DistillationOptions): Promise<DistillationSummary>;
}
```

### Processing Pipeline

For each undistilled entry:

1. Build prompt from entry content and metadata (see §Distillation Prompt)
2. Call `TextGenerationClient.generate(prompt)`
3. Parse JSON response into `DistillationResult`
4. Validate: required fields present, category in taxonomy, non-empty strings
5. INSERT into `distillations` table
6. INSERT into `distillation_sources` (distillation_id, entry_id)
7. Generate 768d embedding for the distillation's searchable content
   (`title + " " + summary + " " + keyInsights.join(" ")`)
8. UPDATE `distillations` SET `embedding_768d` = generated embedding
9. Log progress: `Distilled entry ${entryId}: "${title}"`

On parse/validation failure for a single entry: log the error, increment error count,
continue to next entry. Do not abort the batch.

### JSON Parsing

LLMs frequently wrap JSON output in markdown code fences. Before calling
`JSON.parse()`, strip leading/trailing code fences:

```typescript
function stripCodeFences(raw: string): string {
    return raw.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
}
```

### Transaction Boundaries

Steps 5-6 (INSERT distillation + INSERT source link) should be wrapped in a
transaction. Steps 7-8 (generate embedding + UPDATE) run separately after commit.

If embedding generation fails, the distillation exists with all metadata but
`embedding_768d` is NULL — it won't appear in search results (the search query
filters `WHERE embedding_768d IS NOT NULL`). The distillation is preserved but
unsearchable. Re-embedding is a manual operation (query for distillations where
`embedding_768d IS NULL`, regenerate). This is accepted degraded behavior.

### Query for Undistilled Entries

```sql
SELECT je.id, je.content, je.type, je.agent_id, je.date_string, je.sections
FROM ai_memory.journal_entries je
LEFT JOIN ai_memory.distillation_sources ds ON je.id = ds.entry_id
WHERE ds.entry_id IS NULL                              -- no existing distillation
  AND je.timestamp >= now() - make_interval(days => $1) -- within date range
  AND ($2::varchar IS NULL OR je.category = $2)        -- optional category filter
ORDER BY je.timestamp ASC;
```

Note: uses `type` column (which contains `'technical'`, `'reflection'`, etc.),
not `entry_type` (which is always `'simple'` or `'thoughts'`).

## Distillation Prompt

Reference: `mnemosyne/src/distillation/distillation-engine.ts:330-386`

The prompt is simplified from mnemosyne's version — no quality scores, no action items,
no tags. Output is a JSON object with four fields.

```
You are an expert at distilling journal entries into structured insights.
Analyze the following journal entry and extract the key information.

JOURNAL ENTRY:
"""
${entry.content}
"""

ENTRY METADATA:
- Type: ${entry.entry_type ?? 'general'}
- Agent: ${entry.agent_id ?? 'unknown'}
- Date: ${entry.date_string}
- Sections: ${entry.sections?.join(', ') ?? 'none'}

Extract structured insights in JSON format:

{
  "title": "Clear, descriptive title capturing the main insight (10+ characters)",
  "summary": "Concise summary of key content and context (50+ characters)",
  "key_insights": ["Specific, actionable insights (at least 1, 20+ characters each)"],
  "category": "One of: technical, reflection, planning, learning, insight, collaboration, general"
}

REQUIREMENTS:
- Be specific, avoid vague language
- Focus on actionable insights over general observations
- Use precise language and concrete details
- Ensure insights are distinct and non-repetitive
- Choose the most appropriate category based on content

OUTPUT ONLY VALID JSON.
```

### Prompt Design Rationale

The character-length hints (10+, 50+, 20+) guide the LLM toward substantive output
without requiring programmatic validation. If the LLM returns valid JSON with the
required fields, accept it. No automated quality scoring — if results are bad,
Jerry flags them manually.

## Heuristic Category Extraction

New function in: `src/distillation/category-extraction.ts` (or inline in journal manager)

Populates `journal_entries.category` on write, based on section headers and entry type.
~20 lines, <1ms, no LLM call.

### Mapping Rules

```typescript
const SECTION_TO_CATEGORY: Record<string, string> = {
    'feelings':            'reflection',
    'project_notes':       'technical',
    'technical_insights':  'technical',
    'user_context':        'collaboration',
    'world_knowledge':     'learning',
};

const ENTRY_TYPE_TO_CATEGORY: Record<string, string> = {
    'technical':  'technical',
    'reflection': 'reflection',
    'planning':   'planning',
    'insight':    'insight',
    'debug':      'technical',
    'learning':   'learning',
};

function extractCategory(sections: string[] | null, entryType: string | null): string {
    // 1. Check sections first (more specific than entry type)
    if (sections) {
        for (const section of sections) {
            if (section in SECTION_TO_CATEGORY) {
                return SECTION_TO_CATEGORY[section];
            }
        }
    }
    // 2. Fall back to entry type
    if (entryType && entryType in ENTRY_TYPE_TO_CATEGORY) {
        return ENTRY_TYPE_TO_CATEGORY[entryType];
    }
    // 3. Default
    return 'general';
}
```

### Backfill Existing Entries

Run once after adding the column to populate categories for existing entries:

```sql
-- Uses `type` column (not `entry_type` — that is always 'simple' or 'thoughts')
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
```

Section-based categorization for thoughts entries requires reading the `sections`
JSONB column (stored as JSONB array, not text[]). This is better done in application
code during the backfill since it requires parsing JSON and applying priority logic.

## Enhanced `search_journal`

### Current Behavior

Single pgvector query against `journal_entries.embedding_768d`, returns raw entries
ranked by cosine similarity.

### New Behavior

Two independent pgvector queries, merged with deduplication.

### Merged Search Result Types

The existing `SearchResult` type cannot hold distillation fields. Use a
discriminated union:

```typescript
interface BaseSearchResult {
    score: number;
    timestamp: Date;
}

interface EntrySearchResult extends BaseSearchResult {
    source: 'entry';
    id: number;
    content: string;
    file_path: string;
    entry_type: string;
    sections: string[];
    project?: string;
    // ...existing SearchResult fields
}

interface DistillationSearchResult extends BaseSearchResult {
    source: 'distillation';
    id: string;              // uuid
    title: string;
    summary: string;
    key_insights: string[];
    category: string;
    source_entry_id: number; // from JOIN, for dedup
    source_entry_path?: string;
}

type MergedSearchResult = EntrySearchResult | DistillationSearchResult;
```

The `normalizeSearchResponse` function in `parameter-transformation.ts` must
branch on `result.source` to format each type appropriately. Entry results use
the existing rendering; distillation results use the format shown below.

### Algorithm

```
function searchJournal(query, options):
    embedding = generateQueryEmbedding(query)

    // 1. Query both sources concurrently (Promise.all)
    entryResults = pgvectorQuery(journal_entries, embedding, options)
    distillationResults = pgvectorQuery(distillations, embedding, options)

    // 2. Deduplicate: distillation query returns source_entry_id via JOIN.
    //    When an entry and its distillation both appear, keep higher score.
    entryIdSet = new Set(entryResults.map(r => r.id))
    for each distResult in distillationResults:
        if distResult.source_entry_id in entryIdSet:
            entryResult = find entry with that id
            if distResult.score > entryResult.score:
                remove entryResult from entryResults
            else:
                remove distResult from distillationResults

    // 3. Merge, sort by score descending, take top limit
    merged = [...entryResults, ...distillationResults]
    return merged.sort(by: score desc).slice(0, options.limit)
```

Extract the distillation query and merge/dedup logic into private methods
(`searchDistillations`, `mergeSearchResults`) to keep `searchBySimilarity`
readable.

### Distillation Query

The LEFT JOIN on `distillation_sources` returns `source_entry_id` with each
result, enabling dedup without a separate query:

```sql
SELECT d.id, d.title, d.summary, d.key_insights, d.category,
       d.created_at AS timestamp,
       ds.entry_id AS source_entry_id,
       1 - (d.embedding_768d <=> $1::vector) AS score
FROM ai_memory.distillations d
LEFT JOIN ai_memory.distillation_sources ds ON d.id = ds.distillation_id
WHERE d.embedding_768d IS NOT NULL
  AND (1 - (d.embedding_768d <=> $1::vector)) >= $2   -- min similarity
ORDER BY d.embedding_768d <=> $1::vector
LIMIT $3;
```

### Search Result Rendering

Rendering branches on `result.source`. Entry results use existing format.
Distillation results use `[distillation]` tag for parseable distinction:

```
1. [Score: 0.847] 2026-03-15 [distillation]
   Title: Authentication middleware compliance rewrite
   Summary: Legal flagged session token storage for compliance issues...
   Key Insights:
     - Session tokens must not persist beyond browser session
     - Compliance deadline is Q2 2026
   Category: technical
   Source entry: 2026-03-15/14-30-45-123456.md
```

## New MCP Tool: `distill_entries`

Manual trigger for distillation. Not agent-facing for scheduling — agents use it
when prompted or when the cold-start hint suggests it.

### Tool Definition

```json
{
    "name": "distill_entries",
    "description": "Extract structured insights from recent journal entries, making them searchable as condensed summaries alongside raw entries. Distilled insights surface patterns and key learnings that may not match raw entry text. Run this when search_journal suggests it, or after writing many journal entries to improve future search quality. Processing may take several seconds per entry.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "days_back": {
                "type": "number",
                "description": "Number of days back to look for undistilled entries (default: 30)"
            },
            "category": {
                "type": "string",
                "enum": ["technical", "reflection", "planning", "learning", "insight", "collaboration", "general"],
                "description": "Optional: only distill entries in this category"
            },
            "limit": {
                "type": "number",
                "description": "Maximum number of entries to distill in one call (default: 50)"
            }
        },
        "required": []
    }
}
```

### Response Format

Includes a nudge about remaining undistilled entries when applicable:

```
Distillation complete.
  Entries found: 47
  Already distilled: 32
  Newly distilled: 12
  Errors: 3

Distilled insights:
  - "Authentication middleware compliance rewrite" (technical)
  - "Debugging approach for pgvector index issues" (technical)
  - "Team dynamics observations from code review" (collaboration)
  ...

Note: 203 older entries remain undistilled. Run with a larger days_back to cover them.
```

The "Note" line appears only when undistilled entries exist outside the processed
date range. It nudges the agent to expand coverage without adding overhead to
the search path.

## Cold-Start Hint

When `search_journal` detects a significant number of undistilled entries, it
includes a hint in the search response to prompt the agent.

### Logic

```typescript
async function getDistillationHint(): Promise<string | null> {
    const result = await query(`
        SELECT count(*) AS undistilled_count,
               extract(day FROM now() - min(je.timestamp))::int AS oldest_days
        FROM ai_memory.journal_entries je
        LEFT JOIN ai_memory.distillation_sources ds ON je.id = ds.entry_id
        WHERE ds.entry_id IS NULL
    `);

    if (result.undistilled_count < 20) return null;

    return `You have ${result.undistilled_count} undistilled journal entries ` +
           `spanning ${result.oldest_days} days. Running distill_entries with ` +
           `days_back: ${result.oldest_days} will extract structured summaries ` +
           `that improve search quality. Consider running it now.`;
}
```

The hint counts entries without distillation source links (LEFT JOIN anti-join),
so it correctly handles partial runs — if only recent entries are distilled,
the hint shows the remaining count. It disappears when fewer than 20 undistilled
entries remain.

The hint is appended after search results (or in place of results if none matched).

## File Organization

```
src/
├── distillation/
│   ├── distillation-service.ts      -- orchestration pipeline
│   ├── category-extraction.ts       -- heuristic section→category mapping
│   └── prompts.ts                   -- prompt templates
├── text-generation-client.ts        -- OpenAI-compatible chat completions client
├── server.ts                        -- (modified) add distill_entries tool, enhance search
├── postgresql-journal-simple.ts     -- (modified) two-query search, category on write
└── ...existing files unchanged
```

## V2 Considerations

Deferred by design meeting consensus — not blocked, not forgotten:

- **Category filter on `search_journal`.** Add optional `category` parameter to
  `search_journal` MCP schema. Both tables have category columns and indexes, so
  this is a WHERE clause addition. Consider `sections` vs `category` filter overlap
  in that design pass to avoid two competing filter mechanisms.
- **Many:1 consolidation.** The `distillation_sources` join table enables multiple
  entries → one synthesized insight. Requires clustering strategy (by project?
  embedding similarity? time window?) and larger LLM context windows.

## Open Questions (for Jerry)

Carried forward from the design meeting report — these don't block V1 implementation
but should be decided eventually:

1. **LLM model choice.** Current default is `llama3.1:8b` locally. Configurable via
   env vars regardless, but quality may vary significantly by model.
2. **Distillation scheduling.** Manual-only via `distill_entries` for now. Cron,
   Claude Code `/schedule`, or background process are future options.
3. **Recall MCP server overlap.** The `recall` server has its own search tool that
   could confuse agents alongside `search_journal`. Unification is a separate concern.
4. **Mnemosyne repo archival.** GitHub archive? Local reference? The spec and design
   meeting report capture what matters.
