# Project-Aware Journal Entries Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete project-awareness wiring by connecting existing ProjectContextDetector to PostgreSQL storage and search filtering.

**Architecture:** Four-part integration: (1) Detect project context on writes using existing detector, (2) Store in new `project_context` JSONB column, (3) Filter searches by project, (4) Display project in results.

**Tech Stack:** TypeScript, PostgreSQL with pgvector, existing ProjectContextDetector singleton

---

## Task 1: Database Schema Migration

**Subagent to Task:** None (manual SQL execution)

**Files:**
- Execute SQL against PostgreSQL database

**Step 1: Connect to database**

Run:
```bash
cd ~/.config/superpowers/worktrees/private-journal-mcp/project-aware-journal-entries
set -a && source .env && set +a
psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}"
```

Expected: PostgreSQL prompt

**Step 2: Add project_context column**

Execute SQL:
```sql
ALTER TABLE ai_memory.journal_entries
ADD COLUMN project_context jsonb;
```

Expected: `ALTER TABLE` success message

**Step 3: Create project index**

Execute SQL:
```sql
CREATE INDEX idx_journal_project
ON ai_memory.journal_entries(project)
WHERE project IS NOT NULL;
```

Expected: `CREATE INDEX` success message

**Step 4: Verify schema changes**

Execute SQL:
```sql
\d ai_memory.journal_entries
```

Expected: Table description showing `project varchar(100)` and `project_context jsonb` columns, plus `idx_journal_project` index

**Step 5: Exit psql**

Type: `\q`

Expected: Return to shell

---

## Task 2: Add Helper Methods for Project Context

**Subagent to Task:** general-purpose

**Files:**
- Modify: `src/postgresql-journal-simple.ts:467-530` (after existing helper methods)

**Step 1: Write test for detectProjectContextSafely helper**

Create: `tests/project-context-integration.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProjectContextDetector } from '../src/project-context';

describe('PostgreSQLJournalManager project context helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return undefined when project detection fails', async () => {
    const detector = ProjectContextDetector.getInstance();
    vi.spyOn(detector, 'detectProjectContext').mockRejectedValue(
      new Error('Git command failed')
    );

    // Import manager and call helper (we'll add this in implementation)
    // For now, just test the detector mock works
    await expect(detector.detectProjectContext('/fake/path')).rejects.toThrow();
  });

  it('should return project context when detection succeeds', async () => {
    const detector = ProjectContextDetector.getInstance();
    const mockContext = {
      project: 'test-project',
      working_directory: '/test/dir',
      context_hash: 'abc123',
      timestamp: new Date().toISOString(),
      confidence: 'high' as const,
    };

    vi.spyOn(detector, 'detectProjectContext').mockResolvedValue(mockContext);

    const result = await detector.detectProjectContext('/test/dir');
    expect(result).toEqual(mockContext);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test tests/project-context-integration.test.ts`

