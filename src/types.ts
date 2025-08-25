// ABOUTME: Type definitions for the private journal MCP server
// ABOUTME: Defines interfaces for journal entries and configuration

export type VisibilityLevel = 'private' | 'public' | 'team' | 'crb';

export interface JournalEntry {
  content: string;
  timestamp: Date;
  filePath: string;
  agent_id?: string; // e.g., "code-reviewer", "debug-specialist", "claude-general"
  model_id?: string; // e.g., "claude-sonnet-4", "gpt-4o", "gemini-2.0-pro"
  visibility_level?: VisibilityLevel;
}

export interface ServerConfig {
  journalPath: string;
}

export interface ProcessFeelingsRequest {
  diary_entry: string;
}

export interface ProcessThoughtsRequest {
  feelings?: string;
  project_notes?: string;
  user_context?: string;
  technical_insights?: string;
  world_knowledge?: string;
  agent_id?: string;
  model_id?: string;
  visibility_level?: VisibilityLevel;
}

// Utility type for semantic search insights parameters
export interface SemanticSearchInsightsParams {
  query: string;
  limit?: number;
  similarity_threshold?: number;
  quality_threshold?: number;
  category?: string;
  date_range?: {
    start?: string;
    end?: string;
  };
  // Extended parameters for search_journal compatibility
  type?: 'project' | 'user' | 'both';
  sections?: string[];
  agent_id?: string;
  model_id?: string;
  visibility_level?: VisibilityLevel;
  accessible_to_agent?: string;
  project_filter?: string | string[] | 'current' | 'all';
  language_filter?: string;
  exclude_current?: boolean;
  min_relevance?: number;
}

export interface SearchOptions {
  limit?: number;
  type?: 'project' | 'user' | 'both';
  sections?: string[];
  agent_id?: string;
  model_id?: string;
  visibility_level?: VisibilityLevel;
  accessible_to_agent?: string; // Filter by what this agent can see
  dateRange?: {
    start?: Date;
    end?: Date;
  };
  // Project-aware search options
  project_filter?: string | string[] | 'current' | 'all';
  language_filter?: string;
  exclude_current?: boolean;
  min_relevance?: number;
}

// Enhanced search options for semantic_search_insights compatibility
export interface SemanticSearchOptions extends SearchOptions {
  similarity_threshold?: number;
  quality_threshold?: number;
  category?: string;
  // Date range with ISO string format for API compatibility
  date_range?: {
    start?: string; // ISO date string
    end?: string;   // ISO date string
  };
}

// Parameter transformation utilities
export interface ParameterMapping {
  // Maps from search_journal format to semantic_search_insights format
  dateRange?: { start?: Date; end?: Date };
  date_range?: { start?: string; end?: string };
}

// Validation types for parameter compatibility
export interface SearchValidationOptions {
  requireQuery: boolean;
  allowProjectFilter: boolean;
  allowDateRange: boolean;
  allowSemanticParams: boolean;
}

// Response format compatibility types
export interface SearchResult {
  score: number;
  path: string;
  excerpt?: string;
  text?: string;
  timestamp: Date | number | string;
  type: string;
  entry_type?: string;
  sections: string[];
  searchable_text?: string;
  file_path?: string;
  // Project-aware fields
  cross_project_warning?: boolean;
  project_name?: string;
  context_match?: number;
}
