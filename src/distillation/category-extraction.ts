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
