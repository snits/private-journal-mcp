# Distillation Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add LLM-powered insight extraction from journal entries, stored in PostgreSQL with pgvector embeddings, searchable alongside raw entries via the existing `search_journal` tool.

**Architecture:** Journal entries are distilled by an OpenAI-compatible text generation endpoint into structured insights (title, summary, key_insights, category). Distillations live in their own table with embeddings, linked to source entries via a join table. Search runs two parallel pgvector queries (entries + distillations), deduplicates, and merges results. A heuristic category extraction runs on write without LLM involvement.

**Tech Stack:** TypeScript, PostgreSQL + pgvector, OpenAI-compatible APIs (embeddings + chat completions), Vitest

**Spec:** `docs/distillation-spec.md`

---

## File Structure

### New Files
- `src/text-generation-client.ts` — OpenAI-compatible chat completions client (~80 lines)
- `src/distillation/category-extraction.ts` — Heuristic section→category mapping (~30 lines)
- `src/distillation/prompts.ts` — Distillation prompt template (~40 lines)
- `src/distillation/distillation-service.ts` — Orchestration pipeline (~200 lines)
- `sql/003-distillation-schema.sql` — Schema migration
- `tests/category-extraction.test.ts` — Category extraction tests
- `tests/text-generation-client.test.ts` — Text gen client tests
- `tests/distillation-service.test.ts` — Distillation service tests
- `tests/distillation-search.test.ts` — Enhanced search + cold-start hint tests

### Modified Files
- `src/postgresql-journal-simple.ts` — Add distillation search query, merge/dedup, cold-start hint, category on write
- `src/server.ts` — Register `distill_entries` tool, pass pool to distillation service
- `src/private-journal-types.ts` — Add distillation-related types
- `src/response-formatting.ts` — Handle distillation result rendering

---

## Shared Category Taxonomy

Both `journal_entries.category` and `distillations.category` use this set. Define it once, reference everywhere:

```typescript
export const VALID_CATEGORIES = [
  'technical', 'reflection', 'planning',
  'learning', 'insight', 'collaboration', 'general',
] as const;

export type Category = typeof VALID_CATEGORIES[number];
```

---

## Task 1: Schema Migration

**Files:**
- Create: `sql/003-distillation-schema.sql`

- [ ] **Step 1: Write migration SQL**

```sql
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

CREATE INDEX idx_distillations_embedding_768d_hnsw
    ON ai_memory.distillations
    USING hnsw (embedding_768d public.vector_cosine_ops);

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

ALTER TABLE ai_memory.journal_entries
    ADD CONSTRAINT journal_entries_category_valid
        CHECK (category IS NULL OR category IN (
            'technical', 'reflection', 'planning',
            'learning', 'insight', 'collaboration', 'general'
        ));

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
```

- [ ] **Step 2: Apply migration to test database**

Run: `PGPASSWORD=postgres psql -h localhost -U postgres -d mnemosyne_test -f sql/003-distillation-schema.sql`

Expected: No errors. Tables created, column added, backfill runs (0 rows in test DB).

- [ ] **Step 3: Verify schema**

Run: `PGPASSWORD=postgres psql -h localhost -U postgres -d mnemosyne_test -c "\dt ai_memory.distillat*"`

Expected: `distillations` and `distillation_sources` tables listed.

Run: `PGPASSWORD=postgres psql -h localhost -U postgres -d mnemosyne_test -c "SELECT column_name FROM information_schema.columns WHERE table_schema='ai_memory' AND table_name='journal_entries' AND column_name='category'"`

Expected: `category` column listed.

- [ ] **Step 4: Commit**

```bash
git add sql/003-distillation-schema.sql
git commit -s -m "feat: add distillation schema migration

Create distillations and distillation_sources tables, add category
column to journal_entries with backfill from type column."
```

---

## Task 2: Category Extraction

**Files:**
- Create: `src/distillation/category-extraction.ts`
- Create: `tests/category-extraction.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/category-extraction.test.ts
import { extractCategory, VALID_CATEGORIES } from '../src/distillation/category-extraction';

describe('extractCategory', () => {
  describe('section-based extraction', () => {
    test('feelings section maps to reflection', () => {
      expect(extractCategory(['feelings'], null)).toBe('reflection');
    });

    test('project_notes section maps to technical', () => {
      expect(extractCategory(['project_notes'], null)).toBe('technical');
    });

    test('technical_insights section maps to technical', () => {
      expect(extractCategory(['technical_insights'], null)).toBe('technical');
    });

    test('user_context section maps to collaboration', () => {
      expect(extractCategory(['user_context'], null)).toBe('collaboration');
    });

    test('world_knowledge section maps to learning', () => {
      expect(extractCategory(['world_knowledge'], null)).toBe('learning');
    });

    test('first matching section wins', () => {
      expect(extractCategory(['feelings', 'project_notes'], null)).toBe('reflection');
    });

    test('unknown sections fall through to entry type', () => {
      expect(extractCategory(['unknown_section'], 'planning')).toBe('planning');
    });
  });

  describe('entry-type-based extraction', () => {
    test('technical type maps to technical', () => {
      expect(extractCategory(null, 'technical')).toBe('technical');
    });

    test('reflection type maps to reflection', () => {
      expect(extractCategory(null, 'reflection')).toBe('reflection');
    });

    test('planning type maps to planning', () => {
      expect(extractCategory(null, 'planning')).toBe('planning');
    });

    test('insight type maps to insight', () => {
      expect(extractCategory(null, 'insight')).toBe('insight');
    });

    test('debug type maps to technical', () => {
      expect(extractCategory(null, 'debug')).toBe('technical');
    });

    test('learning type maps to learning', () => {
      expect(extractCategory(null, 'learning')).toBe('learning');
    });
  });

  describe('fallback behavior', () => {
    test('null sections and null type returns general', () => {
      expect(extractCategory(null, null)).toBe('general');
    });

    test('empty sections array and null type returns general', () => {
      expect(extractCategory([], null)).toBe('general');
    });

    test('null sections and unknown type returns general', () => {
      expect(extractCategory(null, 'unknown')).toBe('general');
    });

    test('sections take priority over entry type', () => {
      expect(extractCategory(['feelings'], 'technical')).toBe('reflection');
    });
  });

  describe('VALID_CATEGORIES', () => {
    test('contains all expected categories', () => {
      expect(VALID_CATEGORIES).toEqual([
        'technical', 'reflection', 'planning',
        'learning', 'insight', 'collaboration', 'general',
      ]);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/category-extraction.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

```typescript
// src/distillation/category-extraction.ts
// ABOUTME: Heuristic category extraction from journal entry metadata
// ABOUTME: Maps section headers and entry types to a shared category taxonomy

