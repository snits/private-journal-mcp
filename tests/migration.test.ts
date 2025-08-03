// ABOUTME: Tests for database migration functionality from file-based to SQLite storage
// ABOUTME: Validates data integrity and completeness during migration process

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { DatabaseJournalManager } from '../src/database-journal';
import { JournalManager } from '../src/journal';
import { MigrationService } from '../src/migration';

describe('Migration Service', () => {
  let tempDir: string;
  let fileSourceDir: string;
  let userSourceDir: string;
  let dbPath: string;
  let migrationService: MigrationService;
  let dbManager: DatabaseJournalManager;
  let fileManager: JournalManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'migration-test-'));
    fileSourceDir = path.join(tempDir, 'file-journals');
    userSourceDir = path.join(tempDir, 'user-journals');
    dbPath = path.join(tempDir, 'migrated.db');
    
    // Create source directories
    await fs.mkdir(fileSourceDir, { recursive: true });
    await fs.mkdir(userSourceDir, { recursive: true });
    
    // Initialize services
    fileManager = new JournalManager(fileSourceDir, userSourceDir);
    dbManager = new DatabaseJournalManager(dbPath);
    await dbManager.initialize();
    
    migrationService = new MigrationService(fileSourceDir, userSourceDir, dbManager);
  });

  afterEach(async () => {
    await dbManager.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('Entry Discovery', () => {
    test('discovers all journal entries in nested directory structure', async () => {
      // Create test entries with file-based manager
      await fileManager.writeEntry('Test entry 1');
      await fileManager.writeEntry('Test entry 2');
      await fileManager.writeThoughts({
        feelings: 'Test feelings',
        project_notes: 'Test project notes',
        agent_id: 'test-agent',
        model_id: 'test-model'
      });

      const discoveredEntries = await migrationService.discoverEntries();
      
      expect(discoveredEntries).toBeDefined();
      expect(Array.isArray(discoveredEntries)).toBe(true);
      expect(discoveredEntries.length).toBeGreaterThanOrEqual(3); // At least 3 entries created
      
      // Verify entry structure
      const entry = discoveredEntries[0];
      expect(entry).toHaveProperty('filePath');
      expect(entry).toHaveProperty('embeddingPath');
      expect(entry).toHaveProperty('type');
      expect(entry).toHaveProperty('metadata');
    });

    test('extracts agent metadata from file paths', async () => {
      // Create entries with agent metadata structure
      await fileManager.writeThoughts({
        project_notes: 'Test with agent metadata',
        agent_id: 'senior-engineer',
        model_id: 'claude-sonnet-4',
        visibility_level: 'private'
      });

      const discoveredEntries = await migrationService.discoverEntries();
      const agentEntry = discoveredEntries.find(e => 
        e.metadata.agent_id === 'senior-engineer'
      );
      
      expect(agentEntry).toBeDefined();
      expect(agentEntry?.metadata.model_id).toBe('claude-sonnet-4');
      expect(agentEntry?.metadata.visibility_level).toBe('private');
    });
  });

  describe('Data Migration', () => {
    test('migrates simple journal entries preserving content and metadata', async () => {
      // Create test entries
      await fileManager.writeEntry('Important project milestone achieved');
      await fileManager.writeEntry('Another significant development');

      // Discover and migrate
      const discoveredEntries = await migrationService.discoverEntries();
      const migrationResult = await migrationService.migrateEntries(discoveredEntries);
      
      expect(migrationResult.success).toBe(true);
      expect(migrationResult.migratedCount).toBe(2);
      expect(migrationResult.failedCount).toBe(0);
      
      // Verify entries in database
      const dbEntries = await dbManager.getAllEntries();
      expect(dbEntries.length).toBe(2);
      
      const entry1 = dbEntries.find(e => e.content.includes('Important project milestone'));
      const entry2 = dbEntries.find(e => e.content.includes('Another significant development'));
      
      expect(entry1).toBeDefined();
      expect(entry2).toBeDefined();
    });

    test('migrates structured thoughts preserving all sections', async () => {
      await fileManager.writeThoughts({
        feelings: 'Excited about the database migration',
        project_notes: 'Migration architecture is solid',
        technical_insights: 'SQLite performs well for this use case',
        world_knowledge: 'Database migrations require careful planning',
        agent_id: 'senior-engineer',
        model_id: 'claude-sonnet-4',
        visibility_level: 'private'
      });

      const discoveredEntries = await migrationService.discoverEntries();
      const migrationResult = await migrationService.migrateEntries(discoveredEntries);
      
      expect(migrationResult.success).toBe(true);
      expect(migrationResult.migratedCount).toBeGreaterThanOrEqual(1);
      
      // Verify thoughts sections preserved
      const dbEntries = await dbManager.getAllEntries();
      const thoughtsEntry = dbEntries.find(e => e.content.includes('database migration'));
      
      expect(thoughtsEntry).toBeDefined();
      expect(thoughtsEntry?.content).toContain('## Feelings');
      expect(thoughtsEntry?.content).toContain('Excited about the database migration');
      expect(thoughtsEntry?.agent_id).toBe('senior-engineer');
    });

    test('preserves embeddings during migration', async () => {
      await fileManager.writeEntry('Technical content for embedding preservation test');
      
      // Let embeddings be generated
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const discoveredEntries = await migrationService.discoverEntries();
      const migrationResult = await migrationService.migrateEntries(discoveredEntries);
      
      expect(migrationResult.success).toBe(true);
      
      // Verify embeddings are preserved
      const dbEntries = await dbManager.getAllEntries();
      const embeddedEntry = dbEntries.find(e => 
        e.content.includes('embedding preservation test')
      );
      
      expect(embeddedEntry).toBeDefined();
      expect(embeddedEntry?.embedding).toBeDefined();
      expect(embeddedEntry?.searchable_text).toContain('Technical content');
    });
  });

  describe('Migration Progress and Error Handling', () => {
    test('reports progress during large migration', async () => {
      // Create multiple entries
      for (let i = 0; i < 10; i++) {
        await fileManager.writeEntry(`Test entry ${i}`);
      }

      const discoveredEntries = await migrationService.discoverEntries();
      expect(discoveredEntries.length).toBe(10);
      
      const progressUpdates: number[] = [];
      const migrationResult = await migrationService.migrateEntries(
        discoveredEntries,
        {
          onProgress: (processed: number, total: number) => {
            progressUpdates.push(processed);
          }
        }
      );
      
      expect(migrationResult.success).toBe(true);
      expect(migrationResult.migratedCount).toBe(10);
      expect(progressUpdates.length).toBeGreaterThan(0);
      expect(progressUpdates[progressUpdates.length - 1]).toBe(10);
    });

    test('handles missing embedding files gracefully', async () => {
      // Create entry but manually remove embedding file
      await fileManager.writeEntry('Entry with missing embedding');
      
      const discoveredEntries = await migrationService.discoverEntries();
      const entryWithEmbedding = discoveredEntries[0];
      
      // Remove the embedding file
      await fs.unlink(entryWithEmbedding.embeddingPath).catch(() => {}); // Ignore if already missing
      
      const migrationResult = await migrationService.migrateEntries(discoveredEntries);
      
      // Should still succeed, just without embedding
      expect(migrationResult.success).toBe(true);
      expect(migrationResult.migratedCount).toBe(1);
      expect(migrationResult.warnings.length).toBeGreaterThan(0);
      
      const dbEntries = await dbManager.getAllEntries();
      expect(dbEntries.length).toBe(1);
    });

    test('provides detailed migration statistics', async () => {
      await fileManager.writeEntry('Test entry for stats');
      await fileManager.writeThoughts({
        project_notes: 'Test thoughts for stats',
        agent_id: 'test-agent'
      });

      const discoveredEntries = await migrationService.discoverEntries();
      const migrationResult = await migrationService.migrateEntries(discoveredEntries);
      
      expect(migrationResult).toHaveProperty('migratedCount');
      expect(migrationResult).toHaveProperty('failedCount');
      expect(migrationResult).toHaveProperty('warningCount');
      expect(migrationResult).toHaveProperty('totalProcessed');
      expect(migrationResult).toHaveProperty('duration');
      expect(migrationResult).toHaveProperty('success');
      
      expect(migrationResult.totalProcessed).toBe(discoveredEntries.length);
      expect(migrationResult.migratedCount + migrationResult.failedCount).toBe(migrationResult.totalProcessed);
    });
  });
});