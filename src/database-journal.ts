// ABOUTME: SQLite database-backed journal manager for high-performance storage
// ABOUTME: Provides same API as file-based JournalManager with vector embeddings support

import { Database } from 'sqlite3';
import { promisify } from 'util';
import * as path from 'path';
import { JournalEntry, VisibilityLevel, SearchOptions } from './types';
import { EmbeddingService, EmbeddingData } from './embeddings';

interface DatabaseEntry {
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

interface SearchResult {
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

export class DatabaseJournalManager {
  private db!: Database;
  private embeddingService: EmbeddingService;
  private dbPath: string;

  // Promisified database methods
  private runAsync!: (sql: string, params?: any[]) => Promise<any>;
  private getAsync!: (sql: string, params?: any[]) => Promise<any>;
  private allAsync!: (sql: string, params?: any[]) => Promise<any[]>;

  constructor(journalPath: string) {
    // Store database in the journal directory
    this.dbPath = path.join(journalPath, 'journal.db');
    this.embeddingService = EmbeddingService.getInstance();
  }

  async initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db = new Database(this.dbPath, (err) => {
        if (err) {
          reject(new Error(`Failed to open database: ${err.message}`));
          return;
        }

        // Promisify database methods
        this.runAsync = promisify(this.db.run.bind(this.db));
        this.getAsync = promisify(this.db.get.bind(this.db));
        this.allAsync = promisify(this.db.all.bind(this.db));

        this.createSchema()
          .then(() => resolve())
          .catch(reject);
      });
    });
  }

  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        resolve();
        return;
      }
      
      this.db.close((err) => {
        if (err) {
          reject(new Error(`Failed to close database: ${err.message}`));
        } else {
          resolve();
        }
      });
    });
  }

  private async createSchema(): Promise<void> {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS journal_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        date_string TEXT NOT NULL,
        file_path TEXT NOT NULL,
        agent_id TEXT,
        model_id TEXT,
        visibility_level TEXT NOT NULL DEFAULT 'private',
        entry_type TEXT NOT NULL,
        embedding BLOB,
        searchable_text TEXT,
        sections TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      )
    `;

    await this.runAsync(createTableSQL);
    await this.createIndexes();
  }

  private async createIndexes(): Promise<void> {
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_journal_entries_timestamp ON journal_entries(timestamp)',
      'CREATE INDEX IF NOT EXISTS idx_journal_entries_agent_id ON journal_entries(agent_id)',
      'CREATE INDEX IF NOT EXISTS idx_journal_entries_visibility ON journal_entries(visibility_level)',
      'CREATE INDEX IF NOT EXISTS idx_journal_entries_date_string ON journal_entries(date_string)'
    ];

    for (const indexSQL of indexes) {
      await this.runAsync(indexSQL);
    }
  }

  async writeEntry(content: string): Promise<void> {
    const timestamp = new Date();
    const dateString = this.formatDate(timestamp);
    const timeString = this.formatTimestamp(timestamp);
    const filePath = `${dateString}/${timeString}.md`;

    const formattedEntry = this.formatEntry(content, timestamp);
    
    // Generate embedding
    const embeddingData = await this.generateEmbeddingForContent(formattedEntry, timestamp, filePath);

    await this.runAsync(`
      INSERT INTO journal_entries (
        content, timestamp, date_string, file_path, entry_type,
        embedding, searchable_text, sections, visibility_level
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      formattedEntry,
      timestamp.getTime(),
      dateString,
      filePath,
      'simple',
      embeddingData.embedding ? Buffer.from(new Float32Array(embeddingData.embedding).buffer) : null,
      embeddingData.text,
      JSON.stringify(embeddingData.sections),
      'private'
    ]);
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
    
    // Split thoughts into project-local and user-global, preserving agent metadata
    const projectThoughts = { 
      project_notes: thoughts.project_notes,
      agent_id: thoughts.agent_id,
      model_id: thoughts.model_id,
      visibility_level: thoughts.visibility_level || 'private'
    };
    const userThoughts = {
      feelings: thoughts.feelings,
      user_context: thoughts.user_context,
      technical_insights: thoughts.technical_insights,
      world_knowledge: thoughts.world_knowledge,
      agent_id: thoughts.agent_id,
      model_id: thoughts.model_id,
      visibility_level: thoughts.visibility_level || 'private'
    };
    
    // Write project notes if present
    if (projectThoughts.project_notes) {
      await this.writeThoughtsToDatabase(projectThoughts, timestamp, 'project');
    }
    
    // Write user thoughts if present
    const hasUserContent = Object.values(userThoughts).some(value => 
      value !== undefined && typeof value === 'string'
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
    const embeddingData = await this.generateEmbeddingForContent(formattedEntry, timestamp, filePath);

    await this.runAsync(`
      INSERT INTO journal_entries (
        content, timestamp, date_string, file_path, entry_type,
        agent_id, model_id, visibility_level,
        embedding, searchable_text, sections
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      formattedEntry,
      timestamp.getTime(),
      dateString,
      filePath,
      'thoughts',
      thoughts.agent_id || null,
      thoughts.model_id || null,
      thoughts.visibility_level || 'private',
      embeddingData.embedding ? Buffer.from(new Float32Array(embeddingData.embedding).buffer) : null,
      embeddingData.text,
      JSON.stringify(embeddingData.sections)
    ]);
  }

  private async generateEmbeddingForContent(
    content: string,
    timestamp: Date,
    filePath: string
  ): Promise<EmbeddingData> {
    try {
      const { text, sections } = this.embeddingService.extractSearchableText(content);
      
      if (text.trim().length === 0) {
        return {
          embedding: [],
          text: '',
          sections: [],
          timestamp: timestamp.getTime(),
          path: filePath
        };
      }

      const embedding = await this.embeddingService.generateEmbedding(text);
      
      return {
        embedding,
        text,
        sections,
        timestamp: timestamp.getTime(),
        path: filePath
      };
    } catch (error) {
      console.error(`Failed to generate embedding for ${filePath}:`, error);
      return {
        embedding: [],
        text: '',
        sections: [],
        timestamp: timestamp.getTime(),
        path: filePath
      };
    }
  }

  // Utility methods for compatibility with existing code
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
    const microseconds = String(date.getMilliseconds() * 1000 + Math.floor(Math.random() * 1000)).padStart(6, '0');
    return `${hours}-${minutes}-${seconds}-${microseconds}`;
  }

  private formatEntry(content: string, timestamp: Date): string {
    const timeDisplay = timestamp.toLocaleTimeString('en-US', { 
      hour12: true, 
      hour: 'numeric', 
      minute: '2-digit', 
      second: '2-digit' 
    });
    const dateDisplay = timestamp.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });

    return `---
title: "${timeDisplay} - ${dateDisplay}"
date: ${timestamp.toISOString()}
timestamp: ${timestamp.getTime()}
---

${content}
`;
  }

  private formatThoughts(thoughts: {
    feelings?: string;
    project_notes?: string;
    user_context?: string;
    technical_insights?: string;
    world_knowledge?: string;
    agent_id?: string;
    model_id?: string;
    visibility_level?: VisibilityLevel;
  }, timestamp: Date): string {
    const timeDisplay = timestamp.toLocaleTimeString('en-US', { 
      hour12: true, 
      hour: 'numeric', 
      minute: '2-digit', 
      second: '2-digit' 
    });
    const dateDisplay = timestamp.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
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

  async searchBySimilarity(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const {
      limit = 10,
      agent_id,
      model_id,
      visibility_level,
      accessible_to_agent
    } = options;

    // Generate embedding for query
    const queryEmbedding = await this.embeddingService.generateEmbedding(query);
    
    // Build WHERE clauses for filtering
    const whereClauses: string[] = ['embedding IS NOT NULL'];
    const params: any[] = [];

    if (agent_id) {
      whereClauses.push('agent_id = ?');
      params.push(agent_id);
    }

    if (model_id) {
      whereClauses.push('model_id = ?');
      params.push(model_id);
    }

    if (visibility_level) {
      whereClauses.push('visibility_level = ?');
      params.push(visibility_level);
    }

    if (accessible_to_agent) {
      // Filter by visibility rules
      whereClauses.push(`(
        visibility_level = 'public' OR
        visibility_level = 'team' OR
        visibility_level = 'crb' OR
        (visibility_level = 'private' AND agent_id = ?)
      )`);
      params.push(accessible_to_agent);
    }

    const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    
    const sql = `
      SELECT id, content, timestamp, file_path, agent_id, model_id, 
             visibility_level, entry_type, searchable_text, sections, embedding
      FROM journal_entries 
      ${whereClause}
      ORDER BY timestamp DESC
    `;

    const rows = await this.allAsync(sql, params);
    
    // Calculate similarity scores
    const results: SearchResult[] = [];
    for (const row of rows) {
      if (!row.embedding) continue;
      
      try {
        // Convert Buffer back to number array
        const embeddingArray = Array.from(new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4));
        const score = this.embeddingService.cosineSimilarity(queryEmbedding, embeddingArray);
        
        if (score > 0.1) { // Minimum similarity threshold
          results.push({
            id: row.id,
            content: row.content,
            timestamp: new Date(row.timestamp),
            file_path: row.file_path,
            agent_id: row.agent_id,
            model_id: row.model_id,
            visibility_level: row.visibility_level,
            entry_type: row.entry_type,
            score,
            searchable_text: row.searchable_text,
            sections: row.sections ? JSON.parse(row.sections) : []
          });
        }
      } catch (error) {
        console.error(`Failed to process embedding for entry ${row.id}:`, error);
        continue;
      }
    }

    // Sort by similarity score (descending) and limit results
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  async listRecent(options: SearchOptions = {}): Promise<SearchResult[]> {
    const {
      limit = 10,
      agent_id,
      model_id,
      visibility_level,
      accessible_to_agent,
      dateRange
    } = options;

    // Build WHERE clauses for filtering
    const whereClauses: string[] = [];
    const params: any[] = [];

    if (agent_id) {
      whereClauses.push('agent_id = ?');
      params.push(agent_id);
    }

    if (model_id) {
      whereClauses.push('model_id = ?');
      params.push(model_id);
    }

    if (visibility_level) {
      whereClauses.push('visibility_level = ?');
      params.push(visibility_level);
    }

    if (accessible_to_agent) {
      whereClauses.push(`(
        visibility_level = 'public' OR
        visibility_level = 'team' OR
        visibility_level = 'crb' OR
        (visibility_level = 'private' AND agent_id = ?)
      )`);
      params.push(accessible_to_agent);
    }

    if (dateRange) {
      if (dateRange.start) {
        whereClauses.push('timestamp >= ?');
        params.push(dateRange.start.getTime());
      }
      if (dateRange.end) {
        whereClauses.push('timestamp <= ?');
        params.push(dateRange.end.getTime());
      }
    }

    const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    
    const sql = `
      SELECT id, content, timestamp, file_path, agent_id, model_id, 
             visibility_level, entry_type, searchable_text, sections
      FROM journal_entries 
      ${whereClause}
      ORDER BY timestamp DESC
      LIMIT ?
    `;

    params.push(limit);
    const rows = await this.allAsync(sql, params);
    
    return rows.map(row => ({
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
      sections: row.sections ? JSON.parse(row.sections) : []
    }));
  }

  // Test helper methods
  async getTableInfo(tableName: string): Promise<any[]> {
    return this.allAsync(`PRAGMA table_info(${tableName})`);
  }

  async getIndexes(): Promise<any[]> {
    return this.allAsync(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='journal_entries'`);
  }

  async getAllEntries(): Promise<DatabaseEntry[]> {
    const rows = await this.allAsync('SELECT * FROM journal_entries ORDER BY timestamp DESC');
    return rows.map(row => ({
      ...row,
      timestamp: new Date(row.timestamp),
      created_at: new Date(row.created_at * 1000),
      sections: row.sections ? JSON.parse(row.sections) : []
    }));
  }
}