export const VALID_CATEGORIES = [
  'technical', 'reflection', 'planning',
  'learning', 'insight', 'collaboration', 'general',
] as const;

export type Category = typeof VALID_CATEGORIES[number];

const SECTION_TO_CATEGORY: Record<string, Category> = {
  'feelings':            'reflection',
  'project_notes':       'technical',
  'technical_insights':  'technical',
  'user_context':        'collaboration',
  'world_knowledge':     'learning',
};

const ENTRY_TYPE_TO_CATEGORY: Record<string, Category> = {
  'technical':  'technical',
  'reflection': 'reflection',
  'planning':   'planning',
  'insight':    'insight',
  'debug':      'technical',
  'learning':   'learning',
};

/**
 * Extracts a category from entry metadata without LLM involvement.
 * Checks sections first (more specific), then entry type, then defaults to 'general'.
 */
export function extractCategory(sections: string[] | null, entryType: string | null): Category {
  if (sections) {
    for (const section of sections) {
      const category = SECTION_TO_CATEGORY[section];
      if (category) return category;
    }
  }

  if (entryType) {
    const category = ENTRY_TYPE_TO_CATEGORY[entryType];
    if (category) return category;
  }

  return 'general';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/category-extraction.test.ts`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/distillation/category-extraction.ts tests/category-extraction.test.ts
git commit -s -m "feat: add heuristic category extraction

Maps journal section headers and entry types to a shared category
taxonomy (technical, reflection, planning, learning, insight,
collaboration, general). Sections take priority over entry type."
```

---

## Task 3: Text Generation Client

**Files:**
- Create: `src/text-generation-client.ts`
- Create: `tests/text-generation-client.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/text-generation-client.test.ts
import { TextGenerationClient } from '../src/text-generation-client';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

afterEach(() => {
  vi.clearAllMocks();
});

describe('TextGenerationClient', () => {
  describe('constructor', () => {
    test('uses provided config values', () => {
      const client = new TextGenerationClient({
        baseUrl: 'http://test:1234/v1',
        model: 'test-model',
        apiKey: 'test-key',
        timeout: 5000,
      });

      expect(client).toBeDefined();
    });

    test('uses environment variable defaults', () => {
      const originalEnv = { ...process.env };
      process.env.TEXT_GEN_BASE_URL = 'http://env-test:5678/v1';
      process.env.TEXT_GEN_MODEL = 'env-model';
      process.env.TEXT_GEN_API_KEY = 'env-key';

      const client = new TextGenerationClient();
      expect(client).toBeDefined();

      process.env = originalEnv;
    });
  });

  describe('generate', () => {
    test('sends correct request format', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"title": "test"}' } }],
        }),
      });

      const client = new TextGenerationClient({
        baseUrl: 'http://test:1234/v1',
        model: 'test-model',
      });

      await client.generate('test prompt');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://test:1234/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        }),
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.model).toBe('test-model');
      expect(body.messages).toEqual([{ role: 'user', content: 'test prompt' }]);
      expect(body.temperature).toBe(0.3);
      expect(body.max_tokens).toBe(1024);
    });

    test('returns generated text content', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'generated text' } }],
        }),
      });

      const client = new TextGenerationClient({
        baseUrl: 'http://test:1234/v1',
        model: 'test-model',
      });

      const result = await client.generate('prompt');
      expect(result).toBe('generated text');
    });

    test('uses custom temperature and maxTokens', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'result' } }],
        }),
      });

      const client = new TextGenerationClient({
        baseUrl: 'http://test:1234/v1',
        model: 'test-model',
      });

      await client.generate('prompt', { temperature: 0.8, maxTokens: 2048 });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.temperature).toBe(0.8);
      expect(body.max_tokens).toBe(2048);
    });

    test('throws on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      const client = new TextGenerationClient({
        baseUrl: 'http://test:1234/v1',
        model: 'test-model',
      });

      await expect(client.generate('prompt')).rejects.toThrow('Text generation API error (500)');
    });

    test('throws on empty choices', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [] }),
      });

      const client = new TextGenerationClient({
        baseUrl: 'http://test:1234/v1',
        model: 'test-model',
      });

      await expect(client.generate('prompt')).rejects.toThrow('No response content');
    });
  });

  describe('healthCheck', () => {
    test('returns true on ok response', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const client = new TextGenerationClient({
        baseUrl: 'http://test:1234/v1',
        model: 'test-model',
      });

      expect(await client.healthCheck()).toBe(true);
    });

    test('returns false on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const client = new TextGenerationClient({
        baseUrl: 'http://test:1234/v1',
        model: 'test-model',
      });

      expect(await client.healthCheck()).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/text-generation-client.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

```typescript
// src/text-generation-client.ts
// ABOUTME: OpenAI-compatible chat completions client for text generation
// ABOUTME: Used by the distillation service to extract structured insights from journal entries

export interface TextGenerationConfig {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  timeout?: number;
}

export class TextGenerationClient {
  private baseUrl: string;
  private model: string;
  private apiKey: string;
  private timeout: number;

  constructor(config: TextGenerationConfig = {}) {
    this.baseUrl = config.baseUrl || process.env.TEXT_GEN_BASE_URL || 'http://localhost:11434/v1';
    this.model = config.model || process.env.TEXT_GEN_MODEL || 'llama3.1:8b';
    this.apiKey = config.apiKey || process.env.TEXT_GEN_API_KEY || '';
    this.timeout = config.timeout || 60000;
  }

  async generate(prompt: string, options?: {
    temperature?: number;
    maxTokens?: number;
  }): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey && { Authorization: `Bearer ${this.apiKey}` }),
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: prompt }],
          temperature: options?.temperature ?? 0.3,
          max_tokens: options?.maxTokens ?? 1024,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Text generation API error (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;

      if (!content) {
        throw new Error('No response content from text generation API');
      }

      return content;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        method: 'GET',
        ...(this.apiKey && {
          headers: { Authorization: `Bearer ${this.apiKey}` },
        }),
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/text-generation-client.test.ts`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/text-generation-client.ts tests/text-generation-client.test.ts
git commit -s -m "feat: add text generation client for distillation

OpenAI-compatible chat completions client following the pattern of
openai-client.ts. Uses POST /chat/completions with configurable
model, temperature, and timeout. Env vars: TEXT_GEN_BASE_URL,
TEXT_GEN_MODEL, TEXT_GEN_API_KEY."
```

---

## Task 4: Distillation Prompt Template

**Files:**
- Create: `src/distillation/prompts.ts`

- [ ] **Step 1: Write the prompt module**

```typescript
// src/distillation/prompts.ts
// ABOUTME: Prompt templates for LLM-based journal entry distillation
// ABOUTME: Produces structured JSON output with title, summary, key_insights, category

import { VALID_CATEGORIES } from './category-extraction';

export interface DistillationEntry {
  content: string;
  entryType?: string;
  agentId?: string;
  dateString?: string;
  sections?: string[];
}

export function buildDistillationPrompt(entry: DistillationEntry): string {
  const sectionsList = entry.sections?.join(', ') || 'none';
  const categories = VALID_CATEGORIES.join(', ');

  return `You are an expert at distilling journal entries into structured insights.
Analyze the following journal entry and extract the key information.

JOURNAL ENTRY:
"""
${entry.content}
"""

ENTRY METADATA:
- Type: ${entry.entryType ?? 'general'}
- Agent: ${entry.agentId ?? 'unknown'}
- Date: ${entry.dateString ?? 'unknown'}
- Sections: ${sectionsList}

Extract structured insights in JSON format:

{
  "title": "Clear, descriptive title capturing the main insight (10+ characters)",
  "summary": "Concise summary of key content and context (50+ characters)",
  "key_insights": ["Specific, actionable insights (at least 1, 20+ characters each)"],
  "category": "One of: ${categories}"
}

REQUIREMENTS:
- Be specific, avoid vague language
- Focus on actionable insights over general observations
- Use precise language and concrete details
- Ensure insights are distinct and non-repetitive
- Choose the most appropriate category based on content

OUTPUT ONLY VALID JSON.`;
}

/**
 * Strips markdown code fences that LLMs frequently wrap around JSON output.
 */
export function stripCodeFences(raw: string): string {
  return raw.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
}
```

- [ ] **Step 2: Commit**

No tests needed for a template — the distillation service tests will validate prompt construction and code fence stripping.

```bash
git add src/distillation/prompts.ts
git commit -s -m "feat: add distillation prompt template

Structured prompt for LLM-based journal entry distillation.
Produces JSON with title, summary, key_insights, category.
Includes stripCodeFences helper for LLM output cleanup."
```

---

## Task 5: Distillation Types

**Files:**
- Modify: `src/private-journal-types.ts`

- [ ] **Step 1: Add distillation types**

Add at the end of `src/private-journal-types.ts`:

```typescript
// Distillation types
export interface DistillationResult {
  title: string;
  summary: string;
  keyInsights: string[];
  category: string;
}

export interface DistillationSummary {
  entriesFound: number;
  entriesSkipped: number;
  distillationsCreated: number;
  errors: number;
  titles: string[];
}

export interface DistillationOptions {
  daysBack: number;
  category?: string;
  limit?: number;
}

// Discriminated union for merged search results
export interface EntrySearchResult {
  source: 'entry';
  id: number;
  content: string;
  file_path: string;
  entry_type: string;
  sections: string[];
  score: number;
  timestamp: Date;
  agent_id?: string;
  model_id?: string;
  visibility_level?: VisibilityLevel;
  project?: string;
  project_context?: ProjectContext;
  searchable_text?: string;
}

export interface DistillationSearchResult {
  source: 'distillation';
  id: string;
  title: string;
  summary: string;
  key_insights: string[];
  category: string;
  score: number;
  timestamp: Date;
  source_entry_id: number;
  source_entry_path?: string;
}

export type MergedSearchResult = EntrySearchResult | DistillationSearchResult;
```

- [ ] **Step 2: Commit**

```bash
git add src/private-journal-types.ts
git commit -s -m "feat: add distillation and merged search types

DistillationResult, DistillationSummary, DistillationOptions for
the distillation pipeline. EntrySearchResult, DistillationSearchResult,
and MergedSearchResult discriminated union for enhanced search."
```

---

## Task 6: Distillation Service

**Files:**
- Create: `src/distillation/distillation-service.ts`
- Create: `tests/distillation-service.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/distillation-service.test.ts
import { DistillationService } from '../src/distillation/distillation-service';

describe('DistillationService', () => {
  let service: DistillationService;
  let mockPool: any;
  let mockClient: any;
  let mockTextGen: any;
  let mockEmbedding: any;

  beforeEach(() => {
    mockClient = {
      query: vi.fn(),
      release: vi.fn(),
    };
    mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient),
    };
    mockTextGen = {
      generate: vi.fn(),
    };
    mockEmbedding = {
      generateDocumentEmbedding: vi.fn().mockResolvedValue(new Array(768).fill(0.1)),
    };
    service = new DistillationService(mockPool, mockTextGen, mockEmbedding);
  });

  describe('distillEntries', () => {
    test('queries for undistilled entries', async () => {
      // Count query returns 0 skipped
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ cnt: '0' }] })
        .mockResolvedValueOnce({ rows: [] });

      await service.distillEntries({ daysBack: 30 });

      // Second query (undistilled entries) should use LEFT JOIN anti-pattern
      const sql = mockClient.query.mock.calls[1][0];
      expect(sql).toContain('LEFT JOIN ai_memory.distillation_sources');
      expect(sql).toContain('ds.entry_id IS NULL');
    });

    test('skips when no undistilled entries found', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ cnt: '5' }] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await service.distillEntries({ daysBack: 30 });

      expect(result.entriesFound).toBe(5);
      expect(result.entriesSkipped).toBe(5);
      expect(result.distillationsCreated).toBe(0);
      expect(mockTextGen.generate).not.toHaveBeenCalled();
    });

    test('processes undistilled entries and stores results', async () => {
      // Count query: 0 skipped
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ cnt: '0' }] })
        // Undistilled entries query
        .mockResolvedValueOnce({
          rows: [{
            id: 1,
            content: 'Journal entry about debugging postgres',
            type: 'technical',
            agent_id: 'claude-general',
            date_string: '2026-03-15',
            sections: '["project_notes"]',
          }],
        })
        // BEGIN
        .mockResolvedValueOnce({ rows: [] })
        // INSERT distillation
        .mockResolvedValueOnce({ rows: [{ id: 'uuid-123' }] })
        // INSERT distillation_sources
        .mockResolvedValueOnce({ rows: [] })
        // COMMIT
        .mockResolvedValueOnce({ rows: [] })
        // UPDATE embedding
        .mockResolvedValueOnce({ rows: [] });

      mockTextGen.generate.mockResolvedValue(JSON.stringify({
        title: 'PostgreSQL debugging techniques',
        summary: 'Explored connection pooling issues and pg_stat_activity for diagnosing idle connections',
        key_insights: ['Check pg_stat_activity for idle-in-transaction connections'],
        category: 'technical',
      }));

      const result = await service.distillEntries({ daysBack: 30 });

      expect(result.entriesFound).toBe(1);
      expect(result.distillationsCreated).toBe(1);
      expect(result.errors).toBe(0);
      expect(result.titles).toContain('PostgreSQL debugging techniques');
    });

    test('continues on parse failure and increments error count', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ cnt: '0' }] })
        .mockResolvedValueOnce({
        rows: [{
          id: 1,
          content: 'Some entry',
          type: 'general',
          agent_id: null,
          date_string: '2026-03-15',
          sections: null,
        }],
      });

      mockTextGen.generate.mockResolvedValue('not valid json');

      const result = await service.distillEntries({ daysBack: 30 });

      expect(result.entriesFound).toBe(1);
      expect(result.distillationsCreated).toBe(0);
      expect(result.errors).toBe(1);
    });

    test('strips code fences from LLM output', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ cnt: '0' }] })
        .mockResolvedValueOnce({
          rows: [{
            id: 1,
            content: 'Entry content',
            type: 'technical',
            agent_id: null,
            date_string: '2026-03-15',
            sections: null,
          }],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'uuid-456' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      mockTextGen.generate.mockResolvedValue('```json\n{"title":"Test","summary":"A test summary that is long enough","key_insights":["Insight about something specific"],"category":"technical"}\n```');

      const result = await service.distillEntries({ daysBack: 30 });

      expect(result.distillationsCreated).toBe(1);
    });

    test('validates required fields in LLM output', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ cnt: '0' }] })
        .mockResolvedValueOnce({
        rows: [{
          id: 1,
          content: 'Entry',
          type: 'general',
          agent_id: null,
          date_string: '2026-03-15',
          sections: null,
        }],
      });

      // Missing title
      mockTextGen.generate.mockResolvedValue(JSON.stringify({
        summary: 'A summary',
        key_insights: ['An insight'],
        category: 'technical',
      }));

      const result = await service.distillEntries({ daysBack: 30 });

      expect(result.errors).toBe(1);
      expect(result.distillationsCreated).toBe(0);
    });

    test('validates category is in taxonomy', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ cnt: '0' }] })
        .mockResolvedValueOnce({
        rows: [{
          id: 1,
          content: 'Entry',
          type: 'general',
          agent_id: null,
          date_string: '2026-03-15',
          sections: null,
        }],
      });

      mockTextGen.generate.mockResolvedValue(JSON.stringify({
        title: 'Test Title Here',
        summary: 'A summary of the content that is long enough',
        key_insights: ['An actionable insight here'],
        category: 'invalid_category',
      }));

      const result = await service.distillEntries({ daysBack: 30 });

      expect(result.errors).toBe(1);
    });

    test('respects limit option', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ cnt: '0' }] })
        .mockResolvedValueOnce({ rows: [] });

      await service.distillEntries({ daysBack: 30, limit: 5 });

      const params = mockClient.query.mock.calls[0][1];
      expect(params).toContain(5);
    });

    test('respects category filter', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ cnt: '0' }] })
        .mockResolvedValueOnce({ rows: [] });

      await service.distillEntries({ daysBack: 30, category: 'technical' });

      const params = mockClient.query.mock.calls[0][1];
      expect(params).toContain('technical');
    });

    test('continues processing after embedding failure', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ cnt: '0' }] })
        .mockResolvedValueOnce({
          rows: [{
            id: 1,
            content: 'Entry',
            type: 'technical',
            agent_id: null,
            date_string: '2026-03-15',
            sections: null,
          }],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'uuid-789' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      mockTextGen.generate.mockResolvedValue(JSON.stringify({
        title: 'Valid Title Here',
        summary: 'A valid summary that is long enough for validation',
        key_insights: ['A specific insight about something'],
        category: 'technical',
      }));

      mockEmbedding.generateDocumentEmbedding.mockRejectedValue(new Error('Embedding service down'));

      const result = await service.distillEntries({ daysBack: 30 });

      // Distillation created but embedding failed — accepted degraded behavior
      expect(result.distillationsCreated).toBe(1);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/distillation-service.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

```typescript
// src/distillation/distillation-service.ts
// ABOUTME: Orchestrates LLM-based distillation of journal entries into structured insights
// ABOUTME: Queries undistilled entries, builds prompts, calls LLM, stores results with embeddings

import { Pool } from 'pg';
import { TextGenerationClient } from '../text-generation-client';
import { DistillationOptions, DistillationResult, DistillationSummary } from '../private-journal-types';
import { VALID_CATEGORIES, Category } from './category-extraction';
import { buildDistillationPrompt, stripCodeFences, DistillationEntry } from './prompts';

interface EmbeddingService {
  generateDocumentEmbedding(text: string): Promise<number[]>;
}

export class DistillationService {
  private pool: Pool;
  private textGen: TextGenerationClient;
  private embedding: EmbeddingService;
  private model: string;

  constructor(pool: Pool, textGen: TextGenerationClient, embedding: EmbeddingService) {
    this.pool = pool;
    this.textGen = textGen;
    this.embedding = embedding;
    this.model = process.env.TEXT_GEN_MODEL || 'llama3.1:8b';
  }

  async distillEntries(options: DistillationOptions): Promise<DistillationSummary> {
    const { daysBack, category, limit = 50 } = options;

    const { undistilled, skippedCount } = await this.findUndistilledEntries(daysBack, category, limit);

    const summary: DistillationSummary = {
      entriesFound: undistilled.length + skippedCount,
      entriesSkipped: skippedCount,
      distillationsCreated: 0,
      errors: 0,
      titles: [],
    };

    for (const entry of undistilled) {
      try {
        const result = await this.distillEntry(entry);
        await this.storeDistillation(entry.id, result);
        await this.generateAndStoreEmbedding(entry.id, result);
        summary.distillationsCreated++;
        summary.titles.push(result.title);
        console.error(`Distilled entry ${entry.id}: "${result.title}"`);
      } catch (error) {
        summary.errors++;
        console.error(`Failed to distill entry ${entry.id}:`, error);
      }
    }

    return summary;
  }

  private async findUndistilledEntries(
    daysBack: number,
    category: string | undefined,
    limit: number,
  ): Promise<{
    undistilled: Array<{ id: number; content: string; type: string; agent_id: string | null; date_string: string; sections: string | null }>;
    skippedCount: number;
  }> {
    const client = await this.pool.connect();
    try {
      // Count already-distilled entries in the date range
      const countResult = await client.query(
        `SELECT count(*) AS cnt
         FROM ai_memory.journal_entries je
         INNER JOIN ai_memory.distillation_sources ds ON je.id = ds.entry_id
         WHERE je.timestamp >= now() - make_interval(days => $1)
           AND ($2::varchar IS NULL OR je.category = $2)`,
        [daysBack, category ?? null],
      );
      const skippedCount = parseInt(countResult.rows[0].cnt, 10);

      // Find undistilled entries
      const result = await client.query(
        `SELECT je.id, je.content, je.type, je.agent_id, je.date_string, je.sections
         FROM ai_memory.journal_entries je
         LEFT JOIN ai_memory.distillation_sources ds ON je.id = ds.entry_id
         WHERE ds.entry_id IS NULL
           AND je.timestamp >= now() - make_interval(days => $1)
           AND ($2::varchar IS NULL OR je.category = $2)
         ORDER BY je.timestamp ASC
         LIMIT $3`,
        [daysBack, category ?? null, limit],
      );

      return { undistilled: result.rows, skippedCount };
    } finally {
      client.release();
    }
  }

  private async distillEntry(entry: {
    id: number;
    content: string;
    type: string;
    agent_id: string | null;
    date_string: string;
    sections: string | null;
  }): Promise<DistillationResult> {
    const sections = this.parseSections(entry.sections);

    const promptEntry: DistillationEntry = {
      content: entry.content,
      entryType: entry.type,
      agentId: entry.agent_id ?? undefined,
      dateString: entry.date_string,
      sections,
    };

    const prompt = buildDistillationPrompt(promptEntry);
    const raw = await this.textGen.generate(prompt);
    const cleaned = stripCodeFences(raw.trim());
    const parsed = JSON.parse(cleaned);

    this.validateResult(parsed);

    return {
      title: parsed.title,
      summary: parsed.summary,
      keyInsights: parsed.key_insights,
      category: parsed.category,
    };
  }

  private validateResult(parsed: any): void {
    if (!parsed.title || typeof parsed.title !== 'string') {
      throw new Error('Missing or invalid title');
    }
    if (!parsed.summary || typeof parsed.summary !== 'string') {
      throw new Error('Missing or invalid summary');
    }
    if (!Array.isArray(parsed.key_insights) || parsed.key_insights.length === 0) {
      throw new Error('Missing or empty key_insights');
    }
    if (!VALID_CATEGORIES.includes(parsed.category as Category)) {
      throw new Error(`Invalid category: ${parsed.category}`);
    }
  }

  private async storeDistillation(entryId: number, result: DistillationResult): Promise<string> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const insertResult = await client.query(
        `INSERT INTO ai_memory.distillations (title, summary, key_insights, category, model)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [result.title, result.summary, result.keyInsights, result.category, this.model],
      );

      const distillationId = insertResult.rows[0].id;

      await client.query(
        `INSERT INTO ai_memory.distillation_sources (distillation_id, entry_id)
         VALUES ($1, $2)`,
        [distillationId, entryId],
      );

      await client.query('COMMIT');
      return distillationId;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  private async generateAndStoreEmbedding(entryId: number, result: DistillationResult): Promise<void> {
    try {
      const searchableText = `${result.title} ${result.summary} ${result.keyInsights.join(' ')}`;
      const embedding = await this.embedding.generateDocumentEmbedding(searchableText);

      if (embedding.length === 768) {
        const client = await this.pool.connect();
        try {
          // Find the distillation ID for this entry
          const lookup = await client.query(
            `SELECT distillation_id FROM ai_memory.distillation_sources WHERE entry_id = $1 LIMIT 1`,
            [entryId],
          );
          if (lookup.rows.length > 0) {
            const formatted = `[${embedding.join(',')}]`;
            await client.query(
              `UPDATE ai_memory.distillations SET embedding_768d = $1::vector WHERE id = $2`,
              [formatted, lookup.rows[0].distillation_id],
            );
          }
        } finally {
          client.release();
        }
      }
    } catch (error) {
      console.error(`Failed to generate embedding for distillation of entry ${entryId}:`, error);
      // Accepted degraded behavior: distillation exists but unsearchable
    }
  }

  private parseSections(sectionsJson: string | null): string[] | undefined {
    if (!sectionsJson) return undefined;
    try {
      const parsed = JSON.parse(sectionsJson);
      return Array.isArray(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/distillation-service.test.ts`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/distillation/distillation-service.ts tests/distillation-service.test.ts
git commit -s -m "feat: add distillation service

Orchestrates LLM-based distillation pipeline: query undistilled
entries, build prompts, call text generation, validate JSON output,
store results with embeddings. Continues on individual entry
failures. Transaction wraps distillation + source link inserts."
```

---

## Task 7: Enhanced Search — Distillation Query and Merge

**Files:**
- Modify: `src/postgresql-journal-simple.ts`
- Create: `tests/distillation-search.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/distillation-search.test.ts
import { PostgreSQLJournalManager } from '../src/postgresql-journal-simple';

describe('Enhanced search with distillations', () => {
  let manager: PostgreSQLJournalManager;
  let mockClient: any;
  let mockPool: any;

  beforeEach(async () => {
    vi.resetModules();

    const mockGenerateQueryEmbedding = vi.fn().mockResolvedValue(new Array(768).fill(0.1));

    vi.doMock('../src/openai-embedding-service', () => ({
      OpenAIEmbeddingService: {
        getInstance: vi.fn().mockReturnValue({
          generateQueryEmbedding: mockGenerateQueryEmbedding,
          generateDocumentEmbedding: vi.fn().mockResolvedValue(new Array(768).fill(0.1)),
          extractSearchableText: vi.fn().mockReturnValue({ text: 'text', sections: [] }),
        }),
      },
    }));

    const mod = await import('../src/postgresql-journal-simple');
    manager = new mod.PostgreSQLJournalManager();

    mockClient = {
      query: vi.fn(),
      release: vi.fn(),
    };
    mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient),
    };
    (manager as any).pool = mockPool;
  });

  test('searchBySimilarity queries both entries and distillations', async () => {
    // Entry query returns one result
    mockClient.query
      .mockResolvedValueOnce({
        rows: [{
          id: 1,
          content: 'Original entry',
          timestamp: new Date('2026-03-15'),
          file_path: '2026-03-15/14-30-45-123456.md',
          score: 0.85,
          entry_type: 'thoughts',
          sections: '["project_notes"]',
          agent_id: null,
          model_id: null,
          visibility_level: 'private',
          project: 'mnemosyne',
          project_context: null,
          searchable_text: null,
        }],
      })
      // Distillation query returns one result
      .mockResolvedValueOnce({
        rows: [{
          id: 'uuid-dist-1',
          title: 'Distilled insight',
          summary: 'A summary of the insight',
          key_insights: ['insight one'],
          category: 'technical',
          timestamp: new Date('2026-03-15'),
          source_entry_id: 2,
          source_entry_path: '2026-03-15/15-00-00-000000.md',
          score: 0.90,
        }],
      });

    const results = await manager.searchBySimilarity('test query');

    // Should have called connect twice (two queries in parallel)
    // or once with two queries — depends on implementation
    expect(mockClient.query).toHaveBeenCalledTimes(2);

    // First call should be entry query
    const entrySql = mockClient.query.mock.calls[0][0];
    expect(entrySql).toContain('ai_memory.journal_entries');

    // Second call should be distillation query
    const distSql = mockClient.query.mock.calls[1][0];
    expect(distSql).toContain('ai_memory.distillations');
  });

  test('deduplicates when entry and its distillation both match', async () => {
    const entryId = 42;

    // Entry result
    mockClient.query
      .mockResolvedValueOnce({
        rows: [{
          id: entryId,
          content: 'Original',
          timestamp: new Date('2026-03-15'),
          file_path: 'path.md',
          score: 0.80,
          entry_type: 'thoughts',
          sections: '[]',
          agent_id: null,
          model_id: null,
          visibility_level: 'private',
          project: null,
          project_context: null,
          searchable_text: null,
        }],
      })
      // Distillation result for same entry, higher score
      .mockResolvedValueOnce({
        rows: [{
          id: 'uuid-1',
          title: 'Better match',
          summary: 'Summary',
          key_insights: ['insight'],
          category: 'technical',
          timestamp: new Date('2026-03-15'),
          source_entry_id: entryId,
          source_entry_path: 'path.md',
          score: 0.92,
        }],
      });

    const results = await manager.searchBySimilarity('test');

    // Should keep the higher-scoring distillation, drop the entry
    expect(results.length).toBe(1);
    expect((results[0] as any).source).toBe('distillation');
  });

  test('keeps entry when it scores higher than its distillation', async () => {
    const entryId = 42;

    mockClient.query
      .mockResolvedValueOnce({
        rows: [{
          id: entryId,
          content: 'Original',
          timestamp: new Date('2026-03-15'),
          file_path: 'path.md',
          score: 0.95,
          entry_type: 'thoughts',
          sections: '[]',
          agent_id: null,
          model_id: null,
          visibility_level: 'private',
          project: null,
          project_context: null,
          searchable_text: null,
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 'uuid-1',
          title: 'Lower match',
          summary: 'Summary',
          key_insights: ['insight'],
          category: 'technical',
          timestamp: new Date('2026-03-15'),
          source_entry_id: entryId,
          source_entry_path: 'path.md',
          score: 0.70,
        }],
      });

    const results = await manager.searchBySimilarity('test');

    expect(results.length).toBe(1);
    expect((results[0] as any).source).toBe('entry');
  });

  test('merges and sorts by score descending', async () => {
    mockClient.query
      .mockResolvedValueOnce({
        rows: [{
          id: 1,
          content: 'Entry',
          timestamp: new Date('2026-03-15'),
          file_path: 'a.md',
          score: 0.80,
          entry_type: 'thoughts',
          sections: '[]',
          agent_id: null,
          model_id: null,
          visibility_level: 'private',
          project: null,
          project_context: null,
          searchable_text: null,
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 'uuid-1',
          title: 'High scoring',
          summary: 'Summary',
          key_insights: ['insight'],
          category: 'technical',
          timestamp: new Date('2026-03-14'),
          source_entry_id: 99,
          source_entry_path: 'b.md',
          score: 0.95,
        }],
      });

    const results = await manager.searchBySimilarity('test');

    expect(results.length).toBe(2);
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/distillation-search.test.ts`

Expected: FAIL — current searchBySimilarity only queries journal_entries.

- [ ] **Step 3: Implement enhanced search in postgresql-journal-simple.ts**

Modify `searchBySimilarity` to:
1. Run the existing entry query
2. Run a parallel distillation query
3. Merge and deduplicate results

Add private methods `searchDistillations` and `mergeSearchResults` to `PostgreSQLJournalManager`.

The distillation query (add as private method):

```typescript
private async searchDistillations(
  client: PoolClient,
  embeddingParam: string,
  minSimilarity: number,
  limit: number,
): Promise<DistillationSearchResult[]> {
  const sql = `
    SELECT d.id, d.title, d.summary, d.key_insights, d.category,
           d.created_at AS timestamp,
           ds.entry_id AS source_entry_id,
           je.file_path AS source_entry_path,
           1 - (d.embedding_768d <=> $1::vector) AS score
    FROM ai_memory.distillations d
    LEFT JOIN ai_memory.distillation_sources ds ON d.id = ds.distillation_id
    LEFT JOIN ai_memory.journal_entries je ON ds.entry_id = je.id
    WHERE d.embedding_768d IS NOT NULL
      AND (1 - (d.embedding_768d <=> $1::vector)) >= $2
    ORDER BY d.embedding_768d <=> $1::vector
    LIMIT $3
  `;

  const result = await client.query(sql, [embeddingParam, minSimilarity, limit]);

  return result.rows.map((row: any) => ({
    source: 'distillation' as const,
    id: row.id,
    title: row.title,
    summary: row.summary,
    key_insights: row.key_insights,
    category: row.category,
    score: parseFloat(row.score),
    timestamp: new Date(row.timestamp),
    source_entry_id: row.source_entry_id,
    source_entry_path: row.source_entry_path,
  }));
}
```

The merge/dedup method:

```typescript
private mergeSearchResults(
  entryResults: EntrySearchResult[],
  distillationResults: DistillationSearchResult[],
  limit: number,
): MergedSearchResult[] {
  const entryById = new Map(entryResults.map(r => [r.id, r]));
  const keepEntries = [...entryResults];
  const keepDistillations: DistillationSearchResult[] = [];

  for (const dist of distillationResults) {
    const entry = entryById.get(dist.source_entry_id);
    if (entry) {
      if (dist.score > entry.score) {
        // Distillation wins — remove entry
        const idx = keepEntries.findIndex(e => e.id === entry.id);
        if (idx !== -1) keepEntries.splice(idx, 1);
        keepDistillations.push(dist);
      }
      // Else entry wins — skip distillation
    } else {
      keepDistillations.push(dist);
    }
  }

  const merged: MergedSearchResult[] = [...keepEntries, ...keepDistillations];
  merged.sort((a, b) => b.score - a.score);
  return merged.slice(0, limit);
}
```

Update `searchBySimilarity` to call both queries and merge.

Import `MergedSearchResult`, `EntrySearchResult`, `DistillationSearchResult` from `private-journal-types.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/distillation-search.test.ts`

Expected: All tests PASS.

- [ ] **Step 5: Run all existing tests to verify no regressions**

Run: `npx vitest run`

Expected: All passing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/postgresql-journal-simple.ts tests/distillation-search.test.ts
git commit -s -m "feat: add distillation search with merge and dedup

Enhanced searchBySimilarity runs two parallel pgvector queries
(entries + distillations), deduplicates when an entry and its
distillation both match (keeps higher score), merges and sorts
by score descending."
```

---

## Task 8: Response Formatting for Distillations

**Files:**
- Modify: `src/response-formatting.ts`

- [ ] **Step 1: Update normalizeSearchResponse to handle distillation results**

Add rendering for `source: 'distillation'` results in `normalizeSearchResponse`. When a result has `source === 'distillation'`, format it with the `[distillation]` tag showing title, summary, key insights, and category.

The function currently receives `any[]`. After the search changes, it receives `MergedSearchResult[]`. Update the rendering to branch on `result.source`:

```typescript
export function normalizeSearchResponse(results: any[]): any[] {
  return results.map((result) => {
    if (result.source === 'distillation') {
      return {
        score: result.score || 0,
        path: result.source_entry_path || '',
        title: result.title,
        summary: result.summary,
        key_insights: result.key_insights,
        category: result.category,
        timestamp: result.timestamp || new Date(),
        type: 'distillation',
        sections: [],
        source: 'distillation',
        source_entry_id: result.source_entry_id,
      };
    }

    // Existing entry formatting
    const text = result.text || result.content || result.searchable_text || '';
    const contentWithoutFrontmatter = stripFrontmatter(text);
    const excerpt = result.excerpt || (contentWithoutFrontmatter ? contentWithoutFrontmatter.slice(0, 200) : '');

    return {
      score: result.score || result.similarity_score || 0,
      path: result.path || result.file_path || '',
      excerpt,
      text,
      timestamp: result.timestamp || result.created_at || new Date(),
      type: result.type || result.entry_type || 'unknown',
      sections: result.sections || [],
      source: 'entry',
      ...(result.agent_id && { agent_id: result.agent_id }),
      ...(result.model_id && { model_id: result.model_id }),
      ...(result.visibility_level && { visibility_level: result.visibility_level }),
      ...(result.cross_project_warning && { cross_project_warning: result.cross_project_warning }),
      ...(result.project_name && { project_name: result.project_name }),
      ...(result.context_match && { context_match: result.context_match }),
      ...(result.project && { project: result.project }),
      ...(result.project_context && { project_context: result.project_context }),
    };
  });
}
```

- [ ] **Step 2: Update search result rendering in server.ts**

In the `search_journal` handler, update the result formatting to branch on `result.source`:

```typescript
const formatted = results.map((result, i) => {
  if (result.source === 'distillation') {
    return (
      `${i + 1}. [Score: ${result.score.toFixed(3)}] ${result.timestamp.toLocaleDateString()} [distillation]\n` +
      `   Title: ${result.title}\n` +
      `   Summary: ${result.summary}\n` +
      `   Key Insights:\n${result.key_insights.map((k: string) => `     - ${k}`).join('\n')}\n` +
      `   Category: ${result.category}\n` +
      `   Source entry: ${result.path}\n`
    );
  }

  const projectLabel = result.project ? `[${result.project}]` : '[no project]';
  return (
    `${i + 1}. ${projectLabel} [Score: ${result.score.toFixed(3)}] ${result.timestamp.toLocaleDateString()} (${result.type})\n` +
    `   Sections: ${result.sections.join(', ')}\n` +
    `   Path: ${result.path}\n` +
    `   Excerpt: ${result.excerpt}...\n`
  );
}).join('\n');
```

- [ ] **Step 3: Commit**

```bash
git add src/response-formatting.ts src/server.ts
git commit -s -m "feat: add distillation result rendering

normalizeSearchResponse branches on result.source to format
distillation results with title, summary, key insights, and
category. Server search output uses [distillation] tag."
```

---

## Task 9: Register distill_entries MCP Tool

**Files:**
- Modify: `src/server.ts`

- [ ] **Step 1: Add DistillationService to server constructor**

Import and instantiate `DistillationService` in the `PrivateJournalServer` constructor:

```typescript
import { DistillationService } from './distillation/distillation-service';
import { TextGenerationClient } from './text-generation-client';
import { OpenAIEmbeddingService } from './openai-embedding-service';
```

Add as a private field and create in constructor after `this.journalManager`:

```typescript
private distillationService: DistillationService;

// In constructor, after journalManager creation:
const textGen = new TextGenerationClient();
this.distillationService = new DistillationService(
  (this.journalManager as any).pool,
  textGen,
  OpenAIEmbeddingService.getInstance(),
);
```

Note: The pool access requires the manager to be initialized first. Move distillation service creation to `run()` after `initialize()`, or expose the pool. Simplest: create in `run()` after initialize.

- [ ] **Step 2: Register tool definition**

Add to the `tools` array in `ListToolsRequestSchema` handler:

```typescript
{
  name: 'distill_entries',
  description:
    'Extract structured insights from recent journal entries, making them searchable as condensed summaries alongside raw entries. Distilled insights surface patterns and key learnings that may not match raw entry text. Run this when search_journal suggests it, or after writing many journal entries to improve future search quality. Processing may take several seconds per entry.',
  inputSchema: {
    type: 'object',
    properties: {
      days_back: {
        type: 'number',
        description: 'Number of days back to look for undistilled entries (default: 30)',
      },
      category: {
        type: 'string',
        enum: ['technical', 'reflection', 'planning', 'learning', 'insight', 'collaboration', 'general'],
        description: 'Optional: only distill entries in this category',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of entries to distill in one call (default: 50)',
      },
    },
    required: [],
  },
},
```

- [ ] **Step 3: Add tool handler**

Add handler in `CallToolRequestSchema`:

```typescript
if (request.params.name === 'distill_entries') {
  const daysBack = typeof args?.days_back === 'number' ? args.days_back : 30;
  const category = typeof args?.category === 'string' ? args.category : undefined;
  const limit = typeof args?.limit === 'number' ? args.limit : 50;

  try {
    const result = await this.distillationService.distillEntries({
      daysBack,
      category,
      limit,
    });

    const lines = [
      'Distillation complete.',
      `  Entries found: ${result.entriesFound}`,
      `  Already distilled: ${result.entriesSkipped}`,
      `  Newly distilled: ${result.distillationsCreated}`,
      `  Errors: ${result.errors}`,
    ];

    if (result.titles.length > 0) {
      lines.push('', 'Distilled insights:');
      for (const title of result.titles) {
        lines.push(`  - "${title}"`);
      }
    }

    // Check for undistilled entries outside the processed range
    try {
      const hint = await this.journalManager.getDistillationHint();
      if (hint) {
        lines.push('', hint);
      }
    } catch {
      // Non-critical
    }

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    throw new Error(`Failed to distill entries: ${errorMessage}`);
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add src/server.ts
git commit -s -m "feat: register distill_entries MCP tool

Manual trigger for LLM-based distillation. Accepts days_back,
category, and limit parameters. Returns summary with counts
and list of distilled insight titles."
```

---

## Task 10: Cold-Start Hint in Search Results

**Files:**
- Modify: `src/postgresql-journal-simple.ts`
- Modify: `src/server.ts`

- [ ] **Step 1: Add getDistillationHint method to PostgreSQLJournalManager**

```typescript
async getDistillationHint(): Promise<string | null> {
  const client = await this.pool.connect();
  try {
    const result = await client.query(`
      SELECT count(*) AS undistilled_count,
             extract(day FROM now() - min(je.timestamp))::int AS oldest_days
      FROM ai_memory.journal_entries je
      LEFT JOIN ai_memory.distillation_sources ds ON je.id = ds.entry_id
      WHERE ds.entry_id IS NULL
    `);

    const row = result.rows[0];
    const count = parseInt(row.undistilled_count, 10);
    if (count < 20) return null;

    const days = row.oldest_days || 30;
    return `You have ${count} undistilled journal entries spanning ${days} days. ` +
           `Running distill_entries with days_back: ${days} will extract structured ` +
           `summaries that improve search quality. Consider running it now.`;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 2: Append hint to search_journal response in server.ts**

After the search results text, add:

```typescript
// After building the results text
let hint = '';
try {
  const distillationHint = await this.journalManager.getDistillationHint();
  if (distillationHint) {
    hint = `\n\n${distillationHint}`;
  }
} catch {
  // Non-critical — don't fail search for hint
}

return {
  content: [{
    type: 'text',
    text: (results.length > 0 ? formattedResults : 'No relevant entries found.') + hint,
  }],
};
```

- [ ] **Step 3: Commit**

```bash
git add src/postgresql-journal-simple.ts src/server.ts
git commit -s -m "feat: add cold-start distillation hint to search

When search_journal detects 20+ undistilled entries, appends a
hint suggesting distill_entries. Disappears when most entries
are distilled."
```

---

## Task 11: Category on Write

**Files:**
- Modify: `src/postgresql-journal-simple.ts`

- [ ] **Step 1: Import extractCategory**

```typescript
import { extractCategory } from './distillation/category-extraction';
```

- [ ] **Step 2: Add category to writeEntry INSERT**

In `writeEntry`, add `category` to the INSERT columns and compute it:

```typescript
const category = extractCategory(embeddingData.sections, 'general');
```

Add to INSERT statement and params.

- [ ] **Step 3: Add category to writeThoughtsToDatabase INSERT**

In `writeThoughtsToDatabase`, compute category from the sections being written:

```typescript
const sectionNames = Object.keys(thoughts).filter(
  k => !['agent_id', 'model_id', 'visibility_level'].includes(k) && thoughts[k as keyof typeof thoughts]
);
const category = extractCategory(sectionNames, type === 'project' ? 'technical' : null);
```

Add to INSERT statement and params.

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`

Expected: All tests pass. Existing tests may need parameter index updates in their assertions if they verify specific SQL parameter positions.

- [ ] **Step 5: Commit**

```bash
git add src/postgresql-journal-simple.ts
git commit -s -m "feat: assign category on journal entry write

Uses heuristic extraction from section headers and entry type.
Category column populated automatically for all new entries."
```

---

## Task 12: Apply Migration to Production

This task is manual — not automated in the plan.

- [ ] **Step 1: Apply schema migration to production database**

Run on the host machine (not in container):

```bash
PGPASSWORD=postgres psql -h localhost -U postgres -d mnemosyne_prod -f sql/003-distillation-schema.sql
```

- [ ] **Step 2: Verify**

```bash
PGPASSWORD=postgres psql -h localhost -U postgres -d mnemosyne_prod -c "SELECT count(*) FROM ai_memory.distillations"
PGPASSWORD=postgres psql -h localhost -U postgres -d mnemosyne_prod -c "SELECT count(*), category FROM ai_memory.journal_entries GROUP BY category ORDER BY count DESC"
```

---

## Execution Notes

- **No Ollama in container**: Text generation and embedding tests must mock these services. The `project-context-integration.test.ts` failures are pre-existing for the same reason.
- **Test database**: `PGPASSWORD=postgres psql -h localhost -U postgres -d mnemosyne_test` for direct verification.
- **Spec reference**: `docs/distillation-spec.md` for all design decisions and rationale.
- **Return type change**: `searchBySimilarity` changes from returning `SearchResult[]` to `MergedSearchResult[]`. This is a breaking change for any code that assumes the shape — but only `server.ts` and `normalizeSearchResponse` consume it, and both are updated.
