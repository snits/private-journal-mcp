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
