# Parameter Implementation Guide for semantic_search_insights

## ABOUTME: Detailed implementation guide for adding missing search_journal parameters to semantic_search_insights
## ABOUTME: Provides code examples and step-by-step implementation instructions

## Parameter Compatibility Matrix

| Parameter | search_journal | semantic_search_insights | Status | Implementation Priority |
|-----------|---------------|--------------------------|--------|----------------------|
| `query` | ✅ Required | ✅ Required | ✅ Compatible | N/A |
| `limit` | ✅ Optional (default: 10) | ✅ Optional (default: 10, range: 1-100) | ✅ Compatible | N/A |
| `type` | ✅ Optional (default: 'both') | ❌ Missing | 🔴 **CRITICAL** | P0 |
| `sections` | ✅ Optional | ❌ Missing | 🔴 **HIGH** | P0 |
| `agent_id` | ✅ Optional | ❌ Missing | 🔴 **HIGH** | P0 |
| `model_id` | ✅ Optional | ❌ Missing | 🔴 **HIGH** | P0 |
| `visibility_level` | ✅ Optional | ❌ Missing | 🔴 **HIGH** | P0 |
| `accessible_to_agent` | ✅ Optional | ❌ Missing | 🔴 **HIGH** | P0 |
| `project_filter` | ✅ Optional | ❌ Missing | 🔴 **CRITICAL** | P0 |
| `language_filter` | ✅ Optional | ❌ Missing | 🟡 **MEDIUM** | P1 |
| `exclude_current` | ✅ Optional (default: false) | ❌ Missing | 🟡 **MEDIUM** | P1 |
| `min_relevance` | ✅ Optional (default: 0.6) | ❌ Missing* | 🟡 **LOW** | P2 |
| `similarity_threshold` | ❌ N/A | ✅ Optional (default: 0.7) | ✅ Semantic-specific | N/A |
| `quality_threshold` | ❌ N/A | ✅ Optional (default: 0.7) | ✅ Semantic-specific | N/A |
| `category` | ❌ N/A | ✅ Optional | ✅ Semantic-specific | N/A |
| `date_range` | ❌ N/A** | ✅ Optional | 🟡 Different structure | P1 |

*Similar concept exists as `similarity_threshold`
**search_journal uses different `dateRange` structure in SearchOptions

## Priority 0 (P0) - Critical Missing Parameters

### 1. `type` Parameter Implementation

**Purpose**: Controls search scope (project-specific, user-global, or both)

**Implementation in server.ts schema:**
```typescript
type: {
  type: 'string',
  enum: ['project', 'user', 'both'],
  description: 'Search in project-specific notes, user-global notes, or both (default: both)',
  default: 'both',
},
```

**Implementation in SearchInsightsRequest interface:**
```typescript
export interface SearchInsightsRequest {
  // ... existing parameters
  type?: 'project' | 'user' | 'both';
}
```

**Validation logic:**
```typescript
if (request.type !== undefined && !['project', 'user', 'both'].includes(request.type)) {
  errors.push('type must be one of: project, user, both');
}
```

### 2. `sections` Parameter Implementation

**Purpose**: Filter results by journal section types (feelings, project_notes, etc.)

**Implementation in server.ts schema:**
```typescript
sections: {
  type: 'array',
  items: { type: 'string' },
  description: "Filter by section types (e.g., ['feelings', 'technical_insights'])",
},
```

**Implementation in SearchInsightsRequest interface:**
```typescript
export interface SearchInsightsRequest {
  // ... existing parameters
  sections?: string[];
}
```

**Validation logic:**
```typescript
if (request.sections !== undefined) {
  if (!Array.isArray(request.sections)) {
    errors.push('sections must be an array of strings');
  } else if (request.sections.some(section => typeof section !== 'string')) {
    errors.push('all section items must be strings');
  }
}
```

### 3. `agent_id` Parameter Implementation

**Purpose**: Filter results by specific agent identity

