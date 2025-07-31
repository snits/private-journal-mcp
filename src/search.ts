// ABOUTME: Journal search functionality with vector similarity and text matching
// ABOUTME: Provides unified search across project and user journal entries

import * as fs from 'fs/promises';
import * as path from 'path';
import { EmbeddingService, EmbeddingData } from './embeddings';
import { resolveUserJournalPath, resolveProjectJournalPath } from './paths';
import { SearchOptions, VisibilityLevel } from './types';

export interface SearchResult {
  path: string;
  score: number;
  text: string;
  sections: string[];
  timestamp: number;
  excerpt: string;
  type: 'project' | 'user';
  agent_id?: string;
  model_id?: string;
  visibility_level?: VisibilityLevel;
}

export interface LegacySearchOptions {
  limit?: number;
  minScore?: number;
  sections?: string[];
  dateRange?: {
    start?: Date;
    end?: Date;
  };
  type?: 'project' | 'user' | 'both';
}

export class SearchService {
  private embeddingService: EmbeddingService;
  private projectPath: string;
  private userPath: string;

  constructor(projectPath?: string, userPath?: string) {
    this.embeddingService = EmbeddingService.getInstance();
    this.projectPath = projectPath || resolveProjectJournalPath();
    this.userPath = userPath || resolveUserJournalPath();
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const {
      limit = 10,
      sections,
      agent_id,
      model_id,
      visibility_level,
      accessible_to_agent,
      type = 'both'
    } = options;
    
    const minScore = 0.1;

    // Generate query embedding
    const queryEmbedding = await this.embeddingService.generateEmbedding(query);

    // Collect all embeddings
    const allEmbeddings: Array<EmbeddingData & { 
      type: 'project' | 'user';
      agent_id?: string;
      model_id?: string;
      visibility_level?: VisibilityLevel;
    }> = [];

    if (type === 'both' || type === 'project') {
      const projectEmbeddings = await this.loadEmbeddingsFromPath(this.projectPath, 'project');
      allEmbeddings.push(...projectEmbeddings);
    }

    if (type === 'both' || type === 'user') {
      const userEmbeddings = await this.loadEmbeddingsFromPath(this.userPath, 'user');
      allEmbeddings.push(...userEmbeddings);
    }

    // Filter by criteria
    const filtered = allEmbeddings.filter(embedding => {
      // Filter by agent_id if specified
      if (agent_id && embedding.agent_id !== agent_id) {
        return false;
      }

      // Filter by model_id if specified
      if (model_id && embedding.model_id !== model_id) {
        return false;
      }

      // Filter by visibility_level if specified
      if (visibility_level && embedding.visibility_level !== visibility_level) {
        return false;
      }

      // Filter by what's accessible to requesting agent
      if (accessible_to_agent && !this.isVisibleToAgent(embedding, accessible_to_agent)) {
        return false;
      }

      // Filter by sections if specified
      if (sections && sections.length > 0) {
        const hasMatchingSection = sections.some(section => 
          embedding.sections.some(embeddingSection => 
            embeddingSection.toLowerCase().includes(section.toLowerCase())
          )
        );
        if (!hasMatchingSection) return false;
      }

      return true;
    });

    // Calculate similarities and sort
    const results: SearchResult[] = filtered
      .map(embedding => {
        const score = this.embeddingService.cosineSimilarity(queryEmbedding, embedding.embedding);
        const excerpt = this.generateExcerpt(embedding.text, query);
        
        return {
          path: embedding.path,
          score,
          text: embedding.text,
          sections: embedding.sections,
          timestamp: embedding.timestamp,
          excerpt,
          type: embedding.type,
          agent_id: embedding.agent_id,
          model_id: embedding.model_id,
          visibility_level: embedding.visibility_level
        };
      })
      .filter(result => result.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return results;
  }

  async listRecent(options: SearchOptions = {}): Promise<SearchResult[]> {
    const {
      limit = 10,
      type = 'both',
      dateRange
    } = options;

    const allEmbeddings: Array<EmbeddingData & { 
      type: 'project' | 'user';
      agent_id?: string;
      model_id?: string;
      visibility_level?: VisibilityLevel;
    }> = [];

    if (type === 'both' || type === 'project') {
      const projectEmbeddings = await this.loadEmbeddingsFromPath(this.projectPath, 'project');
      allEmbeddings.push(...projectEmbeddings);
    }

    if (type === 'both' || type === 'user') {
      const userEmbeddings = await this.loadEmbeddingsFromPath(this.userPath, 'user');
      allEmbeddings.push(...userEmbeddings);
    }

    // Filter by date range
    const filtered = dateRange ? allEmbeddings.filter(embedding => {
      const entryDate = new Date(embedding.timestamp);
      if (dateRange.start && entryDate < dateRange.start) return false;
      if (dateRange.end && entryDate > dateRange.end) return false;
      return true;
    }) : allEmbeddings;

    // Sort by timestamp (most recent first) and limit
    const results: SearchResult[] = filtered
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit)
      .map(embedding => ({
        path: embedding.path,
        score: 1, // No similarity score for recent entries
        text: embedding.text,
        sections: embedding.sections,
        timestamp: embedding.timestamp,
        excerpt: this.generateExcerpt(embedding.text, '', 150),
        type: embedding.type
      }));

    return results;
  }

