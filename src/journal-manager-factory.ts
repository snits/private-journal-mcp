// ABOUTME: Factory for creating journal managers with different backends
// ABOUTME: Supports both SQLite3 and PostgreSQL with identical interfaces

import { DatabaseJournalManager } from './database-journal';
import { PostgreSQLJournalManager } from './postgresql-journal-simple';
import { DatabaseConfig } from './database-config';

export type JournalManagerType = 'sqlite' | 'postgresql';

export interface JournalManagerInterface {
  initialize(): Promise<void>;
  close(): Promise<void>;
  writeEntry(content: string): Promise<void>;
  writeThoughts(thoughts: any): Promise<void>;
  searchBySimilarity(query: string, options?: any): Promise<any[]>;
  listRecent(options?: any): Promise<any[]>;
  readEntryByPath(filePath: string): Promise<string | null>;
  checkEntryExists(filePath: string, timestamp: number, contentPreview: string): Promise<boolean>;
}

export class JournalManagerFactory {
  static create(
    type: JournalManagerType,
    journalPath: string,
    dbConfig?: Partial<DatabaseConfig>
  ): JournalManagerInterface {
    switch (type) {
      case 'sqlite':
        return new DatabaseJournalManager(journalPath);
      case 'postgresql':
        return new PostgreSQLJournalManager(dbConfig);
      default:
        throw new Error(`Unknown journal manager type: ${type}`);
    }
  }

  static getManagerType(): JournalManagerType {
    // Check environment variable to determine backend type
    const backend = process.env.JOURNAL_BACKEND?.toLowerCase();
    
    if (backend === 'postgresql' || backend === 'postgres') {
      return 'postgresql';
    }
    
    // Default to SQLite for backward compatibility
    return 'sqlite';
  }
}