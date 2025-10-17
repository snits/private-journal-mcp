# Parameter Schema Compatibility Analysis

## ABOUTME: Comprehensive analysis of parameter differences between search_journal and semantic_search_insights tools
## ABOUTME: Identifies compatibility gaps and provides implementation roadmap for seamless tool replacement

## Executive Summary

This analysis compares parameter schemas between the existing `search_journal` tool and the new `semantic_search_insights` tool to ensure 100% compatibility for seamless tool replacement. **Critical gaps identified**: semantic_search_insights is missing 8 of 13 core search parameters, creating significant compatibility issues.

## Tool Parameter Schema Comparison

### search_journal Parameters (Complete Schema)

**Core Parameters:**
- `query` (string, required) - Natural language search query
- `limit` (number, default: 10) - Maximum number of results
- `type` (enum: 'project'|'user'|'both', default: 'both') - Search scope

**Filtering Parameters:**
- `sections` (array of strings) - Filter by section types
- `agent_id` (string) - Filter by specific agent identity
- `model_id` (string) - Filter by specific model identity
- `visibility_level` (enum: 'private'|'public'|'team'|'crb') - Filter by visibility level
- `accessible_to_agent` (string) - Show only entries accessible to this agent

**Project Context Parameters:**
- `project_filter` (oneOf: enum['current','all'] | string | array) - Filter by project context
- `language_filter` (string) - Filter by primary programming language
- `exclude_current` (boolean, default: false) - Exclude current project from results
- `min_relevance` (number, default: 0.6, range: 0.0-1.0) - Minimum relevance score

**Total Parameters:** 13 (1 required, 12 optional)

### semantic_search_insights Parameters (Current Schema)

**Core Parameters:**
- `query` (string, required) - Natural language query
- `limit` (number, default: 10, range: 1-100) - Maximum number of results

**Semantic-Specific Parameters:**
- `similarity_threshold` (number, default: 0.7, range: 0.0-1.0) - Minimum similarity score
- `quality_threshold` (number, default: 0.7, range: 0.0-1.0) - Minimum quality score

**Basic Filtering Parameters:**
- `category` (string) - Filter by insight category
- `date_range` (object with start/end ISO dates) - Filter by date range

**Total Parameters:** 6 (1 required, 5 optional)

## Compatibility Gap Analysis

### Missing Parameters in semantic_search_insights

| Parameter | Type | Impact | Migration Risk |
|-----------|------|--------|----------------|
| `type` | enum | **CRITICAL** | High - Core search scope functionality |
| `sections` | array | **HIGH** | High - Section filtering is heavily used |
| `agent_id` | string | **HIGH** | Medium - Agent-specific searches |
| `model_id` | string | **HIGH** | Medium - Model-specific searches |
| `visibility_level` | enum | **HIGH** | High - Security/privacy filtering |
| `accessible_to_agent` | string | **HIGH** | High - Access control functionality |
| `project_filter` | oneOf | **CRITICAL** | High - Project context essential |
| `language_filter` | string | **MEDIUM** | Medium - Programming language filtering |
| `exclude_current` | boolean | **MEDIUM** | Medium - Project isolation |
| `min_relevance` | number | **LOW** | Low - Similar to similarity_threshold |

### Type Differences

| Parameter | search_journal Type | semantic_search_insights Type | Compatibility |
|-----------|---------------------|------------------------------|---------------|
| `limit` | number (no range) | number (1-100) | Compatible with validation |
| Date filtering | `dateRange: {start?, end?}` | `date_range: {start, end}` | **INCOMPATIBLE** - Different structure |
| Relevance filtering | `min_relevance` (0.0-1.0) | `similarity_threshold` (0.0-1.0) | Similar concept, different name |

### Parameter Mapping Requirements

#### Direct Mappings (No Changes Needed)
- `query` → `query` (identical)
- `limit` → `limit` (add range validation)

#### Semantic Mappings (Parameter Name/Structure Changes)
- `min_relevance` → `similarity_threshold` (similar concepts)
- `dateRange` → `date_range` (structure conversion needed)

#### Missing Mappings (New Parameters Needed)
- Add: `type`, `sections`, `agent_id`, `model_id`, `visibility_level`
- Add: `accessible_to_agent`, `project_filter`, `language_filter`, `exclude_current`

## Response Format Differences

### search_journal Response Format
```typescript
// Text-based response with formatted entries
{
  content: [{
    type: 'text',
    text: `Found ${results.length} relevant entries:\n\n${formatted_results}`
  }]
}
```

### semantic_search_insights Response Format
```typescript
// JSON-structured response with metadata
{
  content: [{
    type: 'text', 
    text: JSON.stringify({
      success: boolean,
      results?: {
        insights: DistilledInsight[],
        metadata: {
          total_insights: number,
          avg_quality_score: number,
          avg_similarity_score: number,
          search_duration_ms: number,
          search_mode: string,
          search_tier?: string
        }
      },
      error?: string
    }, null, 2)
  }]
}
```

