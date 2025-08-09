// ABOUTME: Unit tests for PostgreSQL database-backed journal functionality following TDD methodology
// ABOUTME: Tests PostgreSQL adapter with identical API surface to SQLite DatabaseJournalManager

import { PostgreSQLJournalManager } from '../src/postgresql-journal';
import { VisibilityLevel } from '../src/types';

describe('PostgreSQLJournalManager', () => {
  let dbManager: PostgreSQLJournalManager;

  beforeEach(async () => {
    // This will fail initially since PostgreSQLJournalManager doesn't exist yet
    dbManager = new PostgreSQLJournalManager({
      host: process.env.TEST_DB_HOST || 'localhost',
      port: parseInt(process.env.TEST_DB_PORT || '5432'),
      database: process.env.TEST_DB_NAME || 'private_journal_test',
      username: process.env.TEST_DB_USER || 'postgres',
      password: process.env.TEST_DB_PASSWORD || 'postgres',
    });
    await dbManager.initialize();
  });

  afterEach(async () => {
    await dbManager.close();
  });

  describe('Database Schema Compatibility', () => {
    test('creates journal_entries table with SQLite-compatible schema', async () => {
      // This test should fail initially since PostgreSQLJournalManager doesn't exist yet
      const tableInfo = await dbManager.getTableInfo('journal_entries');
      
      // Verify required columns exist (same as SQLite version)
      const columnNames = tableInfo.map((col: any) => col.column_name);
      expect(columnNames).toContain('id');
      expect(columnNames).toContain('content');
      expect(columnNames).toContain('timestamp');
      expect(columnNames).toContain('date_string');
      expect(columnNames).toContain('file_path');
      expect(columnNames).toContain('agent_id');
      expect(columnNames).toContain('model_id');
      expect(columnNames).toContain('visibility_level');
      expect(columnNames).toContain('entry_type');
      expect(columnNames).toContain('embedding');
      expect(columnNames).toContain('searchable_text');
      expect(columnNames).toContain('sections');
      expect(columnNames).toContain('created_at');
    });

    test('creates indexes for performance matching SQLite schema', async () => {
      const indexes = await dbManager.getIndexes();
      const indexNames = indexes.map((idx: any) => idx.indexname);
      
      expect(indexNames).toContain('idx_journal_entries_timestamp');
      expect(indexNames).toContain('idx_journal_entries_agent_id');
      expect(indexNames).toContain('idx_journal_entries_visibility');
      expect(indexNames).toContain('idx_journal_entries_date_string');
      expect(indexNames).toContain('idx_journal_entries_file_path');
    });
  });

  describe('Entry Writing API Compatibility', () => {
    test('writeEntry maintains identical API signature with SQLite version', async () => {
      const content = 'This is a test journal entry with PostgreSQL backend.';
      
      // This should maintain the exact same API as SQLite version
      await dbManager.writeEntry(content);
      
      const entries = await dbManager.getAllEntries();
      expect(entries).toHaveLength(1);
      
      const entry = entries[0];
      expect(entry.content).toContain(content);
      expect(entry.timestamp).toBeInstanceOf(Date);
      expect(entry.file_path).toMatch(/\.md$/);
      expect(entry.entry_type).toBe('simple');
      expect(entry.visibility_level).toBe('private');
    });

    test('handles embedding generation with Buffer/Float32Array compatibility', async () => {
      const content = 'Technical insight about PostgreSQL migration patterns.';
      
      await dbManager.writeEntry(content);
      
      const entries = await dbManager.getAllEntries();
      expect(entries).toHaveLength(1);
      
      const entry = entries[0];
      // Should maintain Buffer compatibility with SQLite version
      expect(entry.embedding).toBeDefined();
      expect(entry.embedding).toBeInstanceOf(Buffer);
      expect(entry.searchable_text).toContain(content);
    });

    test('checkEntryExists prevents duplicates with timestamp tolerance', async () => {
      const content = 'Duplicate prevention test content';
      const timestamp = Date.now();
      
      // First write should succeed
      const exists1 = await dbManager.checkEntryExists('test/path.md', timestamp, content);
      expect(exists1).toBe(false);
      
      await dbManager.writeEntry(content);
      
      // Second check within time window should detect duplicate
      const exists2 = await dbManager.checkEntryExists('test/path.md', timestamp + 30000, content);
      expect(exists2).toBe(true);
    });
  });

  describe('Thoughts Writing API Compatibility', () => {
    test('writeThoughts maintains identical structured input format', async () => {
      const thoughts = {
        feelings: 'I feel confident about PostgreSQL migration',
        project_notes: 'Database migration is proceeding smoothly with TDD approach',
        technical_insights: 'PostgreSQL pgvector will enable better embedding storage',
        agent_id: 'senior-engineer',
        model_id: 'claude-sonnet-4',
        visibility_level: 'private' as VisibilityLevel
      };
      
      await dbManager.writeThoughts(thoughts);
      
      const entries = await dbManager.getAllEntries();
      expect(entries.length).toBeGreaterThanOrEqual(1);
      
      // Should create separate entries for project and user thoughts
      const projectEntry = entries.find(e => e.content.includes('Database migration'));
      const userEntry = entries.find(e => e.content.includes('I feel confident'));
      
      expect(projectEntry).toBeDefined();
      expect(userEntry).toBeDefined();
      
      expect(projectEntry?.agent_id).toBe('senior-engineer');
      expect(projectEntry?.model_id).toBe('claude-sonnet-4');
      expect(projectEntry?.visibility_level).toBe('private');
      expect(projectEntry?.entry_type).toBe('thoughts');
    });

    test('splits thoughts into project and user categories correctly', async () => {
      const thoughts = {
        project_notes: 'Project-specific insight about database design',
        feelings: 'User-global feeling about the work',
        agent_id: 'test-agent'
      };
      
      await dbManager.writeThoughts(thoughts);
      
      const entries = await dbManager.getAllEntries();
      expect(entries).toHaveLength(2);
      
      const projectEntry = entries.find(e => e.file_path.startsWith('project/'));
      const userEntry = entries.find(e => e.file_path.startsWith('user/'));
      
      expect(projectEntry).toBeDefined();
      expect(userEntry).toBeDefined();
      expect(projectEntry?.content).toContain('Project-specific insight');
      expect(userEntry?.content).toContain('User-global feeling');
    });
  });

  describe('Vector Search API Compatibility', () => {
    beforeEach(async () => {
      // Add test data for search functionality
      await dbManager.writeEntry('PostgreSQL database design patterns for AI applications');
      await dbManager.writeEntry('Machine learning model optimization techniques');
      await dbManager.writeThoughts({
        technical_insights: 'Vector similarity with pgvector enables semantic search',
        project_notes: 'PostgreSQL migration maintains backward compatibility',
        agent_id: 'senior-engineer'
      });
    });

    test('searchBySimilarity maintains identical API signature', async () => {
      const results = await dbManager.searchBySimilarity('database performance optimization', { 
        limit: 10 
      });
      
      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
      
      // Verify result structure matches SQLite version
      const firstResult = results[0];
      expect(firstResult).toHaveProperty('id');
      expect(firstResult).toHaveProperty('content');
      expect(firstResult).toHaveProperty('timestamp');
      expect(firstResult).toHaveProperty('file_path');
      expect(firstResult).toHaveProperty('score');
      expect(firstResult).toHaveProperty('searchable_text');
      expect(firstResult).toHaveProperty('sections');
      
      expect(firstResult.timestamp).toBeInstanceOf(Date);
      expect(typeof firstResult.score).toBe('number');
    });

    test('filters by agent_id with identical API', async () => {
      const results = await dbManager.searchBySimilarity('vector search', {
        agent_id: 'senior-engineer',
        limit: 10
      });
      
      expect(results).toBeDefined();
      const agentResults = results.filter(r => r.agent_id === 'senior-engineer');
      expect(agentResults.length).toBeGreaterThan(0);
    });

    test('filters by visibility_level with identical API', async () => {
      const results = await dbManager.searchBySimilarity('database', {
        visibility_level: 'private',
        limit: 10
      });
      
      expect(results).toBeDefined();
      expect(results.every(r => r.visibility_level === 'private')).toBe(true);
    });

    test('returns results sorted by similarity score descending', async () => {
      const results = await dbManager.searchBySimilarity('database design', { limit: 10 });
      
      expect(results.length).toBeGreaterThan(1);
      
      // Verify results are sorted by score (descending)
      for (let i = 1; i < results.length; i++) {
        expect(results[i-1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });

    test('accessible_to_agent filtering works correctly', async () => {
      const results = await dbManager.searchBySimilarity('database', {
        accessible_to_agent: 'senior-engineer',
        limit: 10
      });
      
      expect(results).toBeDefined();
      // Should include public, team, crb, and private entries from the agent
      results.forEach(result => {
        const isAccessible = 
          result.visibility_level === 'public' ||
          result.visibility_level === 'team' ||
          result.visibility_level === 'crb' ||
          (result.visibility_level === 'private' && result.agent_id === 'senior-engineer');
        expect(isAccessible).toBe(true);
      });
    });
  });

  describe('Recent Entries API Compatibility', () => {
    test('listRecent maintains identical API signature', async () => {
      // Add entries with slight delay to ensure different timestamps
      await dbManager.writeEntry('First PostgreSQL entry');
      await new Promise(resolve => setTimeout(resolve, 10));
      await dbManager.writeEntry('Second PostgreSQL entry');
      await new Promise(resolve => setTimeout(resolve, 10));
      await dbManager.writeEntry('Third PostgreSQL entry');
      
      const recent = await dbManager.listRecent({ limit: 5 });
      
      expect(recent).toBeDefined();
      expect(recent.length).toBe(3);
      
      // Should be sorted by timestamp descending (most recent first)
      expect(recent[0].content).toContain('Third PostgreSQL entry');
      expect(recent[1].content).toContain('Second PostgreSQL entry');
      expect(recent[2].content).toContain('First PostgreSQL entry');
      
      // Verify result structure matches SQLite version
      recent.forEach(entry => {
        expect(entry).toHaveProperty('id');
        expect(entry).toHaveProperty('content');
        expect(entry).toHaveProperty('timestamp');
        expect(entry).toHaveProperty('file_path');
        expect(entry).toHaveProperty('score');
        expect(entry.score).toBe(1); // No similarity score for recent entries
      });
    });

    test('dateRange filtering works correctly', async () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      
      await dbManager.writeEntry('Entry within date range');
      
      const results = await dbManager.listRecent({
        dateRange: {
          start: yesterday,
          end: tomorrow
        },
        limit: 10
      });
      
      expect(results.length).toBeGreaterThan(0);
      results.forEach(entry => {
        expect(entry.timestamp.getTime()).toBeGreaterThanOrEqual(yesterday.getTime());
        expect(entry.timestamp.getTime()).toBeLessThanOrEqual(tomorrow.getTime());
      });
    });
  });

  describe('Entry Reading API Compatibility', () => {
    test('readEntryByPath maintains identical API signature', async () => {
      const content = 'Content for path-based reading test';
      await dbManager.writeEntry(content);
      
      const entries = await dbManager.getAllEntries();
      const entry = entries[0];
      
      const readContent = await dbManager.readEntryByPath(entry.file_path);
      expect(readContent).toBeDefined();
      expect(readContent).toContain(content);
    });

    test('returns null for non-existent paths', async () => {
      const content = await dbManager.readEntryByPath('non/existent/path.md');
      expect(content).toBeNull();
    });
  });

  describe('Connection and Transaction Safety', () => {
    test('handles connection pooling correctly', async () => {
      // Multiple concurrent operations should work
      const promises = Array.from({ length: 5 }, (_, i) =>
        dbManager.writeEntry(`Concurrent entry ${i}`)
      );
      
      await Promise.all(promises);
      
      const entries = await dbManager.getAllEntries();
      expect(entries.length).toBe(5);
    });

    test('maintains transaction safety for thoughts writing', async () => {
      const thoughts = {
        project_notes: 'Transaction test project note',
        feelings: 'Transaction test feeling',
        agent_id: 'test-agent'
      };
      
      // This should either succeed completely or fail completely
      await dbManager.writeThoughts(thoughts);
      
      const entries = await dbManager.getAllEntries();
      expect(entries.length).toBe(2); // Both project and user entries should be created
    });
  });

  describe('Test Helper Methods Compatibility', () => {
    test('getTableInfo returns PostgreSQL-compatible column information', async () => {
      const tableInfo = await dbManager.getTableInfo('journal_entries');
      expect(Array.isArray(tableInfo)).toBe(true);
      expect(tableInfo.length).toBeGreaterThan(0);
      expect(tableInfo[0]).toHaveProperty('column_name');
    });

    test('getIndexes returns PostgreSQL-compatible index information', async () => {
      const indexes = await dbManager.getIndexes();
      expect(Array.isArray(indexes)).toBe(true);
      expect(indexes.length).toBeGreaterThan(0);
      expect(indexes[0]).toHaveProperty('indexname');
    });

    test('getAllEntries returns entries with proper type conversion', async () => {
      await dbManager.writeEntry('Type conversion test');
      
      const entries = await dbManager.getAllEntries();
      expect(entries.length).toBe(1);
      
      const entry = entries[0];
      expect(entry.timestamp).toBeInstanceOf(Date);
      expect(entry.created_at).toBeInstanceOf(Date);
      expect(typeof entry.id).toBe('number');
      expect(Array.isArray(entry.sections)).toBe(true);
    });
  });
});