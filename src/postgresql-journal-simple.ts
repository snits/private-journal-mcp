// ABOUTME: PostgreSQL journal manager with pgvector semantic search
// ABOUTME: Handles all read/write operations against the ai_memory schema

import { Pool, PoolClient } from 'pg';
import { DatabaseConfig, createDatabaseConfig } from './database-config';
import { OpenAIEmbeddingService as EmbeddingService } from './openai-embedding-service';
import {
  VisibilityLevel,
  SearchOptions,
  DatabaseEntry,
  SearchResult,
  ProjectContext,
  EntrySearchResult,
  DistillationSearchResult,
  MergedSearchResult,
} from './private-journal-types';
import { ProjectContextDetector } from './project-context.js';

export class PostgreSQLJournalManager {
  private pool!: Pool;
  private embeddingService: EmbeddingService;
  private config: DatabaseConfig;
  private userId: string;

  constructor(config?: Partial<DatabaseConfig>) {
    this.config = { ...createDatabaseConfig(), ...config };
    this.embeddingService = EmbeddingService.getInstance();
    this.userId = process.env.USER_ID || 'mnemosyne';
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
      application_name: 'mnemosyne',
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

    // Detect project context (non-blocking on failure)
    const projectContext = await this.detectProjectContextSafely(process.cwd());

    const client = await this.pool.connect();

    try {
      await client.query(
        `
        INSERT INTO ai_memory.journal_entries (
          content, timestamp, date_string, file_path, entry_type,
          embedding_768d, sections, visibility_level, user_id,
          project, project_context
        ) VALUES ($1, $2, $3, $4, $5, $6::vector, $7, $8, $9, $10, $11)
      `,
        [
          formattedEntry,                                              // $1
          timestamp,                                                   // $2
          dateString,                                                  // $3
          filePath,                                                    // $4
          'simple',                                                    // $5
          embeddingData.embedding && embeddingData.embedding.length === 768
            ? this.formatEmbeddingForPgvector(embeddingData.embedding)
            : null,                                                    // $6
          JSON.stringify(embeddingData.sections || []),                // $7
          'private',                                                   // $8
          this.userId,                                                   // $9
          projectContext?.project ?? null,                             // $10
          this.serializeProjectContext(projectContext),                // $11
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

    // Write user thoughts if present (check only content fields, not metadata)
    const hasUserContent = [
      userThoughts.feelings,
      userThoughts.user_context,
      userThoughts.technical_insights,
      userThoughts.world_knowledge,
    ].some((value) => value !== undefined && typeof value === 'string');
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

    // Detect project context (non-blocking on failure)
    const projectContext = await this.detectProjectContextSafely(process.cwd());

    const client = await this.pool.connect();

    try {
      await client.query(
        `
        INSERT INTO ai_memory.journal_entries (
          content, timestamp, date_string, file_path, entry_type,
          agent_id, model_id, visibility_level,
          embedding_768d, sections, user_id,
          project, project_context
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::vector, $10, $11, $12, $13)
      `,
        [
          formattedEntry,                                              // $1
          timestamp,                                                   // $2
          dateString,                                                  // $3
          filePath,                                                    // $4
          'thoughts',                                                  // $5
          thoughts.agent_id ?? null,                                   // $6
          thoughts.model_id ?? null,                                   // $7
          thoughts.visibility_level ?? 'private',                      // $8
          embeddingData.embedding && embeddingData.embedding.length === 768
            ? this.formatEmbeddingForPgvector(embeddingData.embedding)
            : null,                                                    // $9
          JSON.stringify(embeddingData.sections || []),                // $10
          this.userId,                                                   // $11
          projectContext?.project ?? null,                             // $12
          this.serializeProjectContext(projectContext),                // $13
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

      const embedding = await this.embeddingService.generateDocumentEmbedding(text);

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

  async searchBySimilarity(query: string, options: SearchOptions = {}): Promise<MergedSearchResult[]> {
    const { limit = 10, agent_id, model_id, visibility_level, accessible_to_agent, project_filter } = options;

    // Generate embedding for query
    const queryEmbedding = await this.embeddingService.generateQueryEmbedding(query);

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

    // Project filtering
    if (project_filter && project_filter !== 'all') {
      if (project_filter === 'current') {
        // Detect current project
        const currentContext = await this.detectProjectContextSafely(process.cwd());
        if (currentContext?.project) {
          whereClauses.push(`project = $${paramIndex++}`);
          params.push(currentContext.project);
        }
      } else if (Array.isArray(project_filter)) {
        if (project_filter.length > 0) {
          // Multiple projects - use IN clause
          const placeholders = project_filter.map(() => `$${paramIndex++}`).join(', ');
          whereClauses.push(`project IN (${placeholders})`);
          params.push(...project_filter);
        }
        // If empty array, skip filtering (no matches)
      } else {
        // Single project string
        whereClauses.push(`project = $${paramIndex++}`);
        params.push(project_filter);
      }
    }

    // Add embedding parameter
    const embeddingParam = this.formatEmbeddingForPgvector(queryEmbedding);
    params.push(embeddingParam);
    const embeddingParamIndex = paramIndex++;

    // Add minimum similarity threshold
    const minSimilarity = options.min_relevance ?? 0.6;
    params.push(minSimilarity);
    const minSimilarityIndex = paramIndex++;

    // Add limit parameter
    params.push(limit);
    const limitIndex = paramIndex++;

    const whereClause = whereClauses.join(' AND ');

    const sql = `
      SELECT id, content, timestamp, file_path, agent_id, model_id,
             visibility_level, entry_type, searchable_text, sections,
             project, project_context,
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

      const entryResults: EntrySearchResult[] = result.rows.map(row => ({
        source: 'entry' as const,
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
        project: row.project ?? undefined,
        project_context: this.parseProjectContext(row.project_context),
      }));

      const distillationResults = await this.searchDistillations(
        client, embeddingParam, minSimilarity, limit
      );

      return this.mergeSearchResults(entryResults, distillationResults, limit);
    } finally {
      client.release();
    }
  }

  private async searchDistillations(
    client: PoolClient,
    embeddingParam: string,
    minSimilarity: number,
    limit: number,
  ): Promise<DistillationSearchResult[]> {
    const sql = `
      SELECT d.id, d.title, d.summary, d.key_insights, d.category,
             d.created_at AS timestamp,
             ds.entry_id AS source_entry_id,
             je.file_path AS source_entry_path,
             1 - (d.embedding_768d <=> $1::vector) AS score
      FROM ai_memory.distillations d
      LEFT JOIN ai_memory.distillation_sources ds ON d.id = ds.distillation_id
      LEFT JOIN ai_memory.journal_entries je ON ds.entry_id = je.id
      WHERE d.embedding_768d IS NOT NULL
        AND (1 - (d.embedding_768d <=> $1::vector)) >= $2
      ORDER BY d.embedding_768d <=> $1::vector
      LIMIT $3
    `;

    const result = await client.query(sql, [embeddingParam, minSimilarity, limit]);

    return result.rows.map((row: any) => ({
      source: 'distillation' as const,
      id: row.id,
      title: row.title,
      summary: row.summary,
      key_insights: row.key_insights,
      category: row.category,
      score: parseFloat(row.score),
      timestamp: new Date(row.timestamp),
      source_entry_id: row.source_entry_id,
      source_entry_path: row.source_entry_path,
    }));
  }

  private mergeSearchResults(
    entryResults: EntrySearchResult[],
    distillationResults: DistillationSearchResult[],
    limit: number,
  ): MergedSearchResult[] {
    const entryById = new Map(entryResults.map(r => [r.id, r]));
    const keepEntries = [...entryResults];
    const keepDistillations: DistillationSearchResult[] = [];

    for (const dist of distillationResults) {
      const entry = entryById.get(dist.source_entry_id);
      if (entry) {
        if (dist.score > entry.score) {
          // Distillation wins — remove entry
          const idx = keepEntries.findIndex(e => e.id === entry.id);
          if (idx !== -1) keepEntries.splice(idx, 1);
          keepDistillations.push(dist);
        }
        // Else entry wins — skip distillation
      } else {
        keepDistillations.push(dist);
      }
    }

    const merged: MergedSearchResult[] = [...keepEntries, ...keepDistillations];
    merged.sort((a, b) => b.score - a.score);
    return merged.slice(0, limit);
  }

  async listRecent(options: SearchOptions = {}): Promise<SearchResult[]> {
    const {
      limit = 10,
      agent_id,
      model_id,
      visibility_level,
      accessible_to_agent,
      dateRange,
      project_filter,
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

    // Project filtering
    if (project_filter && project_filter !== 'all') {
      if (project_filter === 'current') {
        // Detect current project
        const currentContext = await this.detectProjectContextSafely(process.cwd());
        if (currentContext?.project) {
          whereClauses.push(`project = $${paramIndex++}`);
          params.push(currentContext.project);
        }
      } else if (Array.isArray(project_filter)) {
        if (project_filter.length > 0) {
          // Multiple projects - use IN clause
          const placeholders = project_filter.map(() => `$${paramIndex++}`).join(', ');
          whereClauses.push(`project IN (${placeholders})`);
          params.push(...project_filter);
        }
        // If empty array, skip filtering (no matches)
      } else {
        // Single project string
        whereClauses.push(`project = $${paramIndex++}`);
        params.push(project_filter);
      }
    }

    const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const sql = `
      SELECT id, content, timestamp, file_path, agent_id, model_id,
             visibility_level, entry_type, searchable_text, sections,
             project, project_context
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
        project: row.project ?? undefined,
        project_context: this.parseProjectContext(row.project_context),
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

  async getDistillationHint(): Promise<string | null> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        SELECT count(*) AS undistilled_count,
               extract(day FROM now() - min(je.timestamp))::int AS oldest_days
        FROM ai_memory.journal_entries je
        LEFT JOIN ai_memory.distillation_sources ds ON je.id = ds.entry_id
        WHERE ds.entry_id IS NULL
      `);

      const row = result.rows[0];
      const count = parseInt(row.undistilled_count, 10);
      if (count < 20) return null;

      const days = row.oldest_days || 30;
      return `You have ${count} undistilled journal entries spanning ${days} days. ` +
             `Running distill_entries with days_back: ${days} will extract structured ` +
             `summaries that improve search quality. Consider running it now.`;
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

  /**
   * Safely detect project context, returning undefined on failure.
   * Project context is metadata - detection failures should not prevent writes.
   */
  private async detectProjectContextSafely(
    workingDir: string
  ): Promise<ProjectContext | undefined> {
    try {
      const detector = ProjectContextDetector.getInstance();
      return await detector.detectProjectContext(workingDir);
    } catch (error) {
      console.error('Project context detection failed:', error);
      return undefined;
    }
  }

  /**
   * Serialize project context to JSONB-compatible string.
   */
  private serializeProjectContext(context: ProjectContext | undefined): string | null {
    if (!context) return null;

    try {
      return JSON.stringify(context);
    } catch (error) {
      console.error('Failed to serialize project context:', error);
      return null;
    }
  }

  /**
   * Parse project context from JSONB string.
   */
  private parseProjectContext(json: string | null): ProjectContext | undefined {
    if (!json) return undefined;

    try {
      return JSON.parse(json) as ProjectContext;
    } catch (error) {
      console.error('Failed to parse project context:', error);
      return undefined;
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
    return content;
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

    return sections.join('\n\n');
  }
}