**Implementation in server.ts schema:**
```typescript
agent_id: {
  type: 'string',
  description: 'Filter by specific agent identity',
},
```

**Implementation in SearchInsightsRequest interface:**
```typescript
export interface SearchInsightsRequest {
  // ... existing parameters
  agent_id?: string;
}
```

**Validation logic:**
```typescript
if (request.agent_id !== undefined && typeof request.agent_id !== 'string') {
  errors.push('agent_id must be a string');
}
```

### 4. `model_id` Parameter Implementation

**Purpose**: Filter results by specific model identity

**Implementation in server.ts schema:**
```typescript
model_id: {
  type: 'string',
  description: 'Filter by specific model identity',
},
```

**Implementation in SearchInsightsRequest interface:**
```typescript
export interface SearchInsightsRequest {
  // ... existing parameters
  model_id?: string;
}
```

### 5. `visibility_level` Parameter Implementation

**Purpose**: Filter results by visibility level

**Implementation in server.ts schema:**
```typescript
visibility_level: {
  type: 'string',
  enum: ['private', 'public', 'team', 'crb'],
  description: 'Filter by visibility level',
},
```

**Implementation in SearchInsightsRequest interface:**
```typescript
export interface SearchInsightsRequest {
  // ... existing parameters
  visibility_level?: 'private' | 'public' | 'team' | 'crb';
}
```

### 6. `accessible_to_agent` Parameter Implementation

**Purpose**: Show only entries accessible to specific agent (access control)

**Implementation in server.ts schema:**
```typescript
accessible_to_agent: {
  type: 'string',
  description: 'Show only entries accessible to this agent (considers visibility rules)',
},
```

**Implementation in SearchInsightsRequest interface:**
```typescript
export interface SearchInsightsRequest {
  // ... existing parameters
  accessible_to_agent?: string;
}
```

### 7. `project_filter` Parameter Implementation

**Purpose**: Filter by project context (critical for project-aware search)

**Implementation in server.ts schema:**
```typescript
project_filter: {
  oneOf: [
    { type: 'string', enum: ['current', 'all'] },
    { type: 'string' },
    { type: 'array', items: { type: 'string' } },
  ],
  description: "Filter by project context: 'current' (auto-detect), 'all', specific project name(s)",
},
```

**Implementation in SearchInsightsRequest interface:**
```typescript
export interface SearchInsightsRequest {
  // ... existing parameters
  project_filter?: 'current' | 'all' | string | string[];
}
```

**Validation logic:**
```typescript
if (request.project_filter !== undefined) {
  if (typeof request.project_filter === 'string') {
    // Valid string
  } else if (Array.isArray(request.project_filter)) {
    if (request.project_filter.some(item => typeof item !== 'string')) {
      errors.push('all project_filter array items must be strings');
    }
  } else {
    errors.push('project_filter must be a string or array of strings');
  }
}
```

## Priority 1 (P1) - High Impact Missing Parameters

### 8. `language_filter` Parameter Implementation

**Purpose**: Filter by primary programming language

**Implementation in server.ts schema:**
```typescript
language_filter: {
  type: 'string',
  description: 'Filter by primary programming language',
},
```

### 9. `exclude_current` Parameter Implementation

**Purpose**: Exclude current project from results

**Implementation in server.ts schema:**
```typescript
exclude_current: {
  type: 'boolean',
  description: 'Exclude current project from results (default: false)',
  default: false,
},
```

### 10. Date Range Structure Conversion

**Purpose**: Convert between search_journal and semantic_search_insights date formats

**Current search_journal format (SearchOptions):**
```typescript
dateRange?: {
  start?: Date;
  end?: Date;
}
```

**Current semantic_search_insights format:**
```typescript
date_range?: {
  start: string; // ISO date string
  end: string;   // ISO date string  
}
```

**Conversion utility:**
```typescript
private convertDateRange(searchJournalDateRange?: { start?: Date; end?: Date }) {
  if (!searchJournalDateRange) return undefined;
  
  return {
    start: searchJournalDateRange.start?.toISOString(),
    end: searchJournalDateRange.end?.toISOString(),
  };
}
```

