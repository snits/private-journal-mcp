# Project-Aware Journal Entries - Design Document

**Date**: 2025-10-20
**Status**: Approved
**Author**: Claude (with Jerry)

## Problem Statement

Multiple agent instances running on different projects simultaneously would get confused about which project they were working on. Agents would read journal entries from other project contexts and try to make changes for one project in another project, or switch working directories incorrectly.

This feature was originally implemented in the file-based version of private-journal-mcp in August 2025, but was lost during the migration to database backends and subsequent refactors (including the mnemosyne search revert).

## Solution Overview

Complete the project-awareness implementation by reconnecting four existing pieces:

1. **Write Path**: Call `ProjectContextDetector` to capture git context during journal writes
2. **Storage**: Store both project name and full JSON context in PostgreSQL
3. **Search Path**: Add WHERE clause filtering by project in search queries
4. **MCP API**: Restore project filtering parameters to tool schemas

## Architecture

### Data Flow

```
User writes thoughts
    ↓
ProjectContextDetector.detectProjectContext(process.cwd())
    ↓
Captures: project name, git remote, branch, language, confidence
    ↓
PostgreSQL stores:
  - project (varchar): "private-journal-mcp"
  - project_context (jsonb): full context object
    ↓
Searches filter by project
    ↓
Results show which project each entry belongs to
```

### Design Decisions

**Storage Approach**: Dedicated `project_context` JSONB column (Approach B)
- Preserves full context (language, confidence, git metadata)
- Allows future filtering by language or other fields
- Negligible storage cost (~300 bytes per entry)
- Clear semantics vs. reusing generic `metadata` column

**Detection Strategy**: Fresh detection on every write
- Ensures accuracy even if git state changes mid-session
- Latency cost negligible (writes are infrequent)
- Uses `process.cwd()` as detection point

**Old Entries**: No backfilling
- NULL project entries appear in unfiltered searches only
- Excluded from project-filtered searches
- Clean separation between historical and new data

## Database Schema Changes

### Migration SQL

```sql
-- Add project_context column for full JSON storage
ALTER TABLE ai_memory.journal_entries
ADD COLUMN project_context jsonb;

-- Add index on project name for filtering performance
CREATE INDEX idx_journal_project
ON ai_memory.journal_entries(project)
WHERE project IS NOT NULL;
```

**Why partial index?** The `WHERE project IS NOT NULL` clause excludes existing NULL entries, making the index smaller and faster.

### Future Indexes (Defer Until Needed)

```sql
-- If we add language filtering
CREATE INDEX idx_journal_language
ON ai_memory.journal_entries((project_context->>'primary_language'));

-- If we need complex JSONB queries
CREATE INDEX idx_journal_project_context_gin
ON ai_memory.journal_entries USING gin(project_context);
```

## Implementation Details

### Write Path Integration

**File**: `src/postgresql-journal-simple.ts`

```typescript
import { ProjectContextDetector } from './project-context.js';

async writeThoughtsToDatabase(...) {
  // Detect project context once per write operation
  const detector = ProjectContextDetector.getInstance();
  const projectContext = await detector.detectProjectContext(process.cwd());

  // Update both INSERT statements (lines 95-113 and 195-221)
  await client.query(`
    INSERT INTO ai_memory.journal_entries (
      content, timestamp, date_string, file_path, entry_type,
      agent_id, model_id, visibility_level,
      embedding_768d, sections, user_id,
      project, project_context  -- NEW
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::vector, $10, $11, $12, $13)
  `,
  [
    // ... existing 11 parameters ...
    projectContext?.project || null,  // $12
    projectContext ? JSON.stringify(projectContext) : null,  // $13
  ]);
}
```

### Search Path Integration

**File**: `src/postgresql-journal-simple.ts`

Update both `searchBySimilarity()` (line 257) and `listRecent()` (line 346):

```typescript
async searchBySimilarity(
  query: string,
  limit: number = 10,
  options?: SearchOptions
): Promise<SearchResult[]> {
  const whereClauses: string[] = [];
  const params: any[] = [embedding, limit];
  let paramIndex = 3;

  // Existing filters (agent_id, model_id, visibility_level, accessible_to_agent)
  // ... keep all existing filter logic ...

  // NEW: Add project filtering
  if (options?.project_filter) {
    if (Array.isArray(options.project_filter)) {
      // Multiple projects: WHERE project IN ('proj1', 'proj2')
      const placeholders = options.project_filter.map(() => `$${paramIndex++}`).join(',');
      whereClauses.push(`project IN (${placeholders})`);
      params.push(...options.project_filter);
    } else if (options.project_filter === 'current') {
      // Current project only - detect and filter
      const detector = ProjectContextDetector.getInstance();
      const currentContext = await detector.detectProjectContext(process.cwd());
      whereClauses.push(`project = $${paramIndex++}`);
      params.push(currentContext?.project || null);
    } else {
      // Single project name
      whereClauses.push(`project = $${paramIndex++}`);
      params.push(options.project_filter);
    }
  }

  const whereClause = whereClauses.length > 0
    ? 'WHERE ' + whereClauses.join(' AND ')
    : '';
}
```

