// ABOUTME: Type definitions for private-journal-mcp compatibility layer
// ABOUTME: Ensures identical API surface between SQLite and PostgreSQL implementations

export type VisibilityLevel = 'private' | 'public' | 'team' | 'crb';

export interface JournalEntry {
  content: string;
  timestamp: Date;
  filePath: string;
  agent_id?: string;        // e.g., "code-reviewer", "debug-specialist", "claude-general"
  model_id?: string;        // e.g., "claude-sonnet-4", "gpt-4o", "gemini-2.0-pro"
  visibility_level?: VisibilityLevel;
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

export interface SearchOptions {
  limit?: number;
  type?: 'project' | 'user' | 'both';
  sections?: string[];
  agent_id?: string;
  model_id?: string;
  visibility_level?: VisibilityLevel;
  accessible_to_agent?: string;  // Filter by what this agent can see
  dateRange?: {
    start?: Date;
    end?: Date;
  };
}

// Database types matching SQLite schema
export interface DatabaseEntry {
  id: number;
  content: string;
  timestamp: Date;
  date_string: string;
  file_path: string;
  agent_id?: string;
  model_id?: string;
  visibility_level: VisibilityLevel;
  entry_type: 'simple' | 'thoughts';
  embedding?: Buffer;
  searchable_text?: string;
  sections?: string;
  created_at: Date;
}

export interface SearchResult {
  id: number;
  content: string;
  timestamp: Date;
  file_path: string;
  agent_id?: string;
  model_id?: string;
  visibility_level: VisibilityLevel;
  entry_type: 'simple' | 'thoughts';
  score: number;
  searchable_text?: string;
  sections: string[];
}

export interface EmbeddingData {
  embedding: number[];
  text: string;
  sections: string[];
  timestamp: number;
  path: string;
}