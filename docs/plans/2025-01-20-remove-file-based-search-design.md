# Design: Remove File-Based Search and SQLite Remnants

**Date:** 2025-01-20
**Status:** Approved
**Author:** Claude (with Jerry)

## Context

The private-journal-mcp project migrated from file-based storage with SQLite to PostgreSQL with pgvector over 2 months ago. However, the codebase still contains the complete file-based search infrastructure alongside the PostgreSQL implementation. This creates:

- Dual code paths that increase maintenance burden
- Confusion about which system is actually used
- Large unused dependencies (@xenova/transformers ~200MB)
- Dead code that searches for .embedding files that no longer exist

## Investigation Summary

Specialist agents (database-optimization-specialist, data-pipeline-architect, ai-orchestration-architect, performance-engineer) reviewed the original distillation/ChromaDB proposal and unanimously recommended:

1. **No evidence of search problems** - Recent commits show UX polish, not volume crisis
2. **PostgreSQL can handle the scale** - Current and projected volume is well within capacity
3. **Measure first** - Add instrumentation before building new features
4. **File-based code is broken** - Searches stale/nonexistent data

Analysis revealed:
- All writes go to PostgreSQL exclusively (since ~September 2024)
- File-based SearchService still exists but searches empty/stale directories
- Project-aware search conditionally uses file-based search but finds no data
- No .embedding files have been created in 2+ months

## Design Decision

**Remove the file-based search system entirely** and simplify to PostgreSQL-only architecture.

Project-aware features (project filtering, language filtering) are NOT being used in practice and can be re-implemented properly in PostgreSQL later if needed, using the existing but unused `project` column in the database schema.

## Implementation Plan

### 1. File Deletions

**Complete removal of these files:**

- `src/embeddings.ts` (384 lines)
  - @xenova/transformers-based local embedding service
  - Only used by SearchService
  - Replaced by OpenAIEmbeddingService

- `src/search.ts` (420 lines)
  - File-based SearchService with .embedding file loading
  - Recursively loads embeddings from disk
  - Searches stale/nonexistent data

- `src/project-aware-search.ts` (300+ lines)
  - Wrapper around SearchService
  - Uses fragile path/content heuristics for project detection
  - Features can be rebuilt properly in PostgreSQL later

### 2. Server Code Modifications

**File:** `src/server.ts`

**Remove imports (lines 9-10):**
```typescript
// DELETE:
import { SearchService } from './search';
import { ProjectAwareSearchService } from './project-aware-search';
```

**Remove instance properties (lines 167-168):**
```typescript
// DELETE:
private searchService: SearchService;
private projectAwareSearch: ProjectAwareSearchService;
```

**Remove instantiation (lines 184-185):**
```typescript
// DELETE:
this.searchService = new SearchService(journalPath);
this.projectAwareSearch = new ProjectAwareSearchService(journalPath);
```

**Simplify search_journal tool handler:**

Remove project-aware parameters from tool schema (lines 297-323):
- `project_filter`
- `language_filter`
- `exclude_current`
- `min_relevance` (consider keeping with default 0.6 for future use)

Remove conditional search routing logic (lines 446-487):
```typescript
// DELETE:
const useProjectAwareSearch =
  options.project_filter !== undefined ||
  options.language_filter !== undefined ||
  options.exclude_current ||
  options.min_relevance !== 0.6;

if (useProjectAwareSearch) {
  const rawResults = await this.projectAwareSearch.search(args.query, options);
  // ... formatting ...
} else {
  // Keep this path
}
```

**Retain only PostgreSQL path:**
```typescript
const rawResults = await this.journalManager.searchBySimilarity(args.query, options);
const results = normalizeSearchResponse(rawResults);
// ... return formatted results ...
```

### 3. Dependency Cleanup

**File:** `package.json`

**Remove from dependencies:**
```json
"@xenova/transformers": "^2.17.2",
"chromadb": "^3.0.12"
```

**Rationale:**
- `@xenova/transformers`: Only used by deleted `embeddings.ts`, ~200MB download
- `chromadb`: Was for distillation feature we decided not to build

### 4. Type Cleanup

**Files to audit after main deletions:**

- `src/types.ts` - Remove types only used by deleted SearchService
- `src/parameter-transformation.ts` - Remove transformations only for file-based search
- `src/paths.ts` - Remove file path resolution if only used for file-based storage

**Approach:**
1. Delete the three main files
2. Run TypeScript compiler: `npm run build`
3. Fix any compilation errors from unused imports/types
4. Remove dead code that TypeScript identifies

### 5. Testing Strategy

**Pre-deletion verification:**
1. Confirm all tests pass: `npm test`
2. Document current test coverage

**Post-deletion verification:**
1. Run TypeScript compiler: `npm run build`
2. Fix compilation errors
3. Run full test suite: `npm test`
4. Verify search_journal tool works with PostgreSQL
5. Verify process_thoughts tool still works
6. Manual testing:
   - Write a journal entry
   - Search for it
   - Read it back
   - List recent entries

**Acceptance criteria:**
- All tests pass
- No TypeScript errors
- search_journal returns results from PostgreSQL
- No degradation in search quality
- Reduced bundle size (no @xenova/transformers)

## Future Enhancements

These can be added later if needed:

1. **Project Context Capture**
   - Modify `writeThoughts()` to call `ProjectContextDetector`
   - Store `project`, `primary_language`, `git_branch` in database
   - Enable proper project-based filtering in PostgreSQL queries

2. **Search Analytics**
   - Add instrumentation to track search patterns
   - Measure query performance, result quality, click-through rates
   - Use data to guide future improvements

3. **Advanced Search Features**
   - Temporal decay scoring (boost recent entries)
   - Project-aware search (when project context is captured)
   - Entry importance scoring
   - Search result clustering

## Risks and Mitigations

**Risk:** Breaking project-aware search for users who rely on it
- **Mitigation:** We are the only users; no external users to break
- **Mitigation:** Features aren't working anyway (searching empty data)

**Risk:** Losing functionality that's hard to rebuild
- **Mitigation:** All deleted code is in git history
- **Mitigation:** ProjectContextDetector remains intact for future use
- **Mitigation:** PostgreSQL schema already has `project` column ready

**Risk:** TypeScript errors after deletion
- **Mitigation:** Systematic approach: delete, compile, fix, test
- **Mitigation:** Use TypeScript compiler to identify all affected code

## Success Metrics

- ✓ All tests pass
- ✓ No TypeScript compilation errors
- ✓ Reduced dependencies (2 fewer packages)
- ✓ Reduced codebase (~1100 lines removed)
- ✓ Simpler architecture (single search path)
- ✓ No regression in search functionality
- ✓ PostgreSQL remains sole source of truth

## Timeline

- **File deletions:** 30 minutes
- **Server.ts modifications:** 1 hour
- **Dependency cleanup:** 15 minutes
- **Type cleanup and compilation fixes:** 1-2 hours
- **Testing and verification:** 1 hour
- **Total:** ~4-6 hours

## Approval

Approved by Jerry on 2025-01-20 during design brainstorming session.