**Compatibility Impact:** Different response structures will break client code expecting search_journal format.

## Validation Gap Analysis

### search_journal Validation (Current)
- Basic type checking in server.ts
- No range validation on numeric parameters
- String validation for enums in schema

### semantic_search_insights Validation (Current)
- Comprehensive validation in SemanticSearchTools.validateSearchInsightsRequest()
- Range validation for limit (1-100), similarity_threshold (0.0-1.0), quality_threshold (0.0-1.0)
- Required field validation

**Gap:** semantic_search_insights has stronger validation but missing validation for the 8 missing parameters.

## Implementation Roadmap

### Phase 1: Parameter Schema Enhancement (User Story 1.2)

#### 1.1 Add Missing Core Parameters
```typescript
interface SearchInsightsRequest {
  // Existing parameters
  query: string;
  limit?: number;
  similarity_threshold?: number;
  quality_threshold?: number;
  category?: string;
  date_range?: { start: string; end: string; };
  
  // NEW: Add missing parameters
  type?: 'project' | 'user' | 'both';
  sections?: string[];
  agent_id?: string;
  model_id?: string;
  visibility_level?: 'private' | 'public' | 'team' | 'crb';
  accessible_to_agent?: string;
  project_filter?: 'current' | 'all' | string | string[];
  language_filter?: string;
  exclude_current?: boolean;
  min_relevance?: number; // Alias for similarity_threshold
}
```

#### 1.2 Enhance Parameter Validation
- Extend `validateSearchInsightsRequest()` with validation for all new parameters
- Add enum validation for `type`, `visibility_level`
- Add range validation for `min_relevance`
- Add type validation for `project_filter` oneOf schema

#### 1.3 Parameter Mapping Logic
```typescript
private mapSearchJournalParams(request: any): SearchInsightsRequest {
  return {
    // Direct mappings
    query: request.query,
    limit: request.limit,
    
    // Semantic mappings
    similarity_threshold: request.min_relevance || request.similarity_threshold,
    
    // New parameter passthrough
    type: request.type,
    sections: request.sections,
    agent_id: request.agent_id,
    model_id: request.model_id,
    visibility_level: request.visibility_level,
    accessible_to_agent: request.accessible_to_agent,
    project_filter: request.project_filter,
    language_filter: request.language_filter,
    exclude_current: request.exclude_current,
    
    // Date range conversion
    date_range: request.dateRange ? {
      start: request.dateRange.start?.toISOString(),
      end: request.dateRange.end?.toISOString()
    } : undefined
  };
}
```

### Phase 2: Response Format Alignment

#### 2.1 Add Response Format Option
- Add `response_format?: 'json' | 'text'` parameter to semantic_search_insights
- Default to 'json' for semantic compatibility
- Support 'text' format for search_journal compatibility

#### 2.2 Implement Response Format Converter
```typescript
private formatResponse(results: SearchInsightsResponse, format: 'json' | 'text' = 'json') {
  if (format === 'text') {
    // Convert to search_journal text format
    return this.convertToTextFormat(results);
  }
  return JSON.stringify(results, null, 2);
}
```

### Phase 3: Fallback System Enhancement

#### 3.1 Integrate Missing Parameters into Tier 4 (File System) Fallback
- Update `searchWithFileSystem()` to use SearchService with all mapped parameters
- Ensure SearchOptions interface supports all required parameters

#### 3.2 Update Tier 3 (PostgreSQL Text Search) Parameter Handling
- Implement filtering logic for all new parameters in database queries
- Add SQL query building for complex parameter combinations

### Phase 4: Testing and Validation

#### 4.1 Parameter Compatibility Tests
- Test all search_journal parameters work with semantic_search_insights
- Validate parameter validation edge cases
- Test parameter combinations

#### 4.2 Response Format Compatibility Tests
- Verify text format matches search_journal exactly
- Test JSON format maintains semantic search capabilities

## Risk Assessment

### High Risk Items
1. **Type System Changes**: Adding 8 new parameters changes the interface significantly
2. **Date Range Structure**: Different object structure requires careful conversion
3. **Response Format**: Different response structures could break existing clients
4. **Validation Complexity**: New validation rules increase complexity

### Mitigation Strategies
1. **Backward Compatibility**: Support both parameter formats during transition
2. **Default Values**: Provide sensible defaults for all new parameters
3. **Comprehensive Testing**: Test all parameter combinations and edge cases
4. **Documentation**: Update MCP tool schema documentation

## Conclusion

The semantic_search_insights tool requires significant parameter schema enhancement to achieve compatibility with search_journal. The missing 8 parameters represent critical functionality gaps that must be addressed. The implementation roadmap provides a systematic approach to achieving 100% parameter compatibility while maintaining the enhanced semantic search capabilities.

**Recommendation**: Proceed with Phase 1 implementation immediately, as the parameter gaps present a major blocker for tool replacement.