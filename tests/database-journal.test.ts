// ABOUTME: Unit tests for SQLite database-backed journal functionality  
// ABOUTME: Tests database operations, schema migration, and compatibility with existing interface

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { DatabaseJournalManager } from '../src/database-journal';
import { Database } from 'sqlite3';

describe('DatabaseJournalManager', () => {
  let tempDir: string;
  let dbPath: string;
  let dbManager: DatabaseJournalManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'journal-db-test-'));
    dbPath = path.join(tempDir, 'test.db');
    dbManager = new DatabaseJournalManager(dbPath);
    await dbManager.initialize();
  });

  afterEach(async () => {
    await dbManager.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('Database Schema', () => {
    test('creates journal_entries table with correct schema', async () => {
      // This test should fail initially since DatabaseJournalManager doesn't exist yet
      const tableInfo = await dbManager.getTableInfo('journal_entries');
      
      // Verify required columns exist
      const columnNames = tableInfo.map((col: any) => col.name);
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

    test('creates indexes for performance', async () => {
      const indexes = await dbManager.getIndexes();
      const indexNames = indexes.map((idx: any) => idx.name);
      
      expect(indexNames).toContain('idx_journal_entries_timestamp');
      expect(indexNames).toContain('idx_journal_entries_agent_id');
      expect(indexNames).toContain('idx_journal_entries_visibility');
      expect(indexNames).toContain('idx_journal_entries_date_string');
    });
  });

  describe('Entry Writing', () => {
    test('writes simple journal entry maintaining API compatibility', async () => {
      const content = 'This is a test journal entry.';
      
      await dbManager.writeEntry(content);
      
      const entries = await dbManager.getAllEntries();
      expect(entries).toHaveLength(1);
      
      const entry = entries[0];
      expect(entry.content).toContain(content);
      expect(entry.timestamp).toBeInstanceOf(Date);
      expect(entry.file_path).toMatch(/\.md$/);
      expect(entry.entry_type).toBe('simple');
    });

    test('generates embeddings for entries', async () => {
      const content = 'Technical insight about database design.';
      
      await dbManager.writeEntry(content);
      
      const entries = await dbManager.getAllEntries();
      expect(entries).toHaveLength(1);
      
      const entry = entries[0];
      expect(entry.embedding).toBeDefined();
      expect(entry.embedding).toBeInstanceOf(Buffer);
      expect(entry.searchable_text).toContain(content);
    });
  });

  describe('Thoughts Writing', () => {
    test('writes structured thoughts with agent metadata', async () => {
      const thoughts = {
        feelings: 'I feel great about this implementation',
        project_notes: 'Database schema is well designed',
        agent_id: 'senior-engineer',
        model_id: 'claude-sonnet-4',
        visibility_level: 'private' as const
      };
      
      await dbManager.writeThoughts(thoughts);
      
      const entries = await dbManager.getAllEntries();
      expect(entries.length).toBeGreaterThanOrEqual(1);
      
      // Should create entries for both user and project thoughts
      const projectEntry = entries.find(e => e.content.includes('Database schema'));
      const userEntry = entries.find(e => e.content.includes('I feel great'));
      
      expect(projectEntry).toBeDefined();
      expect(userEntry).toBeDefined();
      
      expect(projectEntry?.agent_id).toBe('senior-engineer');
      expect(projectEntry?.model_id).toBe('claude-sonnet-4');
      expect(projectEntry?.visibility_level).toBe('private');
    });
  });

  describe('Vector Search', () => {
    beforeEach(async () => {
      // Add some test entries for search
      await dbManager.writeEntry('Database design patterns for high-performance applications');
      await dbManager.writeEntry('Machine learning algorithms and neural networks');
      await dbManager.writeThoughts({
        technical_insights: 'Vector similarity search is powerful for semantic matching',
        project_notes: 'SQLite can handle blob storage efficiently',
        agent_id: 'senior-engineer'
      });
    });

    test('searches entries by vector similarity', async () => {
      const results = await dbManager.searchBySimilarity('database performance optimization', { limit: 10 });
      
      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
      
      // Should find database-related entry with higher score
      const dbEntry = results.find(r => r.content.includes('Database design patterns'));
      expect(dbEntry).toBeDefined();
      expect(dbEntry?.score).toBeGreaterThan(0);
    });

    test('filters search results by agent metadata', async () => {
      const results = await dbManager.searchBySimilarity('vector search', {
        agent_id: 'senior-engineer',
        limit: 10
      });
      
      expect(results).toBeDefined();
      const agentResults = results.filter(r => r.agent_id === 'senior-engineer');
      expect(agentResults.length).toBeGreaterThan(0);
    });

    test('filters search results by visibility level', async () => {
      const results = await dbManager.searchBySimilarity('database', {
        visibility_level: 'private',
        limit: 10
      });
      
      expect(results).toBeDefined();
      expect(results.every(r => r.visibility_level === 'private')).toBe(true);
    });

    test('returns results sorted by similarity score', async () => {
      const results = await dbManager.searchBySimilarity('database design', { limit: 10 });
      
      expect(results.length).toBeGreaterThan(1);
      
      // Verify results are sorted by score (descending)
      for (let i = 1; i < results.length; i++) {
        expect(results[i-1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });
  });

  describe('Recent Entries', () => {
    test('lists recent entries chronologically', async () => {
      // Add entries with slight delay to ensure different timestamps
      await dbManager.writeEntry('First entry');
      await new Promise(resolve => setTimeout(resolve, 10));
      await dbManager.writeEntry('Second entry');
      await new Promise(resolve => setTimeout(resolve, 10));
      await dbManager.writeEntry('Third entry');
      
      const recent = await dbManager.listRecent({ limit: 5 });
      
      expect(recent).toBeDefined();
      expect(recent.length).toBe(3);
      
      // Should be sorted by timestamp descending (most recent first)
      expect(recent[0].content).toContain('Third entry');
      expect(recent[1].content).toContain('Second entry');
      expect(recent[2].content).toContain('First entry');
    });
  });
});