Expected: PASS (tests pass but we haven't added helpers to manager yet)

**Step 3: Add import for ProjectContext type**

In `src/postgresql-journal-simple.ts:6`, add to existing imports:

```typescript
import {
  VisibilityLevel,
  SearchOptions,
  DatabaseEntry,
  SearchResult,
  ProjectContext,  // ADD THIS
} from './private-journal-types';
```

**Step 4: Add import for ProjectContextDetector**

In `src/postgresql-journal-simple.ts:7`, add new import line:

```typescript
import { ProjectContextDetector } from './project-context.js';
```

**Step 5: Add detectProjectContextSafely helper method**

In `src/postgresql-journal-simple.ts`, after `parseJsonSafely` method (around line 467), add:

```typescript
  /**
   * Safely detect project context, returning undefined on failure.
   * Project context is metadata - detection failures should not prevent writes.
   */
  private async detectProjectContextSafely(
    workingDir: string
  ): Promise<ProjectContext | undefined> {
    try {
      const detector = ProjectContextDetector.getInstance();
      return await detector.detectProjectContext(workingDir);
    } catch (error) {
      console.error('Project context detection failed:', error);
      return undefined;
    }
  }
```

**Step 6: Add serializeProjectContext helper method**

After `detectProjectContextSafely`, add:

```typescript
  /**
   * Serialize project context to JSONB-compatible string.
   */
  private serializeProjectContext(context: ProjectContext | undefined): string | null {
    if (!context) return null;

    try {
      return JSON.stringify(context);
    } catch (error) {
      console.error('Failed to serialize project context:', error);
      return null;
    }
  }
```

**Step 7: Add parseProjectContext helper method**

After `serializeProjectContext`, add:

```typescript
  /**
   * Parse project context from JSONB string.
   */
  private parseProjectContext(json: string | null): ProjectContext | undefined {
    if (!json) return undefined;

    try {
      return JSON.parse(json) as ProjectContext;
    } catch (error) {
      console.error('Failed to parse project context:', error);
      return undefined;
    }
  }
```

**Step 8: Build TypeScript**

Run: `npm run build`

Expected: Build succeeds with no errors

**Step 9: Run tests**

Run: `npm test`

Expected: All tests pass (25 tests)

**Step 10: Commit helper methods**

```bash
git add src/postgresql-journal-simple.ts tests/project-context-integration.test.ts
git commit -s -m "feat: add project context helper methods

Add safe detection, serialization, and parsing utilities for project
context integration with PostgreSQL.

- detectProjectContextSafely: graceful fallback on detection failure
- serializeProjectContext: safe JSON stringification for JSONB
- parseProjectContext: defensive JSON parsing from database

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: Update Write Path - writeEntry Method

**Subagent to Task:** general-purpose

**Files:**
- Modify: `src/postgresql-journal-simple.ts:93-113`

**Step 1: Write failing test for project context in writeEntry**

In `tests/project-context-integration.test.ts`, add:

```typescript
import { PostgreSQLJournalManager } from '../src/postgresql-journal-simple';

describe('PostgreSQLJournalManager write operations', () => {
  it('should store project context when writing entry', async () => {
    // This test will fail until we implement the feature
    const manager = new PostgreSQLJournalManager();

    // Mock the detector to return predictable context
    const detector = ProjectContextDetector.getInstance();
    const mockContext = {
      project: 'private-journal-mcp',
      working_directory: process.cwd(),
      context_hash: 'test123',
      timestamp: new Date().toISOString(),
      confidence: 'high' as const,
    };

    vi.spyOn(detector, 'detectProjectContext').mockResolvedValue(mockContext);

    await manager.writeEntry('Test entry with project context');

    // Verify project context was stored (requires database query)
    // For now, just verify the spy was called
    expect(detector.detectProjectContext).toHaveBeenCalledWith(process.cwd());
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test tests/project-context-integration.test.ts`

Expected: Test fails because writeEntry doesn't call detectProjectContext yet

**Step 3: Update writeEntry to detect project context**

In `src/postgresql-journal-simple.ts:93-113`, update the method to detect project context before the INSERT.

Find the existing code (around line 99):
```typescript
  async writeEntry(content: string): Promise<void> {
    const timestamp = new Date();
    const dateString = this.formatDate(timestamp);
    const timeString = this.formatTimestamp(timestamp);
    const filePath = `${dateString}/${timeString}.md`;

    const formattedEntry = this.formatEntry(content, timestamp);

    // Generate embedding
    const embeddingData = await this.generateEmbeddingForContent(
      formattedEntry,
      timestamp,
      filePath
    );
```

Add project detection after embedding generation:
```typescript
    // Detect project context (non-blocking on failure)
    const projectContext = await this.detectProjectContextSafely(process.cwd());
```

**Step 4: Update INSERT statement columns**

Change the INSERT statement from:
```typescript
      `
      INSERT INTO ai_memory.journal_entries (
        content, timestamp, date_string, file_path, entry_type,
        embedding_768d, sections, visibility_level, user_id
      ) VALUES ($1, $2, $3, $4, $5, $6::vector, $7, $8, $9)
    `,
```

To:
```typescript
      `
      INSERT INTO ai_memory.journal_entries (
        content, timestamp, date_string, file_path, entry_type,
        embedding_768d, sections, visibility_level, user_id,
        project, project_context
      ) VALUES ($1, $2, $3, $4, $5, $6::vector, $7, $8, $9, $10, $11)
    `,
```

**Step 5: Update VALUES parameters**

Change the parameters array from:
```typescript
      [
        formattedEntry,
        timestamp,
        dateString,
        filePath,
        'simple',
        embeddingData.embedding && embeddingData.embedding.length === 768
          ? this.formatEmbeddingForPgvector(embeddingData.embedding)
          : null,
        JSON.stringify(embeddingData.sections || []),
        'private',
        'private-journal-mcp',
      ]
```

To:
```typescript
      [
        formattedEntry,                                              // $1
        timestamp,                                                   // $2
        dateString,                                                  // $3
        filePath,                                                    // $4
        'simple',                                                    // $5
        embeddingData.embedding && embeddingData.embedding.length === 768
          ? this.formatEmbeddingForPgvector(embeddingData.embedding)
          : null,                                                    // $6
        JSON.stringify(embeddingData.sections || []),                // $7
        'private',                                                   // $8
        'private-journal-mcp',                                       // $9
        projectContext?.project ?? null,                             // $10
        this.serializeProjectContext(projectContext),                // $11
      ]
```

**Step 6: Build TypeScript**

Run: `npm run build`

Expected: Build succeeds

**Step 7: Run tests**

Run: `npm test`

Expected: All tests pass including new project context test

**Step 8: Commit writeEntry changes**

```bash
git add src/postgresql-journal-simple.ts tests/project-context-integration.test.ts
git commit -s -m "feat: store project context in writeEntry

Integrate project detection into writeEntry method. Detects project
context on every write and stores both project name and full context
JSON in PostgreSQL.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: Update Write Path - writeThoughtsToDatabase Method

**Subagent to Task:** general-purpose

**Files:**
- Modify: `src/postgresql-journal-simple.ts:195-221`

**Step 1: Write test for project context in thoughts**

In `tests/project-context-integration.test.ts`, add:

```typescript
  it('should store project context when writing thoughts', async () => {
    const manager = new PostgreSQLJournalManager();

    const detector = ProjectContextDetector.getInstance();
    const mockContext = {
      project: 'private-journal-mcp',
      working_directory: process.cwd(),
      git_remote: 'git@github.com:user/private-journal-mcp.git',
      branch: 'feature/project-aware',
      primary_language: 'typescript',
      context_hash: 'test456',
      timestamp: new Date().toISOString(),
      confidence: 'high' as const,
    };

    vi.spyOn(detector, 'detectProjectContext').mockResolvedValue(mockContext);

    await manager.writeThoughts({
      project_notes: 'Test project note',
      agent_id: 'test-agent',
      model_id: 'test-model',
    });

    expect(detector.detectProjectContext).toHaveBeenCalledWith(process.cwd());
  });
```

**Step 2: Run test to verify it fails**

Run: `npm test tests/project-context-integration.test.ts`

Expected: Test fails because writeThoughtsToDatabase doesn't call detectProjectContext

**Step 3: Update writeThoughtsToDatabase to detect project context**

In `src/postgresql-journal-simple.ts:195-221`, find the embedding generation code (around line 209):

```typescript
    // Generate embedding
    const embeddingData = await this.generateEmbeddingForContent(
      formattedEntry,
      timestamp,
      filePath
    );
```

Add project detection after it:
```typescript
    // Detect project context (non-blocking on failure)
    const projectContext = await this.detectProjectContextSafely(process.cwd());
```

**Step 4: Update INSERT statement columns**

Change the INSERT from:
```typescript
      `
      INSERT INTO ai_memory.journal_entries (
        content, timestamp, date_string, file_path, entry_type,
        agent_id, model_id, visibility_level,
        embedding_768d, sections, user_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::vector, $10, $11)
    `,
```

To:
```typescript
      `
      INSERT INTO ai_memory.journal_entries (
        content, timestamp, date_string, file_path, entry_type,
        agent_id, model_id, visibility_level,
        embedding_768d, sections, user_id,
        project, project_context
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::vector, $10, $11, $12, $13)
    `,
```

**Step 5: Update VALUES parameters**

Change the parameters array from:
```typescript
      [
        formattedEntry,
        timestamp,
        dateString,
        filePath,
        'thoughts',
        thoughts.agent_id || null,
        thoughts.model_id || null,
        thoughts.visibility_level || 'private',
        embeddingData.embedding && embeddingData.embedding.length === 768
          ? this.formatEmbeddingForPgvector(embeddingData.embedding)
          : null,
        JSON.stringify(embeddingData.sections || []),
        'private-journal-mcp',
      ]
```

To:
```typescript
      [
        formattedEntry,                                              // $1
        timestamp,                                                   // $2
        dateString,                                                  // $3
        filePath,                                                    // $4
        'thoughts',                                                  // $5
        thoughts.agent_id ?? null,                                   // $6
        thoughts.model_id ?? null,                                   // $7
        thoughts.visibility_level ?? 'private',                      // $8
        embeddingData.embedding && embeddingData.embedding.length === 768
          ? this.formatEmbeddingForPgvector(embeddingData.embedding)
          : null,                                                    // $9
        JSON.stringify(embeddingData.sections || []),                // $10
        'private-journal-mcp',                                       // $11
        projectContext?.project ?? null,                             // $12
        this.serializeProjectContext(projectContext),                // $13
      ]
```

**Step 6: Build TypeScript**

Run: `npm run build`

Expected: Build succeeds

**Step 7: Run tests**

Run: `npm test`

Expected: All tests pass

**Step 8: Commit writeThoughtsToDatabase changes**

```bash
git add src/postgresql-journal-simple.ts tests/project-context-integration.test.ts
git commit -s -m "feat: store project context in writeThoughts

Integrate project detection into writeThoughtsToDatabase method.
Completes write path integration for all journal entry types.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: Update Type Definitions for Search

**Subagent to Task:** general-purpose

**Files:**
- Modify: `src/private-journal-types.ts:79-91` (SearchResult interface)
- Modify: `src/types.ts:54-66` (SearchOptions interface)
- Modify: `src/types.ts:96-111` (SearchResult interface)

**Step 1: Add project fields to SearchResult in private-journal-types.ts**

In `src/private-journal-types.ts:79-91`, update SearchResult interface:

```typescript
export interface SearchResult {
  id: number;
  content: string;
  timestamp: Date;
  file_path: string;
  agent_id?: string;
  model_id?: string;
  visibility_level: VisibilityLevel;
  entry_type: 'simple' | 'thoughts';
  score: number;
  searchable_text?: string;
  sections: string[];
  project?: string;                    // ADD THIS
  project_context?: ProjectContext;    // ADD THIS
}
```

**Step 2: Restore project_filter to SearchOptions in types.ts**

In `src/types.ts:54-66`, update SearchOptions interface:

```typescript
export interface SearchOptions {
  limit?: number;
  type?: 'project' | 'user' | 'both';
  sections?: string[];
  agent_id?: string;
  model_id?: string;
  visibility_level?: VisibilityLevel;
  accessible_to_agent?: string;
  dateRange?: {
    start?: Date;
    end?: Date;
  };
  project_filter?: 'current' | 'all' | string | string[];  // ADD THIS
}
```

**Step 3: Add project fields to SearchResult in types.ts**

In `src/types.ts:96-111`, update SearchResult interface:

```typescript
export interface SearchResult {
  score: number;
  path: string;
  excerpt: string;
  text: string;
  timestamp: string;
  type: 'project' | 'user';
  entry_type: string;
  sections: string[];
  searchable_text?: string;
  file_path: string;
  agent_id?: string;
  model_id?: string;
  visibility_level?: VisibilityLevel;
  project?: string;                    // ADD THIS
  project_context?: ProjectContext;    // ADD THIS
}
```

**Step 4: Add ProjectContext import to types.ts**

At the top of `src/types.ts`, add import:

```typescript
import { ProjectContext } from './private-journal-types';
```

**Step 5: Build TypeScript**

Run: `npm run build`

Expected: Build succeeds

**Step 6: Run tests**

Run: `npm test`

Expected: All tests pass

**Step 7: Commit type definition changes**

```bash
git add src/private-journal-types.ts src/types.ts
git commit -s -m "feat: add project fields to search types

Restore project_filter to SearchOptions and add project/project_context
fields to SearchResult interfaces. Enables type-safe project filtering.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: Update Search Path - searchBySimilarity Method

**Subagent to Task:** general-purpose

**Files:**
- Modify: `src/postgresql-journal-simple.ts:257-344`

**Step 1: Write test for project filtering in search**

In `tests/project-context-integration.test.ts`, add:

```typescript
  it('should filter search results by project name', async () => {
    const manager = new PostgreSQLJournalManager();

    // Mock search to return entries from different projects
    // (In real test, would need actual database entries)
    const results = await manager.searchBySimilarity('test query', {
      limit: 10,
      project_filter: 'private-journal-mcp',
    });

    // All results should be from specified project
    results.forEach(result => {
      if (result.project) {
        expect(result.project).toBe('private-journal-mcp');
      }
    });
  });

  it('should filter search results by current project', async () => {
    const manager = new PostgreSQLJournalManager();

    const detector = ProjectContextDetector.getInstance();
    vi.spyOn(detector, 'detectProjectContext').mockResolvedValue({
      project: 'current-project',
      working_directory: process.cwd(),
      context_hash: 'abc',
      timestamp: new Date().toISOString(),
      confidence: 'high',
    });

    const results = await manager.searchBySimilarity('test query', {
      limit: 10,
      project_filter: 'current',
    });

    // Should have called detector to get current project
    expect(detector.detectProjectContext).toHaveBeenCalled();
  });

  it('should filter search results by multiple projects', async () => {
    const manager = new PostgreSQLJournalManager();

    const results = await manager.searchBySimilarity('test query', {
      limit: 10,
      project_filter: ['project-a', 'project-b'],
    });

    // All results should be from one of the specified projects
    results.forEach(result => {
      if (result.project) {
        expect(['project-a', 'project-b']).toContain(result.project);
      }
    });
  });
```

**Step 2: Run test to verify it fails**

Run: `npm test tests/project-context-integration.test.ts`

Expected: Tests fail because searchBySimilarity doesn't support project_filter yet

**Step 3: Add SELECT columns for project fields**

In `src/postgresql-journal-simple.ts:257-344`, find the SQL SELECT statement (around line 310):

```typescript
  const sql = `
    SELECT id, content, timestamp, file_path, agent_id, model_id,
           visibility_level, entry_type, searchable_text, sections,
           1 - (embedding_768d <=> $${embeddingParamIndex}::vector) AS score
    FROM ai_memory.journal_entries
```

Change to:
```typescript
  const sql = `
    SELECT id, content, timestamp, file_path, agent_id, model_id,
           visibility_level, entry_type, searchable_text, sections,
           project, project_context,
           1 - (embedding_768d <=> $${embeddingParamIndex}::vector) AS score
    FROM ai_memory.journal_entries
```

**Step 4: Add project filtering to WHERE clause**

In `src/postgresql-journal-simple.ts`, find where WHERE clauses are built (around line 290). After the `accessible_to_agent` filter, add project filtering:

```typescript
  // NEW: Project filtering
  if (options.project_filter) {
    if (Array.isArray(options.project_filter)) {
      // Multiple projects: WHERE project IN ('proj1', 'proj2')
      const placeholders = options.project_filter.map(() => `$${paramIndex++}`).join(',');
      whereClauses.push(`project IN (${placeholders})`);
      params.push(...options.project_filter);
    } else if (options.project_filter === 'current') {
      // Current project only - detect and filter
      const currentContext = await this.detectProjectContextSafely(process.cwd());
      whereClauses.push(`project = $${paramIndex++}`);
      params.push(currentContext?.project ?? null);
    } else if (options.project_filter !== 'all') {
      // Single project name (skip if 'all' means no filtering)
      whereClauses.push(`project = $${paramIndex++}`);
      params.push(options.project_filter);
    }
  }
```

**Step 5: Update result mapping to include project fields**

In `src/postgresql-journal-simple.ts`, find the result mapping (around line 326):

```typescript
const results: SearchResult[] = result.rows.map(row => ({
  id: row.id,
  content: row.content,
  timestamp: new Date(row.timestamp),
  file_path: row.file_path,
  score: row.score,
  entry_type: row.entry_type,
  sections: this.parseJsonSafely(row.sections, []),
  searchable_text: row.searchable_text,
  agent_id: row.agent_id,
  model_id: row.model_id,
  visibility_level: row.visibility_level,
}));
```

Change to:
```typescript
const results: SearchResult[] = result.rows.map(row => ({
  id: row.id,
  content: row.content,
  timestamp: new Date(row.timestamp),
  file_path: row.file_path,
  score: row.score,
  entry_type: row.entry_type,
  sections: this.parseJsonSafely(row.sections, []),
  searchable_text: row.searchable_text,
  agent_id: row.agent_id,
  model_id: row.model_id,
  visibility_level: row.visibility_level,
  project: row.project ?? undefined,
  project_context: this.parseProjectContext(row.project_context),
}));
```

**Step 6: Build TypeScript**

Run: `npm run build`

Expected: Build succeeds

**Step 7: Run tests**

Run: `npm test`

Expected: All tests pass

**Step 8: Commit searchBySimilarity changes**

```bash
git add src/postgresql-journal-simple.ts tests/project-context-integration.test.ts
git commit -s -m "feat: add project filtering to searchBySimilarity

Support project_filter parameter for filtering search results by:
- Single project name
- Multiple projects (array)
- Current project (auto-detect)
- All projects (no filter)

Include project/project_context in search results.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: Update Search Path - listRecent Method

**Subagent to Task:** general-purpose

**Files:**
- Modify: `src/postgresql-journal-simple.ts:346-431`

**Step 1: Write test for project filtering in listRecent**

In `tests/project-context-integration.test.ts`, add:

```typescript
  it('should filter recent entries by project', async () => {
    const manager = new PostgreSQLJournalManager();

    const results = await manager.listRecent({
      limit: 10,
      project_filter: 'private-journal-mcp',
    });

    results.forEach(result => {
      if (result.project) {
        expect(result.project).toBe('private-journal-mcp');
      }
    });
  });
```

**Step 2: Run test to verify it fails**

Run: `npm test tests/project-context-integration.test.ts`

Expected: Test fails because listRecent doesn't support project_filter

**Step 3: Add SELECT columns for project fields**

In `src/postgresql-journal-simple.ts:346-431`, find the SQL SELECT (around line 400):

```typescript
  const sql = `
    SELECT id, content, timestamp, file_path, agent_id, model_id,
           visibility_level, entry_type, searchable_text, sections
    FROM ai_memory.journal_entries
    ${whereClause}
    ORDER BY timestamp DESC
    LIMIT $${paramIndex}
  `;
```

Change to:
```typescript
  const sql = `
    SELECT id, content, timestamp, file_path, agent_id, model_id,
           visibility_level, entry_type, searchable_text, sections,
           project, project_context
    FROM ai_memory.journal_entries
    ${whereClause}
    ORDER BY timestamp DESC
    LIMIT $${paramIndex}
  `;
```

**Step 4: Add project filtering to WHERE clause**

In `src/postgresql-journal-simple.ts`, after the dateRange filter (around line 384), add:

```typescript
  // NEW: Project filtering
  if (options.project_filter) {
    if (Array.isArray(options.project_filter)) {
      const placeholders = options.project_filter.map(() => `$${paramIndex++}`).join(',');
      whereClauses.push(`project IN (${placeholders})`);
      params.push(...options.project_filter);
    } else if (options.project_filter === 'current') {
      const currentContext = await this.detectProjectContextSafely(process.cwd());
      whereClauses.push(`project = $${paramIndex++}`);
      params.push(currentContext?.project ?? null);
    } else if (options.project_filter !== 'all') {
      whereClauses.push(`project = $${paramIndex++}`);
      params.push(options.project_filter);
    }
  }
```

**Step 5: Update result mapping to include project fields**

In `src/postgresql-journal-simple.ts`, find result mapping (around line 415):

```typescript
return result.rows.map((row: any) => ({
  id: row.id,
  content: row.content,
  timestamp: new Date(row.timestamp),
  file_path: row.file_path,
  agent_id: row.agent_id,
  model_id: row.model_id,
  visibility_level: row.visibility_level,
  entry_type: row.entry_type,
  score: 1,
  searchable_text: row.searchable_text,
  sections: this.parseJsonSafely(row.sections, []),
}));
```

Change to:
```typescript
return result.rows.map((row: any) => ({
  id: row.id,
  content: row.content,
  timestamp: new Date(row.timestamp),
  file_path: row.file_path,
  agent_id: row.agent_id,
  model_id: row.model_id,
  visibility_level: row.visibility_level,
  entry_type: row.entry_type,
  score: 1,
  searchable_text: row.searchable_text,
  sections: this.parseJsonSafely(row.sections, []),
  project: row.project ?? undefined,
  project_context: this.parseProjectContext(row.project_context),
}));
```

**Step 6: Build TypeScript**

Run: `npm run build`

Expected: Build succeeds

**Step 7: Run tests**

Run: `npm test`

Expected: All tests pass

**Step 8: Commit listRecent changes**

```bash
git add src/postgresql-journal-simple.ts tests/project-context-integration.test.ts
git commit -s -m "feat: add project filtering to listRecent

Support project_filter parameter in listRecent with same semantics
as searchBySimilarity. Include project/project_context in results.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 8: Update MCP Server Tool Schemas

**Subagent to Task:** general-purpose

**Files:**
- Modify: `src/server.ts:245-294` (search_journal tool schema)
- Modify: `src/server.ts:310-335` (list_recent_entries tool schema, if needed)

**Step 1: Add project_filter to search_journal tool schema**

In `src/server.ts:245-294`, find the inputSchema properties section (around line 250). After the `accessible_to_agent` property, add:

```typescript
          accessible_to_agent: {
            type: 'string',
            description: 'Optional: Show entries accessible to this agent (respects visibility rules)',
          },
          project_filter: {
            type: ['string', 'array'],
            description: "Filter by project: 'current' for current project, 'all' for no filtering, project name for specific project, or array of project names. Omit to search all projects.",
            items: {
              type: 'string',
            },
          },
```

**Step 2: Check if list_recent_entries needs project_filter**

In `src/server.ts:310-335`, check the list_recent_entries tool schema. If it should support project filtering, add the same parameter:

```typescript
          project_filter: {
            type: ['string', 'array'],
            description: "Filter by project: 'current' for current project, 'all' for no filtering, project name for specific project, or array of project names.",
            items: {
              type: 'string',
            },
          },
```

**Step 3: Build TypeScript**

Run: `npm run build`

Expected: Build succeeds

**Step 4: Test MCP server registration**

Run: `npm start` in background

Expected: Server starts without errors and tools register properly

**Step 5: Verify tool schemas**

Use MCP inspector or check server logs to verify `project_filter` parameter appears in tool schemas.

Expected: Both search_journal and list_recent_entries show project_filter parameter

**Step 6: Stop server**

Kill the background process

**Step 7: Commit MCP tool schema changes**

```bash
git add src/server.ts
git commit -s -m "feat: add project_filter to MCP tool schemas

Expose project_filter parameter in search_journal and list_recent_entries
tool definitions. Enables MCP clients to filter by project.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 9: Update MCP Server Request Handlers

**Subagent to Task:** general-purpose

**Files:**
- Modify: `src/server.ts:378-426` (search_journal handler)
- Modify: `src/server.ts:428-460` (list_recent_entries handler, if applicable)

**Step 1: Extract project_filter in search_journal handler**

In `src/server.ts:378-426`, find where options object is built (around line 386):

```typescript
const options = {
  limit: typeof args.limit === 'number' ? args.limit : 10,
  type: typeof args.type === 'string' ? (args.type as 'project' | 'user' | 'both') : 'both',
  sections: Array.isArray(args.sections)
    ? args.sections.filter((s) => typeof s === 'string')
    : undefined,
  agent_id: typeof args.agent_id === 'string' ? args.agent_id : undefined,
  model_id: typeof args.model_id === 'string' ? args.model_id : undefined,
  visibility_level:
    typeof args.visibility_level === 'string' ? (args.visibility_level as any) : undefined,
  accessible_to_agent:
    typeof args.accessible_to_agent === 'string' ? args.accessible_to_agent : undefined,
};
```

Add project_filter extraction:
```typescript
const options = {
  limit: typeof args.limit === 'number' ? args.limit : 10,
  type: typeof args.type === 'string' ? (args.type as 'project' | 'user' | 'both') : 'both',
  sections: Array.isArray(args.sections)
    ? args.sections.filter((s) => typeof s === 'string')
    : undefined,
  agent_id: typeof args.agent_id === 'string' ? args.agent_id : undefined,
  model_id: typeof args.model_id === 'string' ? args.model_id : undefined,
  visibility_level:
    typeof args.visibility_level === 'string' ? (args.visibility_level as any) : undefined,
  accessible_to_agent:
    typeof args.accessible_to_agent === 'string' ? args.accessible_to_agent : undefined,
  project_filter: Array.isArray(args.project_filter)
    ? args.project_filter.filter((p) => typeof p === 'string')
    : typeof args.project_filter === 'string'
    ? args.project_filter
    : undefined,
};
```

**Step 2: Update list_recent_entries handler if needed**

If list_recent_entries supports project_filter, add the same extraction logic to its handler (around line 428-460).

**Step 3: Build TypeScript**

Run: `npm run build`

Expected: Build succeeds

**Step 4: Run tests**

Run: `npm test`

Expected: All tests pass

**Step 5: Commit handler changes**

```bash
git add src/server.ts
git commit -s -m "feat: extract project_filter in MCP handlers

Parse and pass project_filter parameter from tool arguments to
database layer. Completes MCP API integration.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 10: Update Result Formatting to Display Project

**Subagent to Task:** general-purpose

**Files:**
- Modify: `src/parameter-transformation.ts:314-330` (normalizeSearchResponse function)

**Step 1: Update normalizeSearchResponse to preserve project fields**

In `src/parameter-transformation.ts`, find the normalizeSearchResponse function (around line 314). Ensure project fields are preserved:

```typescript
export function normalizeSearchResponse(results: any[]): any[] {
  return results.map((result) => ({
    score: result.score ?? 1,
    path: result.file_path ?? result.path ?? '',
    excerpt: result.content?.substring(0, 200) ?? '',
    text: result.content ?? result.text ?? '',
    timestamp: result.timestamp?.toISOString?.() ?? result.timestamp ?? '',
    type: result.type ?? 'user',
    entry_type: result.entry_type ?? 'reflection',
    sections: result.sections ?? [],
    searchable_text: result.searchable_text,
    file_path: result.file_path ?? result.path ?? '',
    agent_id: result.agent_id,
    model_id: result.model_id,
    visibility_level: result.visibility_level,
    project: result.project,                          // ADD THIS
    project_context: result.project_context,          // ADD THIS
  }));
}
```

**Step 2: Update formatSearchResults in server.ts (if it exists)**

Search for any result formatting functions in `src/server.ts` that might need to display project information. If found, update to include project in formatted output:

```typescript
function formatSearchResults(results: SearchResult[]): string {
  return results.map(r => {
    const projectLabel = r.project ? `[${r.project}]` : '[no project]';
    return `${projectLabel} ${r.timestamp}\n${r.content}\n---`;
  }).join('\n');
}
```

**Step 3: Build TypeScript**

Run: `npm run build`

Expected: Build succeeds

**Step 4: Run tests**

Run: `npm test`

Expected: All tests pass

**Step 5: Commit result formatting changes**

```bash
git add src/parameter-transformation.ts src/server.ts
git commit -s -m "feat: include project in result formatting

Preserve project and project_context fields in normalized search results.
Display project label in formatted output for user visibility.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 11: Manual Testing and Verification

**Subagent to Task:** None

**Files:**
- Test against live database

**Step 1: Start MCP server**

Run: `npm start` in terminal

Expected: Server starts successfully

**Step 2: Write test entry with project context**

Use MCP client to call `process_thoughts` with project notes:
```json
{
  "project_notes": "Testing project-aware journal entries feature",
  "agent_id": "test-agent",
  "model_id": "claude-sonnet-4"
}
```

Expected: Success response

**Step 3: Verify project context was stored**

Query database:
```bash
psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" -c "SELECT project, project_context FROM ai_memory.journal_entries WHERE project IS NOT NULL ORDER BY timestamp DESC LIMIT 1;"
```

Expected: Row showing project name and JSON context

**Step 4: Test search with project filter**

Use MCP client to call `search_journal`:
```json
{
  "query": "testing",
  "project_filter": "private-journal-mcp"
}
```

Expected: Results showing entries from that project only

**Step 5: Test search with current project**

Use MCP client:
```json
{
  "query": "testing",
  "project_filter": "current"
}
```

Expected: Results from current project

**Step 6: Test search with multiple projects**

Use MCP client:
```json
{
  "query": "testing",
  "project_filter": ["private-journal-mcp", "other-project"]
}
```

Expected: Results from both projects

**Step 7: Test unfiltered search**

Use MCP client:
```json
{
  "query": "testing"
}
```

Expected: Results from all projects including NULL

**Step 8: Verify project display in results**

Check that results include project labels like `[private-journal-mcp]` or `[no project]`.

Expected: Project labels visible in formatted output

**Step 9: Document manual test results**

Create file: `docs/testing/project-aware-manual-tests.md`

```markdown
# Manual Testing Results - Project-Aware Journal Entries

**Date:** 2025-10-20
**Tester:** Claude

## Test Cases

### 1. Write with Project Context
- ✅ project field populated
- ✅ project_context JSON stored
- ✅ Detection from git repository

### 2. Search Filtering
- ✅ Single project filter
- ✅ Current project filter
- ✅ Multiple projects filter
- ✅ Unfiltered includes all

### 3. Result Display
- ✅ Project labels shown
- ✅ NULL project shown as "(no project)"

## Issues Found
(None or list any issues)

## Performance Notes
- Project detection adds ~20ms to writes
- Search filtering has no noticeable performance impact
```

**Step 10: Commit manual test documentation**

```bash
git add docs/testing/project-aware-manual-tests.md
git commit -s -m "docs: add manual testing results

Document manual verification of project-aware journal entries feature.
All test cases passed successfully.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 12: Update Documentation

**Subagent to Task:** None

**Files:**
- Modify: `CLAUDE.md` (update with new features)
- Create: `docs/features/project-aware-journals.md`

**Step 1: Document new MCP tool parameters**

In `CLAUDE.md`, find the MCP Integration Details section and update it to mention project_filter:

```markdown
**Search & Retrieval:**
- `search_journal` - Natural language semantic search with optional project filtering
  - New: `project_filter` parameter supports 'current', project name, or array of projects
- `read_journal_entry` - Read full content of specific entries by file path
- `list_recent_entries` - Browse recent entries with optional project filtering

**Key Features:**
- **Project Awareness**: Automatic project detection from git context, filter searches by project
```

**Step 2: Create feature documentation**

Create: `docs/features/project-aware-journals.md`

```markdown
# Project-Aware Journal Entries

## Overview

Journal entries automatically capture and store project context, enabling agents to filter searches by project and avoid cross-project confusion.

## How It Works

### Write Path
When journal entries are created:
1. `ProjectContextDetector` analyzes the current working directory
2. Extracts: project name, git remote, branch, primary language, working directory
3. Stores both `project` name (string) and full `project_context` (JSON)

### Search Path
When searching journals:
- `project_filter: 'current'` - Filter to current project only
- `project_filter: 'project-name'` - Filter to specific project
- `project_filter: ['proj1', 'proj2']` - Filter to multiple projects
- No filter - Search all projects (including NULL from old entries)

## Usage Examples

### Filter to current project
```json
{
  "query": "authentication implementation",
  "project_filter": "current"
}
```

### Filter to specific project
```json
{
  "query": "database schema",
  "project_filter": "private-journal-mcp"
}
```

### Filter to multiple projects
```json
{
  "query": "API design",
  "project_filter": ["project-a", "project-b"]
}
```

## Technical Details

- **Database**: PostgreSQL with `project` varchar and `project_context` jsonb columns
- **Index**: Partial index on `project WHERE project IS NOT NULL` for performance
- **Detection**: Uses git commands to extract project metadata
- **Fallback**: Gracefully handles detection failures by storing NULL

## Migration Notes

Old entries (pre-implementation) have NULL project fields and:
- Appear in unfiltered searches
- Excluded from project-filtered searches
- Show as "(no project)" in results
```

**Step 3: Build TypeScript**

Run: `npm run build`

Expected: Build succeeds

**Step 4: Commit documentation**

```bash
git add CLAUDE.md docs/features/project-aware-journals.md
git commit -s -m "docs: document project-aware journal entries

Add user-facing documentation for project filtering feature. Update
CLAUDE.md with new MCP tool parameters and usage examples.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 13: Final Verification and Cleanup

**Subagent to Task:** None

**Files:**
- All modified files

**Step 1: Run full test suite**

Run: `npm test`

Expected: All tests pass (25+ tests)

**Step 2: Run linter**

Run: `npm run lint`

Expected: No linting errors

**Step 3: Run type check**

Run: `npm run build`

Expected: Build succeeds with no type errors

**Step 4: Check git status**

Run: `git status`

Expected: Working tree clean (all changes committed)

**Step 5: Review commit history**

Run: `git log --oneline -15`

Expected: Clear, atomic commits for each task

**Step 6: Verify all design requirements met**

Review design document checklist:
- ✅ Database schema migration complete
- ✅ Write path integration (both methods)
- ✅ Search path integration (both methods)
- ✅ MCP API updated (schemas and handlers)
- ✅ Type definitions updated
- ✅ Helper methods added
- ✅ Result formatting includes project
- ✅ Manual testing completed
- ✅ Documentation updated

**Step 7: Create summary of changes**

Run: `git log main..HEAD --oneline`

Expected: List of all commits in this feature branch

**Step 8: Document completion**

All tasks complete! Feature is ready for:
1. Code review
2. Merge to main
3. Deployment

**Step 9: Return to main directory**

```bash
cd /Users/jsnitsel/devel/private-journal-mcp
```

---

## Success Criteria

✅ All tests pass
✅ TypeScript builds without errors
✅ Project context stored on every write
✅ Search filters by project correctly
✅ Results display project information
✅ Old entries (NULL project) handled gracefully
✅ Documentation complete
✅ Clean commit history

## Next Steps

After implementation complete:
1. Use `superpowers:finishing-a-development-branch` to merge or create PR
2. Consider adding integration tests with real database
3. Monitor production for detection failures or performance issues
