// ABOUTME: Factory for creating journal managers with PostgreSQL backend
// ABOUTME: Simplified to PostgreSQL-only after removing deprecated SQLite backend

import { PostgreSQLJournalManager } from './postgresql-journal-simple';
import { DatabaseConfig } from './database-config';

export type JournalManagerType = 'postgresql';

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
    if (type !== 'postgresql') {
      throw new Error(`Unknown journal manager type: ${type}`);
    }
    return new PostgreSQLJournalManager(dbConfig);
  }

  static getManagerType(): JournalManagerType {
    return 'postgresql';
  }
}
