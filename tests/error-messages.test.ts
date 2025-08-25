// ABOUTME: Test suite for enhanced error messages in semantic_search_insights
// ABOUTME: Verifies that compatibility issues provide clear, actionable guidance

import { validateSemanticSearchParams } from '../src/parameter-transformation';

describe('Enhanced Error Messages', () => {
  describe('Parameter validation', () => {
    test('provides clear guidance for parameter validation failures', () => {
      const result = validateSemanticSearchParams({
        query: '', // Empty query
        limit: 150, // Over limit
        similarity_threshold: 1.5, // Out of range
        type: 'invalid', // Invalid enum
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('query cannot be empty or only whitespace');
      expect(result.errors).toContain('limit must be an integer between 1 and 100');
      expect(result.errors).toContain('similarity_threshold must be a number between 0 and 1');
      expect(result.errors).toContain('type must be one of: project, user, both');
    });

    test('validates semantic-specific parameters correctly', () => {
      const result = validateSemanticSearchParams({
        query: 'test',
        category: '', // Empty category
        quality_threshold: -0.1, // Out of range
        date_range: { start: '2024-01-01', end: '2023-01-01' }, // Invalid range
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('category cannot be empty or only whitespace');
      expect(result.errors).toContain('quality_threshold must be a number between 0 and 1');
      expect(result.errors).toContain('date_range.start must be earlier than date_range.end');
    });

    test('validates agent and model IDs with proper format requirements', () => {
      const result = validateSemanticSearchParams({
        query: 'test',
        agent_id: 'invalid@agent!', // Invalid characters
        model_id: 'model with spaces', // Invalid format
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('agent_id must contain only letters, numbers, hyphens, and underscores');
      expect(result.errors).toContain('model_id must contain only letters, numbers, hyphens, underscores, and dots');
    });

    test('validates project filter parameters', () => {
      const result = validateSemanticSearchParams({
        query: 'test',
        project_filter: [], // Empty array
        sections: ['invalid_section'], // Invalid section
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('project_filter array cannot be empty');
      expect(result.errors).toContain('sections[0] must be one of: feelings, project_notes, user_context, technical_insights, world_knowledge');
    });
  });

  describe('Error message formatting', () => {
    test('error messages are well-formatted and actionable', () => {
      const result = validateSemanticSearchParams({
        query: '', 
        limit: 150,
      });

      // Verify errors are clear and specific
      result.errors.forEach(error => {
        expect(error).toMatch(/^[a-z_]+\s+/); // Starts with parameter name
        expect(error.length).toBeGreaterThan(10); // Not too terse
        expect(error.length).toBeLessThan(200); // Not too verbose
      });
    });
  });
});