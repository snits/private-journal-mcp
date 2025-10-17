// ABOUTME: Parameter transformation utilities for semantic search compatibility
// ABOUTME: Converts between search_journal and semantic_search_insights parameter formats

import {
  SearchOptions,
  SemanticSearchOptions,
  SemanticSearchInsightsParams,
  VisibilityLevel,
} from './types';

/**
 * Transforms search_journal parameters to semantic_search_insights format
 * Handles parameter mapping and type conversion for API compatibility
 */
export function transformToSemanticSearchParams(
  query: string,
  searchOptions: SearchOptions
): SemanticSearchInsightsParams {
  const params: SemanticSearchInsightsParams = {
    query,
    limit: searchOptions.limit,
    type: searchOptions.type,
    sections: searchOptions.sections,
    agent_id: searchOptions.agent_id,
    model_id: searchOptions.model_id,
    visibility_level: searchOptions.visibility_level,
    accessible_to_agent: searchOptions.accessible_to_agent,
    project_filter: searchOptions.project_filter,
    language_filter: searchOptions.language_filter,
    exclude_current: searchOptions.exclude_current,
    min_relevance: searchOptions.min_relevance,
  };

  // Convert dateRange (Date objects) to date_range (ISO strings)
  if (searchOptions.dateRange) {
    params.date_range = {
      start: searchOptions.dateRange.start?.toISOString(),
      end: searchOptions.dateRange.end?.toISOString(),
    };
  }

  return params;
}

/**
 * Transforms semantic_search_insights parameters to SearchOptions format
 * Handles reverse parameter mapping for internal processing
 */
export function transformFromSemanticSearchParams(
  params: SemanticSearchInsightsParams
): SearchOptions {
  const searchOptions: SearchOptions = {
    limit: params.limit,
    type: params.type,
    sections: params.sections,
    agent_id: params.agent_id,
    model_id: params.model_id,
    visibility_level: params.visibility_level,
    accessible_to_agent: params.accessible_to_agent,
    project_filter: params.project_filter,
    language_filter: params.language_filter,
    exclude_current: params.exclude_current,
    min_relevance: params.min_relevance,
  };

  // Convert date_range (ISO strings) to dateRange (Date objects)
  if (params.date_range) {
    searchOptions.dateRange = {
      start: params.date_range.start ? new Date(params.date_range.start) : undefined,
      end: params.date_range.end ? new Date(params.date_range.end) : undefined,
    };
  }

  return searchOptions;
}

/**
 * Validates semantic search insights parameters
 * Ensures all required parameters are present and valid with comprehensive sanitization
 */
