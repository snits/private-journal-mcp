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
      expect(result.errors).toContain('limit must be a number between 1 and 100');
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