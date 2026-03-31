// ABOUTME: Type definitions for MCP tool request/response interfaces
// ABOUTME: Defines types used by the MCP server tool handlers

import { ProjectContext } from './private-journal-types';

export type VisibilityLevel = 'private' | 'public' | 'team' | 'crb';

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

// Response format for normalized search results in MCP tool responses
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
  agent_id?: string;
  model_id?: string;
  visibility_level?: VisibilityLevel;
  project?: string;
  project_context?: ProjectContext;
}