## Priority 2 (P2) - Compatibility Parameters

### 11. `min_relevance` Parameter Implementation

**Purpose**: Provide compatibility alias for similarity_threshold

**Implementation approach:**
```typescript
// In parameter processing
const similarity_threshold = request.similarity_threshold || request.min_relevance || 0.7;
```

**Add to SearchInsightsRequest interface:**
```typescript
export interface SearchInsightsRequest {
  // ... existing parameters
  min_relevance?: number; // Compatibility alias for similarity_threshold
}
```

## Complete Updated Interface

**File: `src/semantic-search-tools.ts`**

```typescript
export interface SearchInsightsRequest {
  // Core parameters (existing)
  query: string;
  limit?: number;
  similarity_threshold?: number;
  quality_threshold?: number;
  category?: string;
  date_range?: {
    start: string;
    end: string;
  };
  search_mode?: 'insights_only' | 'hybrid' | 'entries_only';
  
  // NEW: search_journal compatibility parameters
  type?: 'project' | 'user' | 'both';
  sections?: string[];
  agent_id?: string;
  model_id?: string;
  visibility_level?: 'private' | 'public' | 'team' | 'crb';
  accessible_to_agent?: string;
  project_filter?: 'current' | 'all' | string | string[];
  language_filter?: string;
  exclude_current?: boolean;
  min_relevance?: number; // Compatibility alias for similarity_threshold
}
```

## Implementation Steps

### Step 1: Update server.ts Schema (Priority 0)
1. Add all P0 parameters to semantic_search_insights inputSchema
2. Test MCP tool registration with new schema
3. Verify parameter validation works

### Step 2: Update SearchInsightsRequest Interface
1. Add new parameters to interface in semantic-search-tools.ts
2. Update validateSearchInsightsRequest() method
3. Add comprehensive validation for all new parameters

### Step 3: Implement Parameter Processing
1. Update semanticSearchInsights() method to handle new parameters
2. Add parameter mapping logic for each search tier
3. Ensure all tiers (ChromaDB, pgvector, PostgreSQL, FileSystem) handle new parameters

### Step 4: Update Fallback Systems
1. Enhance searchWithFileSystem() to use SearchService with mapped parameters
2. Update SearchOptions interface if needed
3. Implement parameter filtering in database search tiers

### Step 5: Testing
1. Create comprehensive test suite for parameter compatibility
2. Test each parameter individually and in combinations
3. Verify backward compatibility with existing semantic_search_insights usage

## Testing Strategy

### Unit Tests
```typescript
describe('Parameter Compatibility', () => {
  test('should handle all search_journal parameters', () => {
    const searchJournalParams = {
      query: 'test query',
      limit: 5,
      type: 'both',
      sections: ['feelings', 'technical_insights'],
      agent_id: 'code-reviewer',
      model_id: 'claude-sonnet-4',
      visibility_level: 'private',
      accessible_to_agent: 'debug-specialist',
      project_filter: 'current',
      language_filter: 'typescript',
      exclude_current: false,
      min_relevance: 0.6
    };
    
    // Should not throw validation errors
    const result = semanticSearchTools.semanticSearchInsights(searchJournalParams);
    expect(result).toBeDefined();
  });
});
```

### Integration Tests
```typescript
describe('search_journal Replacement', () => {
  test('should produce similar results to search_journal', async () => {
    const query = 'typescript patterns';
    const params = { query, limit: 5, type: 'both' };
    
    const searchJournalResults = await server.searchJournal(params);
    const semanticSearchResults = await server.semanticSearchInsights(params);
    
    // Compare result structures and relevance
    expect(semanticSearchResults.success).toBe(true);
    expect(semanticSearchResults.results.insights.length).toBeGreaterThan(0);
  });
});
```

This implementation guide provides the detailed roadmap for achieving 100% parameter compatibility between search_journal and semantic_search_insights tools.