**Results include project**:
```typescript
return rows.map(row => ({
  // ... existing fields ...
  project: row.project,
  project_context: row.project_context ? JSON.parse(row.project_context) : undefined
}));
```

### MCP API Updates

**File**: `src/server.ts`

Restore `project_filter` parameter to `search_journal` tool schema:

```typescript
{
  name: "search_journal",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      limit: { type: "number" },
      agent_id: { type: "string" },
      model_id: { type: "string" },
      visibility_level: { type: "string", enum: ["private", "public", "team", "crb"] },
      accessible_to_agent: { type: "string" },
      // NEW: Add project filtering
      project_filter: {
        type: ["string", "array"],
        description: "Filter by project: 'current' for current project, project name for specific project, or array of project names. Omit to search all projects.",
        items: { type: "string" }
      }
    },
    required: ["query"]
  }
}
```

**Handler passes through to database**:
```typescript
case "search_journal": {
  const { query, limit, agent_id, model_id, visibility_level, accessible_to_agent, project_filter } = args;

  const results = await journalManager.searchBySimilarity(query, limit, {
    agent_id,
    model_id,
    visibility_level,
    accessible_to_agent,
    project_filter  // NEW: Pass through
  });

  return { content: [{ type: "text", text: formatSearchResults(results) }] };
}
```

**Result formatting**:
```typescript
function formatSearchResults(results: SearchResult[]): string {
  return results.map(r =>
    `[${r.project || '(no project)'}] ${r.timestamp}\n${r.content}\n---`
  ).join('\n');
}
```

## Type System Updates

**File**: `src/types.ts`

Restore project filtering parameters to `SearchOptions`:

```typescript
export interface SearchOptions {
  agent_id?: string;
  model_id?: string;
  visibility_level?: VisibilityLevel;
  accessible_to_agent?: string;
  // NEW: Restore these
  project_filter?: 'current' | 'all' | string | string[];
  language_filter?: string;
  exclude_current?: boolean;
  min_relevance?: number;
}
```

Update `SearchResult` to include project:

```typescript
export interface SearchResult {
  content: string;
  timestamp: string;
  similarity?: number;
  agent_id?: string;
  model_id?: string;
  visibility_level?: VisibilityLevel;
  // NEW: Add these
  project?: string;
  project_context?: ProjectContext;
}
```

## Testing Strategy

### Manual Testing

1. **Write with project detection**
   - Start MCP server in a git repository
   - Write journal entry
   - Verify `project` and `project_context` populated in database

2. **Search filtering**
   - Create entries from multiple projects (switch directories)
   - Search with `project_filter: 'current'` - verify only current project results
   - Search with `project_filter: ['proj1', 'proj2']` - verify multiple projects
   - Search without filter - verify all projects including NULL

3. **NULL handling**
   - Verify old entries (NULL project) appear in unfiltered searches
   - Verify old entries excluded from filtered searches

4. **Result display**
   - Verify project name appears in formatted results
   - Verify `(no project)` shown for NULL entries

### Automated Tests (Future)

- Unit tests for `ProjectContextDetector` integration
- Integration tests for database filtering
- MCP tool parameter validation

## Migration Path

1. ✅ **Schema migration**: Run ALTER TABLE and CREATE INDEX
2. ✅ **Code deployment**: Update write path, search path, MCP API
3. ✅ **Verification**: Manual testing of project detection and filtering
4. ⏳ **Monitoring**: Watch for detection failures or performance issues

## Rollback Plan

If issues arise:

1. **Code rollback**: Revert changes to `postgresql-journal-simple.ts` and `server.ts`
2. **Schema rollback** (optional):
   ```sql
   DROP INDEX idx_journal_project;
   ALTER TABLE ai_memory.journal_entries DROP COLUMN project_context;
   ```
3. **Data safety**: Existing entries unchanged, no data loss

## Performance Considerations

**Query Performance**:
- Partial index on `project` WHERE NOT NULL minimizes index size
- Simple string comparison (`project = $1`) is fast
- Array comparison (`project IN (...)`) scales well for small arrays

**Write Performance**:
- Project detection adds ~10-50ms per write (git commands)
- Acceptable for infrequent journal writes
- Singleton pattern with caching minimizes overhead

**Storage Overhead**:
- ~300 bytes per entry for full JSON context
- Negligible for typical usage (thousands of entries)
- JSONB compression reduces actual storage

## Success Criteria

Feature is successful if:

1. ✅ Agents can filter searches to current project only
2. ✅ Search results clearly show which project each entry belongs to
3. ✅ Multiple concurrent agents on different projects don't see cross-contamination
4. ✅ No performance degradation in write or search operations
5. ✅ Old entries (NULL project) handled gracefully

## Open Questions

None - design approved and ready for implementation.

## References

- Original implementation: Commit `026135631432` (August 2025, file-based)
- Project context detection: `src/project-context.ts:26-298`
- Database specialist analysis: Approach B recommendation
- Systems architect validation: Premise confirmed with correct timeline context
