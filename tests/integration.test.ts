// ABOUTME: Integration tests for complete migration and search workflow
// ABOUTME: Tests end-to-end functionality from file-based to database operations

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { DatabaseJournalManager } from '../src/database-journal';
import { JournalManager } from '../src/journal';
import { MigrationService } from '../src/migration';
import { SearchService } from '../src/search';

describe('Integration Tests', () => {
  let tempDir: string;
  let fileSourceDir: string;
  let userSourceDir: string;
  let dbPath: string;
  let fileManager: JournalManager;
  let dbManager: DatabaseJournalManager;
  let migrationService: MigrationService;
  let fileSearchService: SearchService;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'integration-test-'));
    fileSourceDir = path.join(tempDir, 'file-journals');
    userSourceDir = path.join(tempDir, 'user-journals');
    dbPath = path.join(tempDir, 'test.db');
    
    // Create source directories
    await fs.mkdir(fileSourceDir, { recursive: true });
    await fs.mkdir(userSourceDir, { recursive: true });
    
    // Initialize services
    fileManager = new JournalManager(fileSourceDir, userSourceDir);
    dbManager = new DatabaseJournalManager(dbPath);
    await dbManager.initialize();
    
    migrationService = new MigrationService(fileSourceDir, userSourceDir, dbManager);
    fileSearchService = new SearchService(fileSourceDir, userSourceDir);
  });

  afterEach(async () => {
    await dbManager.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('Complete Migration Workflow', () => {
    test('migrates diverse journal content and maintains search functionality', async () => {
      // Create diverse content using file-based manager
      await fileManager.writeEntry('Database design patterns for microservices architecture');
      await fileManager.writeEntry('Machine learning model deployment strategies');
      
      await fileManager.writeThoughts({
        feelings: 'Excited about the new search capabilities',
        project_notes: 'Database migration is proceeding smoothly',
        technical_insights: 'Vector embeddings provide excellent semantic search',
        world_knowledge: 'SQLite is surprisingly powerful for embedding storage',
        agent_id: 'senior-engineer',
        model_id: 'claude-sonnet-4',
        visibility_level: 'private'
      });

      await fileManager.writeThoughts({
        user_context: 'Jerry prefers pragmatic solutions over complex ones',
        technical_insights: 'Simple implementations often outperform complex ones',
        agent_id: 'code-reviewer',
        model_id: 'claude-sonnet-4',
        visibility_level: 'team'
      });

      // Wait for embeddings to be generated
      await new Promise(resolve => setTimeout(resolve, 200));

      // Perform migration
      const discoveredEntries = await migrationService.discoverEntries();
      expect(discoveredEntries.length).toBeGreaterThanOrEqual(4);
      
      const migrationResult = await migrationService.migrateEntries(discoveredEntries);
      expect(migrationResult.success).toBe(true);
      expect(migrationResult.migratedCount).toBe(discoveredEntries.length);

      // Verify all entries migrated
      const dbEntries = await dbManager.getAllEntries();
      expect(dbEntries.length).toBe(discoveredEntries.length);

      // Test database search functionality
      const searchResults = await dbManager.searchBySimilarity('database architecture', { limit: 5 });
      expect(searchResults.length).toBeGreaterThan(0);
      
      const dbResult = searchResults.find(r => r.content.includes('Database design patterns'));
      expect(dbResult).toBeDefined();
      expect(dbResult?.score).toBeGreaterThan(0.3); // Should have good similarity

      // Test agent filtering
      const agentResults = await dbManager.searchBySimilarity('technical insights', {
        agent_id: 'senior-engineer',
        limit: 5
      });
      expect(agentResults.length).toBeGreaterThan(0);
      expect(agentResults.every(r => r.agent_id === 'senior-engineer')).toBe(true);

      // Test visibility filtering
      const teamResults = await dbManager.listRecent({
        visibility_level: 'team',
        limit: 10
      });
      expect(teamResults.some(r => r.visibility_level === 'team')).toBe(true);
    });

    test('preserves exact content and metadata during migration', async () => {
      const originalContent = `Technical analysis of the migration system:

## Key Insights
- Vector embeddings enable semantic search
- SQLite provides excellent performance for our use case
- Batch processing ensures efficient migration

## Implementation Notes
- Used Float32Array for embedding storage
- Implemented proper transaction boundaries
- Added comprehensive error handling`;

      await fileManager.writeThoughts({
        technical_insights: originalContent,
        agent_id: 'systems-architect',
        model_id: 'claude-sonnet-4',
        visibility_level: 'crb'
      });

      // Wait for embedding generation
      await new Promise(resolve => setTimeout(resolve, 100));

      // Migrate
      const discoveredEntries = await migrationService.discoverEntries();
      const migrationResult = await migrationService.migrateEntries(discoveredEntries);
      
      expect(migrationResult.success).toBe(true);

      // Verify exact content preservation
      const dbEntries = await dbManager.getAllEntries();
      const migratedEntry = dbEntries.find(e => e.content.includes('Technical analysis'));
      
      expect(migratedEntry).toBeDefined();
      expect(migratedEntry?.content).toContain('## Key Insights');
      expect(migratedEntry?.content).toContain('Vector embeddings enable semantic search');
      expect(migratedEntry?.content).toContain('## Implementation Notes');
      expect(migratedEntry?.agent_id).toBe('systems-architect');
      expect(migratedEntry?.model_id).toBe('claude-sonnet-4');
      expect(migratedEntry?.visibility_level).toBe('crb');
    });

    test('handles large volume migration efficiently', async () => {
      // Create a realistic volume of entries
      const entries = [];
      for (let i = 0; i < 50; i++) {
        entries.push(fileManager.writeEntry(`Test entry ${i}: ${Math.random().toString(36)}`));
      }
      
      // Create some thoughts entries too
      for (let i = 0; i < 10; i++) {
        entries.push(fileManager.writeThoughts({
          project_notes: `Project insight ${i}: Database performance is excellent`,
          technical_insights: `Technical note ${i}: Vector search scales well`,
          agent_id: i % 2 === 0 ? 'senior-engineer' : 'code-reviewer'
        }));
      }

      await Promise.all(entries);

      // Track migration progress
      const progressUpdates: number[] = [];
      const startTime = Date.now();
      
      const discoveredEntries = await migrationService.discoverEntries();
      expect(discoveredEntries.length).toBeGreaterThanOrEqual(60); // Should have at least 60 entries

      const migrationResult = await migrationService.migrateEntries(discoveredEntries, {
        batchSize: 10,
        onProgress: (processed: number, total: number) => {
          progressUpdates.push(processed);
        }
      });

      const duration = Date.now() - startTime;

      expect(migrationResult.success).toBe(true);
      expect(migrationResult.migratedCount).toBe(discoveredEntries.length);
      expect(migrationResult.duration).toBeLessThan(30000); // Should complete in under 30 seconds
      expect(progressUpdates.length).toBeGreaterThan(0);
      expect(progressUpdates[progressUpdates.length - 1]).toBe(discoveredEntries.length);

      // Verify performance of database operations
      const searchStart = Date.now();
      const searchResults = await dbManager.searchBySimilarity('database performance', { limit: 10 });
      const searchDuration = Date.now() - searchStart;
      
      expect(searchDuration).toBeLessThan(1000); // Search should be fast
      expect(searchResults.length).toBeGreaterThan(0);
    });
  });

  describe('Search Compatibility', () => {
    test('database search provides similar results to file-based search', async () => {
      // Create test content
      await fileManager.writeEntry('TypeScript interface design patterns');
      await fileManager.writeEntry('Database indexing strategies for performance');
      await fileManager.writeEntry('Machine learning feature engineering techniques');
      
      await fileManager.writeThoughts({
        technical_insights: 'Vector databases are revolutionizing search',
        project_notes: 'Our implementation leverages SQLite effectively'
      });

      // Wait for embeddings
      await new Promise(resolve => setTimeout(resolve, 200));

      // Get file-based search results
      const fileResults = await fileSearchService.search('database design patterns', { limit: 5 });

      // Migrate to database
      const discoveredEntries = await migrationService.discoverEntries();
      await migrationService.migrateEntries(discoveredEntries);

      // Get database search results
      const dbResults = await dbManager.searchBySimilarity('database design patterns', { limit: 5 });

      // Results should be comparable
      expect(dbResults.length).toBeGreaterThan(0);
      expect(fileResults.length).toBeGreaterThan(0);

      // Should find database-related content in top results
      const hasDbContentFile = fileResults.some(r => r.text.toLowerCase().includes('database'));
      const hasDbContentDb = dbResults.some(r => r.content.toLowerCase().includes('database'));
      
      expect(hasDbContentFile).toBe(true);
      expect(hasDbContentDb).toBe(true);
    });
  });
});