export function validateSemanticSearchParams(params: any): {
  isValid: boolean;
  errors: string[];
  sanitized?: SemanticSearchInsightsParams;
} {
  const errors: string[] = [];

  // Required parameter validation with sanitization
  if (typeof params.query !== 'string') {
    errors.push('query is required and must be a string');
  } else {
    const trimmedQuery = params.query.trim();
    if (trimmedQuery === '') {
      errors.push('query cannot be empty or only whitespace');
    }
  }

  // Numeric parameter validation with proper type checking
  if (params.limit !== undefined) {
    if (
      typeof params.limit !== 'number' ||
      !Number.isInteger(params.limit) ||
      params.limit < 1 ||
      params.limit > 100
    ) {
      errors.push('limit must be an integer between 1 and 100');
    }
  }

  if (params.similarity_threshold !== undefined) {
    if (
      typeof params.similarity_threshold !== 'number' ||
      isNaN(params.similarity_threshold) ||
      params.similarity_threshold < 0 ||
      params.similarity_threshold > 1
    ) {
      errors.push('similarity_threshold must be a number between 0 and 1');
    }
  }

  if (params.quality_threshold !== undefined) {
    if (
      typeof params.quality_threshold !== 'number' ||
      isNaN(params.quality_threshold) ||
      params.quality_threshold < 0 ||
      params.quality_threshold > 1
    ) {
      errors.push('quality_threshold must be a number between 0 and 1');
    }
  }

  if (params.min_relevance !== undefined) {
    if (
      typeof params.min_relevance !== 'number' ||
      isNaN(params.min_relevance) ||
      params.min_relevance < 0 ||
      params.min_relevance > 1
    ) {
      errors.push('min_relevance must be a number between 0 and 1');
    }
  }

  // Enum validation with case normalization
  if (params.type !== undefined) {
    if (typeof params.type !== 'string') {
      errors.push('type must be a string');
    } else {
      const normalizedType = params.type.toLowerCase().trim();
      if (!['project', 'user', 'both'].includes(normalizedType)) {
        errors.push('type must be one of: project, user, both');
      }
    }
  }

  if (params.visibility_level !== undefined) {
    if (typeof params.visibility_level !== 'string') {
      errors.push('visibility_level must be a string');
    } else {
      const normalizedLevel = params.visibility_level.toLowerCase().trim();
      if (!['private', 'public', 'team', 'crb'].includes(normalizedLevel)) {
        errors.push('visibility_level must be one of: private, public, team, crb');
      }
    }
  }

  // String parameter validation with sanitization
  if (params.category !== undefined) {
    if (typeof params.category !== 'string') {
      errors.push('category must be a string');
    } else if (params.category.trim() === '') {
      errors.push('category cannot be empty or only whitespace');
    }
  }

  if (params.agent_id !== undefined) {
    if (typeof params.agent_id !== 'string') {
      errors.push('agent_id must be a string');
    } else if (params.agent_id.trim() === '') {
      errors.push('agent_id cannot be empty or only whitespace');
    } else if (!/^[a-zA-Z0-9_-]+$/.test(params.agent_id.trim())) {
      errors.push('agent_id must contain only letters, numbers, hyphens, and underscores');
    }
  }

  if (params.model_id !== undefined) {
    if (typeof params.model_id !== 'string') {
      errors.push('model_id must be a string');
    } else if (params.model_id.trim() === '') {
      errors.push('model_id cannot be empty or only whitespace');
    } else if (!/^[a-zA-Z0-9_.-]+$/.test(params.model_id.trim())) {
      errors.push('model_id must contain only letters, numbers, hyphens, underscores, and dots');
    }
  }

  if (params.accessible_to_agent !== undefined) {
    if (typeof params.accessible_to_agent !== 'string') {
      errors.push('accessible_to_agent must be a string');
    } else if (params.accessible_to_agent.trim() === '') {
      errors.push('accessible_to_agent cannot be empty or only whitespace');
    }
  }

  if (params.language_filter !== undefined) {
    if (typeof params.language_filter !== 'string') {
      errors.push('language_filter must be a string');
    } else if (params.language_filter.trim() === '') {
      errors.push('language_filter cannot be empty or only whitespace');
    }
  }

  // Array validation with content checking
  if (params.sections !== undefined) {
    if (!Array.isArray(params.sections)) {
      errors.push('sections must be an array of strings');
    } else {
      const validSections = [
        'feelings',
        'project_notes',
        'user_context',
        'technical_insights',
        'world_knowledge',
      ];
      for (let i = 0; i < params.sections.length; i++) {
        if (typeof params.sections[i] !== 'string') {
          errors.push(`sections[${i}] must be a string`);
        } else if (params.sections[i].trim() === '') {
          errors.push(`sections[${i}] cannot be empty or only whitespace`);
        } else if (!validSections.includes(params.sections[i].trim())) {
          errors.push(`sections[${i}] must be one of: ${validSections.join(', ')}`);
        }
      }
    }
  }

  // Boolean validation
  if (params.exclude_current !== undefined && typeof params.exclude_current !== 'boolean') {
    errors.push('exclude_current must be a boolean');
  }

  // Complex object validation for project_filter
  if (params.project_filter !== undefined) {
    if (typeof params.project_filter === 'string') {
      const normalizedFilter = params.project_filter.toLowerCase().trim();
      if (!['current', 'all'].includes(normalizedFilter) && normalizedFilter === '') {
        errors.push('project_filter string must be "current", "all", or a non-empty project name');
      }
    } else if (Array.isArray(params.project_filter)) {
      if (params.project_filter.length === 0) {
        errors.push('project_filter array cannot be empty');
      }
      for (let i = 0; i < params.project_filter.length; i++) {
        if (typeof params.project_filter[i] !== 'string') {
          errors.push(`project_filter[${i}] must be a string`);
        } else if (params.project_filter[i].trim() === '') {
          errors.push(`project_filter[${i}] cannot be empty or only whitespace`);
        }
      }
    } else {
      errors.push('project_filter must be a string, array of strings, "current", or "all"');
    }
  }

  // Date range validation with enhanced checking
  if (params.date_range !== undefined) {
    if (typeof params.date_range !== 'object' || params.date_range === null) {
      errors.push('date_range must be an object');
    } else {
      if (params.date_range.start !== undefined) {
        if (typeof params.date_range.start !== 'string') {
          errors.push('date_range.start must be an ISO date string');
        } else {
          const startDate = new Date(params.date_range.start);
          if (isNaN(startDate.getTime())) {
            errors.push('date_range.start must be a valid ISO date string');
          }
        }
      }
      if (params.date_range.end !== undefined) {
        if (typeof params.date_range.end !== 'string') {
          errors.push('date_range.end must be an ISO date string');
        } else {
          const endDate = new Date(params.date_range.end);
          if (isNaN(endDate.getTime())) {
            errors.push('date_range.end must be a valid ISO date string');
          }
        }
      }
      // Validate date range logic
      if (params.date_range.start && params.date_range.end) {
        const startDate = new Date(params.date_range.start);
        const endDate = new Date(params.date_range.end);
        if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime()) && startDate >= endDate) {
          errors.push('date_range.start must be earlier than date_range.end');
        }
      }
    }
  }

  if (errors.length > 0) {
    return { isValid: false, errors };
  }

  // Sanitize and return validated parameters
  const sanitized: SemanticSearchInsightsParams = {
    query: params.query.trim(),
    limit: params.limit || 10,
    similarity_threshold: params.similarity_threshold || 0.7,
    quality_threshold: params.quality_threshold || 0.7,
    category: params.category?.trim(),
    date_range: params.date_range,
    type: (params.type?.toLowerCase().trim() as 'project' | 'user' | 'both') || 'both',
    sections: params.sections?.map((s: string) => s.trim()),
    agent_id: params.agent_id?.trim(),
    model_id: params.model_id?.trim(),
    visibility_level: params.visibility_level?.toLowerCase().trim() as VisibilityLevel,
    accessible_to_agent: params.accessible_to_agent?.trim(),
    project_filter: Array.isArray(params.project_filter)
      ? params.project_filter.map((p: string) => p.trim())
      : params.project_filter?.toLowerCase?.().trim() || params.project_filter,
    language_filter: params.language_filter?.trim(),
    exclude_current: params.exclude_current || false,
    min_relevance: params.min_relevance || 0.6,
  };

  return { isValid: true, errors: [], sanitized };
}

