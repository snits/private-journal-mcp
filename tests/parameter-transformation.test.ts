// ABOUTME: Test suite for parameter transformation utilities
// ABOUTME: Validates conversion between search_journal and semantic_search_insights formats

import { 
  transformToSemanticSearchParams, 
  transformFromSemanticSearchParams, 
  validateSemanticSearchParams,
  hasProjectAwareParams,
  toSearchInsightsRequest,
  normalizeSearchResponse 
} from '../src/parameter-transformation';
import { SearchOptions, SemanticSearchInsightsParams } from '../src/types';

describe('Parameter Transformation', () => {
  describe('transformToSemanticSearchParams', () => {
    it('should convert basic search options to semantic search params', () => {
      const searchOptions: SearchOptions = {
        limit: 5,
        type: 'project',
        sections: ['feelings', 'technical_insights'],
        agent_id: 'code-reviewer',
        model_id: 'claude-sonnet-4',
        visibility_level: 'private'
      };

      const result = transformToSemanticSearchParams('test query', searchOptions);

      expect(result.query).toBe('test query');
      expect(result.limit).toBe(5);
      expect(result.type).toBe('project');
      expect(result.sections).toEqual(['feelings', 'technical_insights']);
      expect(result.agent_id).toBe('code-reviewer');
      expect(result.model_id).toBe('claude-sonnet-4');
      expect(result.visibility_level).toBe('private');
    });

    it('should convert dateRange to date_range with ISO strings', () => {
      const searchOptions: SearchOptions = {
        dateRange: {
          start: new Date('2023-01-01T00:00:00Z'),
          end: new Date('2023-12-31T23:59:59Z')
        }
      };

      const result = transformToSemanticSearchParams('test query', searchOptions);

      expect(result.date_range).toEqual({
        start: '2023-01-01T00:00:00.000Z',
        end: '2023-12-31T23:59:59.000Z'
      });
    });

    it('should handle project-aware parameters', () => {
      const searchOptions: SearchOptions = {
        project_filter: 'current',
        language_filter: 'typescript',
        exclude_current: true,
        min_relevance: 0.8
      };

      const result = transformToSemanticSearchParams('test query', searchOptions);

      expect(result.project_filter).toBe('current');
      expect(result.language_filter).toBe('typescript');
      expect(result.exclude_current).toBe(true);
      expect(result.min_relevance).toBe(0.8);
    });
  });

  describe('transformFromSemanticSearchParams', () => {
    it('should convert semantic search params back to search options', () => {
      const params: SemanticSearchInsightsParams = {
        query: 'test query',
        limit: 10,
        type: 'both',
        sections: ['project_notes'],
        agent_id: 'debug-specialist',
        date_range: {
          start: '2023-06-01T00:00:00Z',
          end: '2023-06-30T23:59:59Z'
        }
      };

      const result = transformFromSemanticSearchParams(params);

      expect(result.limit).toBe(10);
      expect(result.type).toBe('both');
      expect(result.sections).toEqual(['project_notes']);
      expect(result.agent_id).toBe('debug-specialist');
      expect(result.dateRange?.start).toEqual(new Date('2023-06-01T00:00:00Z'));
      expect(result.dateRange?.end).toEqual(new Date('2023-06-30T23:59:59Z'));
    });
  });

  describe('validateSemanticSearchParams', () => {
    it('should validate valid parameters', () => {
      const params = {
        query: 'test query',
        limit: 15,
        similarity_threshold: 0.8,
        quality_threshold: 0.7,
        type: 'project',
        sections: ['feelings', 'technical_insights'],
        visibility_level: 'private',
        exclude_current: false,
        min_relevance: 0.6
      };

      const result = validateSemanticSearchParams(params);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.sanitized).toBeDefined();
      expect(result.sanitized!.query).toBe('test query');
    });

    it('should reject missing query', () => {
      const params = { limit: 10 };

      const result = validateSemanticSearchParams(params);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('query is required and must be a string');
    });

    it('should reject empty query', () => {
      const params = { query: '' };

      const result = validateSemanticSearchParams(params);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('query cannot be empty or only whitespace');
    });

    it('should reject whitespace-only query', () => {
      const params = { query: '   \t\n  ' };

      const result = validateSemanticSearchParams(params);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('query cannot be empty or only whitespace');
    });

    it('should reject invalid limit', () => {
      const params = { query: 'test', limit: 150 };

      const result = validateSemanticSearchParams(params);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('limit must be an integer between 1 and 100');
    });

    it('should reject invalid threshold values', () => {
      const params = { 
        query: 'test', 
        similarity_threshold: 1.5,
        quality_threshold: -0.1,
        min_relevance: 2.0
      };

      const result = validateSemanticSearchParams(params);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('similarity_threshold must be a number between 0 and 1');
      expect(result.errors).toContain('quality_threshold must be a number between 0 and 1');
      expect(result.errors).toContain('min_relevance must be a number between 0 and 1');
    });

    it('should reject invalid enum values', () => {
      const params = { 
        query: 'test', 
        type: 'invalid',
        visibility_level: 'wrong'
      };

      const result = validateSemanticSearchParams(params);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('type must be one of: project, user, both');
      expect(result.errors).toContain('visibility_level must be one of: private, public, team, crb');
    });

    it('should validate date range format', () => {
      const params = { 
        query: 'test',
        date_range: {
          start: 'invalid-date',
          end: '2023-12-31T23:59:59Z'
        }
      };

      const result = validateSemanticSearchParams(params);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('date_range.start must be a valid ISO date string');
    });

    it('should reject date range where start is after end', () => {
      const params = { 
        query: 'test',
        date_range: {
          start: '2023-12-31T23:59:59Z',
          end: '2023-01-01T00:00:00Z'
        }
      };

      const result = validateSemanticSearchParams(params);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('date_range.start must be earlier than date_range.end');
    });

    it('should validate string parameters and reject empty values', () => {
      const params = { 
        query: 'test',
        category: '   ',
        agent_id: '',
        model_id: '\t\n',
        accessible_to_agent: '  ',
        language_filter: ''
      };

      const result = validateSemanticSearchParams(params);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('category cannot be empty or only whitespace');
      expect(result.errors).toContain('agent_id cannot be empty or only whitespace');
      expect(result.errors).toContain('model_id cannot be empty or only whitespace');
      expect(result.errors).toContain('accessible_to_agent cannot be empty or only whitespace');
      expect(result.errors).toContain('language_filter cannot be empty or only whitespace');
    });

    it('should validate agent_id format', () => {
      const params = { 
        query: 'test',
        agent_id: 'invalid@agent!id'
      };

      const result = validateSemanticSearchParams(params);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('agent_id must contain only letters, numbers, hyphens, and underscores');
    });

    it('should validate model_id format', () => {
      const params = { 
        query: 'test',
        model_id: 'invalid@model!id'
      };

      const result = validateSemanticSearchParams(params);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('model_id must contain only letters, numbers, hyphens, underscores, and dots');
    });

    it('should validate sections array content', () => {
      const params = { 
        query: 'test',
        sections: ['feelings', 'invalid_section', '', 123]
      };

      const result = validateSemanticSearchParams(params);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('sections[1] must be one of: feelings, project_notes, user_context, technical_insights, world_knowledge');
      expect(result.errors).toContain('sections[2] cannot be empty or only whitespace');
      expect(result.errors).toContain('sections[3] must be a string');
    });

    it('should validate project_filter formats', () => {
      const invalidParams1 = { 
        query: 'test',
        project_filter: ''
      };

      const result1 = validateSemanticSearchParams(invalidParams1);
      expect(result1.isValid).toBe(false);
      expect(result1.errors).toContain('project_filter string must be "current", "all", or a non-empty project name');

      const invalidParams2 = { 
        query: 'test',
        project_filter: []
      };

      const result2 = validateSemanticSearchParams(invalidParams2);
      expect(result2.isValid).toBe(false);
      expect(result2.errors).toContain('project_filter array cannot be empty');

      const invalidParams3 = { 
        query: 'test',
        project_filter: ['valid-project', '', 123]
      };

      const result3 = validateSemanticSearchParams(invalidParams3);
      expect(result3.isValid).toBe(false);
      expect(result3.errors).toContain('project_filter[1] cannot be empty or only whitespace');
      expect(result3.errors).toContain('project_filter[2] must be a string');

      const invalidParams4 = { 
        query: 'test',
        project_filter: 123
      };

      const result4 = validateSemanticSearchParams(invalidParams4);
      expect(result4.isValid).toBe(false);
      expect(result4.errors).toContain('project_filter must be a string, array of strings, "current", or "all"');
    });

    it('should validate numeric parameters more strictly', () => {
      const params = { 
        query: 'test',
        limit: 1.5,
        similarity_threshold: NaN,
        quality_threshold: 'not-a-number',
        min_relevance: Infinity
      };

      const result = validateSemanticSearchParams(params);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('limit must be an integer between 1 and 100');
      expect(result.errors).toContain('similarity_threshold must be a number between 0 and 1');
      expect(result.errors).toContain('quality_threshold must be a number between 0 and 1');
      expect(result.errors).toContain('min_relevance must be a number between 0 and 1');
    });

    it('should validate type parameter with non-string input', () => {
      const params = { 
        query: 'test',
        type: 123,
        visibility_level: []
      };

      const result = validateSemanticSearchParams(params);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('type must be a string');
      expect(result.errors).toContain('visibility_level must be a string');
    });

    it('should sanitize and normalize valid parameters', () => {
      const params = { 
        query: '  test query  ',
        type: '  PROJECT  ',
        visibility_level: 'PRIVATE',
        category: '  technical  ',
        agent_id: '  code-reviewer  ',
        model_id: '  claude-sonnet-4  ',
        accessible_to_agent: '  test-agent  ',
        language_filter: '  typescript  ',
        sections: ['  feelings  ', '  technical_insights  '],
        project_filter: ['  project1  ', '  project2  ']
      };

      const result = validateSemanticSearchParams(params);

      expect(result.isValid).toBe(true);
      expect(result.sanitized!.query).toBe('test query');
      expect(result.sanitized!.type).toBe('project');
      expect(result.sanitized!.visibility_level).toBe('private');
      expect(result.sanitized!.category).toBe('technical');
      expect(result.sanitized!.agent_id).toBe('code-reviewer');
      expect(result.sanitized!.model_id).toBe('claude-sonnet-4');
      expect(result.sanitized!.accessible_to_agent).toBe('test-agent');
      expect(result.sanitized!.language_filter).toBe('typescript');
      expect(result.sanitized!.sections).toEqual(['feelings', 'technical_insights']);
      expect(result.sanitized!.project_filter).toEqual(['project1', 'project2']);
    });

    it('should sanitize string project_filter', () => {
      const params = { 
        query: 'test',
        project_filter: '  CURRENT  '
      };

      const result = validateSemanticSearchParams(params);

      expect(result.isValid).toBe(true);
      expect(result.sanitized!.project_filter).toBe('current');
    });

    it('should validate date_range object type', () => {
      const params = { 
        query: 'test',
        date_range: 'not-an-object'
      };

      const result = validateSemanticSearchParams(params);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('date_range must be an object');
    });

    it('should validate date_range field types', () => {
      const params = { 
        query: 'test',
        date_range: {
          start: 123,
          end: []
        }
      };

      const result = validateSemanticSearchParams(params);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('date_range.start must be an ISO date string');
      expect(result.errors).toContain('date_range.end must be an ISO date string');
    });
  });

  describe('hasProjectAwareParams', () => {
    it('should detect project-aware parameters', () => {
      const params: SemanticSearchInsightsParams = {
        query: 'test',
        project_filter: 'current'
      };

      expect(hasProjectAwareParams(params)).toBe(true);
    });

    it('should detect language filter', () => {
      const params: SemanticSearchInsightsParams = {
        query: 'test',
        language_filter: 'typescript'
      };

      expect(hasProjectAwareParams(params)).toBe(true);
    });

    it('should detect exclude_current flag', () => {
      const params: SemanticSearchInsightsParams = {
        query: 'test',
        exclude_current: true
      };

      expect(hasProjectAwareParams(params)).toBe(true);
    });

    it('should detect non-default min_relevance', () => {
      const params: SemanticSearchInsightsParams = {
        query: 'test',
        min_relevance: 0.8
      };

      expect(hasProjectAwareParams(params)).toBe(true);
    });

    it('should return false for standard parameters', () => {
      const params: SemanticSearchInsightsParams = {
        query: 'test',
        limit: 10,
        type: 'both'
      };

      expect(hasProjectAwareParams(params)).toBe(false);
    });
  });

  describe('toSearchInsightsRequest', () => {
    it('should convert to SearchInsightsRequest format', () => {
      const params: SemanticSearchInsightsParams = {
        query: 'test query',
        limit: 15,
        similarity_threshold: 0.8,
        quality_threshold: 0.7,
        category: 'technical',
        date_range: {
          start: '2023-01-01T00:00:00Z',
          end: '2023-12-31T23:59:59Z'
        }
      };

      const result = toSearchInsightsRequest(params);

      expect(result.query).toBe('test query');
      expect(result.limit).toBe(15);
      expect(result.similarity_threshold).toBe(0.8);
      expect(result.quality_threshold).toBe(0.7);
      expect(result.category).toBe('technical');
      expect(result.date_range).toEqual({
        start: '2023-01-01T00:00:00Z',
        end: '2023-12-31T23:59:59Z'
      });
    });

    it('should exclude date_range if start or end is missing', () => {
      const params: SemanticSearchInsightsParams = {
        query: 'test query',
        date_range: {
          start: '2023-01-01T00:00:00Z'
          // end is missing
        }
      };

      const result = toSearchInsightsRequest(params);

      expect(result.date_range).toBeUndefined();
    });
  });

  describe('normalizeSearchResponse', () => {
    it('should normalize search results to common format', () => {
      const results = [
        {
          score: 0.8,
          path: '/test/path1.md',
          text: 'Test content 1',
          timestamp: new Date('2023-01-01'),
          type: 'project',
          sections: ['feelings']
        },
        {
          similarity_score: 0.7,
          file_path: '/test/path2.md',
          searchable_text: 'Test content 2',
          created_at: '2023-01-02',
          entry_type: 'user',
          sections: ['technical_insights'],
          cross_project_warning: true,
          project_name: 'other-project'
        }
      ];

      const normalized = normalizeSearchResponse(results);

      expect(normalized).toHaveLength(2);
      
      // First result (already normalized)
      expect(normalized[0]).toEqual({
        score: 0.8,
        path: '/test/path1.md',
        excerpt: 'Test content 1',
        text: 'Test content 1',
        timestamp: new Date('2023-01-01'),
        type: 'project',
        sections: ['feelings']
      });

      // Second result (needs normalization)
      expect(normalized[1]).toEqual({
        score: 0.7,
        path: '/test/path2.md',
        excerpt: 'Test content 2',
        text: 'Test content 2',
        timestamp: '2023-01-02',
        type: 'user',
        sections: ['technical_insights'],
        cross_project_warning: true,
        project_name: 'other-project'
      });
    });

    it('should handle missing fields gracefully', () => {
      const results = [
        {
          // minimal result with defaults
        }
      ];

      const normalized = normalizeSearchResponse(results);

      expect(normalized[0]).toEqual({
        score: 0,
        path: '',
        excerpt: '',
        text: '',
        timestamp: expect.any(Date),
        type: 'unknown',
        sections: []
      });
    });
  });
});