  async readEntry(filePath: string): Promise<string | null> {
    try {
      return await fs.readFile(filePath, 'utf8');
    } catch (error) {
      if ((error as any)?.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  private isVisibleToAgent(embedding: any, requestingAgent: string): boolean {
    const visibility = embedding.visibility_level || 'private';
    const embeddingAgent = embedding.agent_id;
    
    // Private entries are only visible to the same agent
    if (visibility === 'private') {
      return embeddingAgent === requestingAgent;
    }
    
    // Public entries are visible to everyone
    if (visibility === 'public') {
      return true;
    }
    
    // Team entries are visible to all agents (for now - could be refined)
    if (visibility === 'team') {
      return true;
    }
    
    // CRB entries are visible to all agents (Change Review Board)
    if (visibility === 'crb') {
      return true;
    }
    
    return false;
  }

  private async loadEmbeddingsFromPath(
    basePath: string, 
    type: 'project' | 'user'
  ): Promise<Array<EmbeddingData & { type: 'project' | 'user'; agent_id?: string; model_id?: string; visibility_level?: VisibilityLevel }>> {
    const embeddings: Array<EmbeddingData & { type: 'project' | 'user'; agent_id?: string; model_id?: string; visibility_level?: VisibilityLevel }> = [];

    try {
      await this.loadEmbeddingsRecursive(basePath, type, embeddings);
    } catch (error) {
      if ((error as any)?.code !== 'ENOENT') {
        console.error(`Failed to read embeddings from ${basePath}:`, error);
      }
      // Return empty array if directory doesn't exist
    }

    return embeddings;
  }

  private async loadEmbeddingsRecursive(
    currentPath: string,
    type: 'project' | 'user',
    embeddings: Array<EmbeddingData & { type: 'project' | 'user'; agent_id?: string; model_id?: string; visibility_level?: VisibilityLevel }>,
    pathComponents: string[] = []
  ): Promise<void> {
    try {
      const items = await fs.readdir(currentPath);
      
      for (const item of items) {
        const itemPath = path.join(currentPath, item);
        const stat = await fs.stat(itemPath);
        
        if (stat.isDirectory()) {
          // Check if this is a date directory (final level)
          if (item.match(/^\d{4}-\d{2}-\d{2}$/)) {
            // This is a date directory, load embeddings from here
            await this.loadEmbeddingsFromDateDir(itemPath, type, embeddings, pathComponents);
          } else {
            // This might be model_id, agent_id, or visibility_level directory
            await this.loadEmbeddingsRecursive(itemPath, type, embeddings, [...pathComponents, item]);
          }
        }
      }
    } catch (error) {
      // Skip directories that can't be read
    }
  }

  private async loadEmbeddingsFromDateDir(
    dateDirPath: string,
    type: 'project' | 'user',
    embeddings: Array<EmbeddingData & { type: 'project' | 'user'; agent_id?: string; model_id?: string; visibility_level?: VisibilityLevel }>,
    pathComponents: string[]
  ): Promise<void> {
    try {
      const files = await fs.readdir(dateDirPath);
      const embeddingFiles = files.filter(file => file.endsWith('.embedding'));

      for (const embeddingFile of embeddingFiles) {
        try {
          const embeddingPath = path.join(dateDirPath, embeddingFile);
          const content = await fs.readFile(embeddingPath, 'utf8');
          const embeddingData = JSON.parse(content);
          
          // Extract agent metadata from path components or embedding data
          const { model_id, agent_id, visibility_level } = this.extractAgentMetadata(pathComponents, embeddingData);
          
          embeddings.push({ 
            ...embeddingData, 
            type,
            model_id,
            agent_id,
            visibility_level
          });
        } catch (error) {
          console.error(`Failed to load embedding ${embeddingFile}:`, error);
          // Continue with other files
        }
      }
    } catch (error) {
      console.error(`Failed to read date directory ${dateDirPath}:`, error);
    }
  }

  private extractAgentMetadata(pathComponents: string[], embeddingData: any): {
    model_id?: string;
    agent_id?: string;
    visibility_level?: VisibilityLevel;
  } {
    // Try path-based extraction first (for new structure)
    if (pathComponents.length >= 3) {
      return {
        model_id: pathComponents[0],
        agent_id: pathComponents[1],
        visibility_level: pathComponents[2] as VisibilityLevel
      };
    }
    
    // Fall back to trying to extract from file path metadata (if available)
    if (embeddingData.path) {
      const pathParts = embeddingData.path.split(path.sep);
      const modelIndex = pathParts.findIndex((part: string) => 
        part.includes('claude') || part.includes('gpt') || part.includes('gemini')
      );
      
      if (modelIndex >= 0 && modelIndex + 2 < pathParts.length) {
        return {
          model_id: pathParts[modelIndex],
          agent_id: pathParts[modelIndex + 1],
          visibility_level: pathParts[modelIndex + 2] as VisibilityLevel
        };
      }
    }
    
    // Default values for legacy entries
    return {
      model_id: 'unknown',
      agent_id: 'unknown',
      visibility_level: 'private'
    };
  }

  private generateExcerpt(text: string, query: string, maxLength: number = 200): string {
    if (!query || query.trim() === '') {
      return text.slice(0, maxLength) + (text.length > maxLength ? '...' : '');
    }

    const queryWords = query.toLowerCase().split(/\s+/);
    const textLower = text.toLowerCase();
    
    // Find the best position to start the excerpt
    let bestPosition = 0;
    let bestScore = 0;

    for (let i = 0; i <= text.length - maxLength; i += 20) {
      const window = textLower.slice(i, i + maxLength);
      const score = queryWords.reduce((sum, word) => {
        return sum + (window.includes(word) ? 1 : 0);
      }, 0);

      if (score > bestScore) {
        bestScore = score;
        bestPosition = i;
      }
    }

    let excerpt = text.slice(bestPosition, bestPosition + maxLength);
    if (bestPosition > 0) excerpt = '...' + excerpt;
    if (bestPosition + maxLength < text.length) excerpt += '...';

    return excerpt;
  }
}