/**
 * Checks if the provided parameters include any project-aware search options
 * Used to determine whether to use ProjectAwareSearchService
 */
export function hasProjectAwareParams(params: SemanticSearchInsightsParams): boolean {
  return !!(
    params.project_filter !== undefined ||
    params.language_filter !== undefined ||
    params.exclude_current ||
    (params.min_relevance !== undefined && params.min_relevance !== 0.6)
  );
}

/**
 * Extracts semantic-specific parameters from combined parameter set
 * Used to separate semantic search parameters from standard search parameters
 */
export function extractSemanticParams(params: SemanticSearchInsightsParams): {
  similarity_threshold?: number;
  quality_threshold?: number;
  category?: string;
} {
  return {
    similarity_threshold: params.similarity_threshold,
    quality_threshold: params.quality_threshold,
    category: params.category,
  };
}

/**
 * Strips YAML frontmatter from text content
 * Removes everything between --- markers at the start of the text
 */
export function stripFrontmatter(text: string): string {
  const frontmatterRegex = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;
  return text.replace(frontmatterRegex, '').trim();
}

/**
 * Creates a backward-compatible response format
 * Ensures responses match expected format regardless of source
 */
export function normalizeSearchResponse(results: any[]): any[] {
  return results.map((result) => {
    const text = result.text || result.content || result.searchable_text || '';
    const contentWithoutFrontmatter = stripFrontmatter(text);
    const excerpt = result.excerpt || (contentWithoutFrontmatter ? contentWithoutFrontmatter.slice(0, 200) : '');

    return {
      score: result.score || result.similarity_score || 0,
      path: result.path || result.file_path || '',
      excerpt,
      text,
      timestamp: result.timestamp || result.created_at || new Date(),
      type: result.type || result.entry_type || 'unknown',
      sections: result.sections || [],
      // Agent metadata fields
      ...(result.agent_id && { agent_id: result.agent_id }),
      ...(result.model_id && { model_id: result.model_id }),
      ...(result.visibility_level && { visibility_level: result.visibility_level }),
      // Preserve additional fields for project-aware responses
      ...(result.cross_project_warning && { cross_project_warning: result.cross_project_warning }),
      ...(result.project_name && { project_name: result.project_name }),
      ...(result.context_match && { context_match: result.context_match }),
    };
  });
}
