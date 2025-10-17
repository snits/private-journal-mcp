// ABOUTME: Simplified PostgreSQL journal manager maintaining API compatibility with SQLite version
// ABOUTME: Self-contained implementation for private-journal-mcp without external dependencies

import { Pool, PoolClient } from 'pg';
import { DatabaseConfig, createDatabaseConfig } from './database-config';
import { OpenAIEmbeddingService as EmbeddingService } from './openai-embedding-service';
import {
  VisibilityLevel,
  SearchOptions,
  DatabaseEntry,
  SearchResult,
} from './private-journal-types';

export class PostgreSQLJournalManager {
  private pool!: Pool;
  private embeddingService: EmbeddingService;
  private config: DatabaseConfig;

  constructor(config?: Partial<DatabaseConfig>) {
    this.config = { ...createDatabaseConfig(), ...config };
    this.embeddingService = EmbeddingService.getInstance();
  }

  async initialize(): Promise<void> {
    this.pool = new Pool({
      host: this.config.host,
      port: this.config.port,
      database: this.config.database,
      user: this.config.user,
      password: this.config.password,
      ssl: this.config.ssl,
      max: this.config.maxConnections,
      idleTimeoutMillis: this.config.idleTimeoutMs,
      connectionTimeoutMillis: this.config.connectionTimeoutMs,
      application_name: 'private-journal-postgresql',
    });

    // Test connection
    const client = await this.pool.connect();
    await client.query('SELECT 1');
    client.release();
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
    }
  }

  async checkEntryExists(
    filePath: string,
    timestamp: number,
    contentPreview: string
  ): Promise<boolean> {
    const timeWindow = 60000; // 1 minute
    const client = await this.pool.connect();

    try {
      const result = await client.query(
        `
        SELECT id FROM ai_memory.journal_entries 
        WHERE ABS(EXTRACT(EPOCH FROM (timestamp - to_timestamp($1::bigint / 1000))) * 1000) <= $2 
        AND substring(content, 1, 200) = substring($3, 1, 200)
        LIMIT 1
      `,
        [timestamp, timeWindow, contentPreview]
      );

      return result.rows.length > 0;
    } finally {
      client.release();
    }
  }

  async writeEntry(content: string): Promise<void> {
    const timestamp = new Date();
    const dateString = this.formatDate(timestamp);
    const timeString = this.formatTimestamp(timestamp);
    const filePath = `${dateString}/${timeString}.md`;

    const formattedEntry = this.formatEntry(content, timestamp);

    // Generate embedding
    const embeddingData = await this.generateEmbeddingForContent(
      formattedEntry,
      timestamp,
      filePath
    );

    const client = await this.pool.connect();

    try {
      await client.query(
        `
        INSERT INTO ai_memory.journal_entries (
          content, timestamp, date_string, file_path, entry_type,
          embedding_768d, sections, visibility_level, user_id
        ) VALUES ($1, $2, $3, $4, $5, $6::vector, $7, $8, $9)
      `,
        [
          formattedEntry,
          timestamp,
          dateString,
          filePath,
          'simple',
          embeddingData.embedding && embeddingData.embedding.length === 768
            ? this.formatEmbeddingForPgvector(embeddingData.embedding)
            : null,
          JSON.stringify(embeddingData.sections || []),
          'private',
          'private-journal-mcp', // Default user_id for private-journal-mcp entries
        ]
      );
    } finally {
      client.release();
    }
  }

  async writeThoughts(thoughts: {
    feelings?: string;
    project_notes?: string;
    user_context?: string;
    technical_insights?: string;
    world_knowledge?: string;
    agent_id?: string;
    model_id?: string;
    visibility_level?: VisibilityLevel;
  }): Promise<void> {
    const timestamp = new Date();

    // Split thoughts into project-local and user-global
    const projectThoughts = {
      project_notes: thoughts.project_notes,
      agent_id: thoughts.agent_id,
      model_id: thoughts.model_id,
      visibility_level: thoughts.visibility_level || 'private',
    };
    const userThoughts = {
      feelings: thoughts.feelings,
      user_context: thoughts.user_context,
      technical_insights: thoughts.technical_insights,
      world_knowledge: thoughts.world_knowledge,
      agent_id: thoughts.agent_id,
      model_id: thoughts.model_id,
      visibility_level: thoughts.visibility_level || 'private',
    };

    // Write project notes if present
    if (projectThoughts.project_notes) {
      await this.writeThoughtsToDatabase(projectThoughts, timestamp, 'project');
    }

    // Write user thoughts if present
    const hasUserContent = Object.values(userThoughts).some(
      (value) => value !== undefined && typeof value === 'string'
    );
    if (hasUserContent) {
      await this.writeThoughtsToDatabase(userThoughts, timestamp, 'user');
    }
  }

  private async writeThoughtsToDatabase(
    thoughts: {
      feelings?: string;
      project_notes?: string;
      user_context?: string;
      technical_insights?: string;
      world_knowledge?: string;
      agent_id?: string;
      model_id?: string;
      visibility_level?: VisibilityLevel;
    },
    timestamp: Date,
    type: 'project' | 'user'
  ): Promise<void> {
    const dateString = this.formatDate(timestamp);
    const timeString = this.formatTimestamp(timestamp);
    const filePath = `${type}/${dateString}/${timeString}.md`;

    const formattedEntry = this.formatThoughts(thoughts, timestamp);

    // Generate embedding
    const embeddingData = await this.generateEmbeddingForContent(
      formattedEntry,
      timestamp,
      filePath
    );

    const client = await this.pool.connect();

    try {
      await client.query(
        `
        INSERT INTO ai_memory.journal_entries (
          content, timestamp, date_string, file_path, entry_type,
          agent_id, model_id, visibility_level,
          embedding_768d, sections, user_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::vector, $10, $11)
      `,
        [
          formattedEntry,
          timestamp,
          dateString,
          filePath,
          'thoughts',
          thoughts.agent_id || null,
          thoughts.model_id || null,
          thoughts.visibility_level || 'private',
          embeddingData.embedding && embeddingData.embedding.length === 768
            ? this.formatEmbeddingForPgvector(embeddingData.embedding)
            : null,
          JSON.stringify(embeddingData.sections || []),
          'private-journal-mcp', // Default user_id for private-journal-mcp entries
        ]
      );
    } finally {
      client.release();
    }
  }

  private async generateEmbeddingForContent(
    content: string,
    timestamp: Date,
    filePath: string
  ): Promise<{ embedding: number[]; text: string; sections: string[] }> {
    try {
      const { text, sections } = this.embeddingService.extractSearchableText(content);

      if (text.trim().length === 0) {
        return {
          embedding: [],
          text: '',
          sections: [],
        };
      }

      const embedding = await this.embeddingService.generateEmbedding(text);

      return {
        embedding,
        text,
        sections,
      };
    } catch (error) {
      console.error(`Failed to generate embedding for ${filePath}:`, error);
      return {
        embedding: [],
        text: '',
        sections: [],
      };
    }
  }

  async searchBySimilarity(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const { limit = 10, agent_id, model_id, visibility_level, accessible_to_agent } = options;

    // Generate embedding for query
    const queryEmbedding = await this.embeddingService.generateEmbedding(query);

    // Build WHERE clauses for filtering
    const whereClauses: string[] = ['embedding_768d IS NOT NULL'];
    const params: any[] = [];
    let paramIndex = 1;

    if (agent_id) {
      whereClauses.push(`agent_id = $${paramIndex++}`);
      params.push(agent_id);
    }

    if (model_id) {
      whereClauses.push(`model_id = $${paramIndex++}`);
      params.push(model_id);
    }

    if (visibility_level) {
      whereClauses.push(`visibility_level = $${paramIndex++}`);
      params.push(visibility_level);
    }

    if (accessible_to_agent) {
      whereClauses.push(`(
        visibility_level = 'public' OR
        visibility_level = 'team' OR
        visibility_level = 'crb' OR
        (visibility_level = 'private' AND agent_id = $${paramIndex++})
      )`);
      params.push(accessible_to_agent);
    }

    // Add embedding parameter
    const embeddingParam = this.formatEmbeddingForPgvector(queryEmbedding);
    params.push(embeddingParam);
    const embeddingParamIndex = paramIndex++;

    // Add minimum similarity threshold
    const minSimilarity = options.min_relevance || 0.6;
    params.push(minSimilarity);
    const minSimilarityIndex = paramIndex++;

    // Add limit parameter
    params.push(limit);
    const limitIndex = paramIndex++;

    const whereClause = whereClauses.join(' AND ');

    const sql = `
      SELECT id, content, timestamp, file_path, agent_id, model_id,
             visibility_level, entry_type, searchable_text, sections,
             1 - (embedding_768d <=> $${embeddingParamIndex}::vector) AS score
      FROM ai_memory.journal_entries
      WHERE ${whereClause}
        AND (1 - (embedding_768d <=> $${embeddingParamIndex}::vector)) >= $${minSimilarityIndex}
      ORDER BY embedding_768d <=> $${embeddingParamIndex}::vector
      LIMIT $${limitIndex}
    `;

    const client = await this.pool.connect();

    try {
      const result = await client.query(sql, params);

      // Results already sorted by similarity, just map to SearchResult format
      const results: SearchResult[] = result.rows.map(row => ({
        id: row.id,
        content: row.content,
        timestamp: new Date(row.timestamp),
        file_path: row.file_path,
        score: row.score,
        entry_type: row.entry_type,
        sections: this.parseJsonSafely(row.sections, []),
        searchable_text: row.searchable_text,
        agent_id: row.agent_id,
        model_id: row.model_id,
        visibility_level: row.visibility_level,
      }));

      return results;
    } finally {
      client.release();
    }
  }

  async listRecent(options: SearchOptions = {}): Promise<SearchResult[]> {
    const {
      limit = 10,
      agent_id,
      model_id,
      visibility_level,
      accessible_to_agent,
      dateRange,
    } = options;

    // Build WHERE clauses for filtering
    const whereClauses: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (agent_id) {
      whereClauses.push(`agent_id = $${paramIndex++}`);
      params.push(agent_id);
    }

    if (model_id) {
      whereClauses.push(`model_id = $${paramIndex++}`);
      params.push(model_id);
    }

    if (visibility_level) {
      whereClauses.push(`visibility_level = $${paramIndex++}`);
      params.push(visibility_level);
    }

    if (accessible_to_agent) {
      whereClauses.push(`(
        visibility_level = 'public' OR
        visibility_level = 'team' OR
        visibility_level = 'crb' OR
        (visibility_level = 'private' AND agent_id = $${paramIndex++})
      )`);
      params.push(accessible_to_agent);
    }

    if (dateRange) {
      if (dateRange.start) {
        whereClauses.push(`timestamp >= $${paramIndex++}`);
        params.push(dateRange.start);
      }
      if (dateRange.end) {
        whereClauses.push(`timestamp <= $${paramIndex++}`);
        params.push(dateRange.end);
      }
    }

    const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const sql = `
      SELECT id, content, timestamp, file_path, agent_id, model_id, 
             visibility_level, entry_type, searchable_text, sections
      FROM ai_memory.journal_entries 
      ${whereClause}
      ORDER BY timestamp DESC
      LIMIT $${paramIndex}
    `;

    params.push(limit);

    const client = await this.pool.connect();

    try {
      const result = await client.query(sql, params);

      return result.rows.map((row: any) => ({
        id: row.id,
        content: row.content,
        timestamp: new Date(row.timestamp),
        file_path: row.file_path,
        agent_id: row.agent_id,
        model_id: row.model_id,
        visibility_level: row.visibility_level,
        entry_type: row.entry_type,
        score: 1, // No similarity score for recent entries
        searchable_text: row.searchable_text,
        sections: this.parseJsonSafely(row.sections, []),
      }));
    } finally {
      client.release();
    }
  }

  async readEntryByPath(filePath: string): Promise<string | null> {
    const client = await this.pool.connect();

    try {
      const result = await client.query(
        `
        SELECT content FROM ai_memory.journal_entries 
        WHERE file_path = $1
        LIMIT 1
      `,
        [filePath]
      );

      return result.rows[0] ? result.rows[0].content : null;
    } finally {
      client.release();
    }
  }

  // Utility methods for compatibility with existing code
  private parseJsonSafely(jsonString: string | null, defaultValue: any = null): any {
    if (!jsonString) return defaultValue;

    try {
      return JSON.parse(jsonString);
    } catch (error) {
      // If JSON parsing fails, treat as a single item array or return default
      if (Array.isArray(defaultValue)) {
        return [jsonString];
      }
      return defaultValue;
    }
  }

  private formatEmbeddingForPgvector(embedding: number[]): string {
    if (embedding.length !== 768) {
      throw new Error(`Expected 768-dimensional embedding, got ${embedding.length}`);
    }
    return `[${embedding.join(',')}]`;
  }

  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private formatTimestamp(date: Date): string {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    const microseconds = String(
      date.getMilliseconds() * 1000 + Math.floor(Math.random() * 1000)
    ).padStart(6, '0');
    return `${hours}-${minutes}-${seconds}-${microseconds}`;
  }

  private formatEntry(content: string, timestamp: Date): string {
    const timeDisplay = timestamp.toLocaleTimeString('en-US', {
      hour12: true,
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
    });
    const dateDisplay = timestamp.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    return `---
title: "${timeDisplay} - ${dateDisplay}"
date: ${timestamp.toISOString()}
timestamp: ${timestamp.getTime()}
---

${content}
`;
  }

  private formatThoughts(
    thoughts: {
      feelings?: string;
      project_notes?: string;
      user_context?: string;
      technical_insights?: string;
      world_knowledge?: string;
      agent_id?: string;
      model_id?: string;
      visibility_level?: VisibilityLevel;
    },
    timestamp: Date
  ): string {
    const timeDisplay = timestamp.toLocaleTimeString('en-US', {
      hour12: true,
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
    });
    const dateDisplay = timestamp.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const sections = [];

    if (thoughts.feelings) {
      sections.push(`## Feelings\n\n${thoughts.feelings}`);
    }

    if (thoughts.project_notes) {
      sections.push(`## Project Notes\n\n${thoughts.project_notes}`);
    }

    if (thoughts.user_context) {
      sections.push(`## User Context\n\n${thoughts.user_context}`);
    }

    if (thoughts.technical_insights) {
      sections.push(`## Technical Insights\n\n${thoughts.technical_insights}`);
    }

    if (thoughts.world_knowledge) {
      sections.push(`## World Knowledge\n\n${thoughts.world_knowledge}`);
    }

    return `---
title: "${timeDisplay} - ${dateDisplay}"
date: ${timestamp.toISOString()}
timestamp: ${timestamp.getTime()}
agent_id: ${thoughts.agent_id || 'unknown'}
model_id: ${thoughts.model_id || 'unknown'}
visibility_level: ${thoughts.visibility_level || 'private'}
---

${sections.join('\n\n')}
`;
  }
}
