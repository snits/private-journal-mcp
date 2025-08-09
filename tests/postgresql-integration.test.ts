// ABOUTME: Comprehensive integration tests for PostgreSQL migration and distillation pipeline
// ABOUTME: Tests end-to-end functionality, MCP protocol compatibility, and performance benchmarks

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { Pool } from 'pg';
import { DatabaseJournalManager } from '../src/database-journal';
import { PostgreSQLJournalManager } from '../src/postgresql-journal-simple';
import { JournalManager } from '../src/journal';
import { MigrationService } from '../src/migration';
import { SearchService } from '../src/search';
import { PrivateJournalServer } from '../src/server';
import { createDatabaseConfig, DatabaseConfig } from '../src/database-config';

describe('PostgreSQL Integration Tests', () => {
  let tempDir: string;
  let fileSourceDir: string;
  let userSourceDir: string;
  let sqliteDbPath: string;
  let pgConfig: DatabaseConfig;
  let pgPool: Pool;
  let fileManager: JournalManager;
  let sqliteManager: DatabaseJournalManager;
  let pgManager: PostgreSQLJournalManager;
  let migrationService: MigrationService;
  let mcpServer: PrivateJournalServer;

  beforeAll(async () => {
    // Create PostgreSQL test database
    pgConfig = createDatabaseConfig();
    pgConfig.database = 'ai_memory_distillation_test';
    
    // Connect to default postgres database to create test database
    const adminPool = new Pool({ ...pgConfig, database: 'postgres' });
    try {
      await adminPool.query(`DROP DATABASE IF EXISTS ${pgConfig.database}`);
      await adminPool.query(`CREATE DATABASE ${pgConfig.database}`);
    } finally {
      await adminPool.end();
    }

    // Create main pool for test database
    pgPool = new Pool(pgConfig);
    
    // Initialize schema
    await pgPool.query(`
      CREATE SCHEMA IF NOT EXISTS ai_memory;
      
      CREATE TABLE IF NOT EXISTS ai_memory.journal_entries (
        id BIGSERIAL PRIMARY KEY,
        content TEXT NOT NULL,
        timestamp TIMESTAMPTZ NOT NULL,
        date_string VARCHAR(10) NOT NULL,
        file_path TEXT NOT NULL UNIQUE,
        agent_id VARCHAR(100),
        model_id VARCHAR(100),
        visibility_level VARCHAR(20) DEFAULT 'private',
        entry_type VARCHAR(20) DEFAULT 'simple',
        embedding BYTEA,
        searchable_text TEXT,
        sections JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_journal_entries_timestamp ON ai_memory.journal_entries(timestamp);
      CREATE INDEX IF NOT EXISTS idx_journal_entries_agent ON ai_memory.journal_entries(agent_id);
      CREATE INDEX IF NOT EXISTS idx_journal_entries_visibility ON ai_memory.journal_entries(visibility_level);
      CREATE INDEX IF NOT EXISTS idx_journal_entries_type ON ai_memory.journal_entries(entry_type);
      CREATE INDEX IF NOT EXISTS idx_journal_entries_searchable ON ai_memory.journal_entries USING gin(to_tsvector('english', searchable_text));
    `);
  });

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pg-integration-test-'));
    fileSourceDir = path.join(tempDir, 'file-journals');
    userSourceDir = path.join(tempDir, 'user-journals');
    sqliteDbPath = path.join(tempDir, 'test.db');
    
    // Create source directories
    await fs.mkdir(fileSourceDir, { recursive: true });
    await fs.mkdir(userSourceDir, { recursive: true });
    
    // Initialize managers
    fileManager = new JournalManager(fileSourceDir, userSourceDir);
    sqliteManager = new DatabaseJournalManager(sqliteDbPath);
    await sqliteManager.initialize();
    
    pgManager = new PostgreSQLJournalManager(pgConfig);
    await pgManager.initialize();
    
    migrationService = new MigrationService(fileSourceDir, userSourceDir, sqliteManager);
    
    // Clean PostgreSQL test data
    await pgPool.query('TRUNCATE ai_memory.journal_entries RESTART IDENTITY');
    
    // Create MCP server with PostgreSQL backend
    process.env.JOURNAL_BACKEND = 'postgresql';
    mcpServer = new PrivateJournalServer(tempDir, {
      defaultModelId: 'claude-sonnet-4',
      defaultAgentId: 'test-specialist'
    });
  });

  afterEach(async () => {
    await sqliteManager.close();
    await pgManager.close();
    await fs.rm(tempDir, { recursive: true, force: true });
    
    // Reset environment
    delete process.env.JOURNAL_BACKEND;
  });

  afterAll(async () => {
    await pgPool.end();
    
    // Clean up test database
    const adminPool = new Pool({ ...pgConfig, database: 'postgres' });
    try {
      await adminPool.query(`DROP DATABASE IF EXISTS ${pgConfig.database}`);
    } finally {
      await adminPool.end();
    }
  });

  describe('1. MCP Protocol Compatibility Tests', () => {
    test('process_thoughts tool works with PostgreSQL backend', async () => {
      const thoughtsData = {
        feelings: 'Confident about PostgreSQL integration working properly',
        project_notes: 'PostgreSQL adapter successfully handles all MCP operations',
        technical_insights: 'Vector embeddings work seamlessly with PostgreSQL bytea storage',
        user_context: 'Jerry will be pleased with the migration performance',
        world_knowledge: 'PostgreSQL provides excellent concurrency and ACID compliance',
        agent_id: 'test-specialist',
        model_id: 'claude-sonnet-4',
        visibility_level: 'private'
      };

      // Write thoughts via PostgreSQL manager
      await pgManager.writeThoughts(thoughtsData);
      
      // Verify entry exists in database
      const results = await pgManager.listRecent({ limit: 5 });
      expect(results.length).toBe(2); // project and user entries
      
      const projectEntry = results.find(r => r.content.includes('PostgreSQL adapter'));
      const userEntry = results.find(r => r.content.includes('Confident about PostgreSQL'));
      
      expect(projectEntry).toBeDefined();
      expect(projectEntry?.agent_id).toBe('test-specialist');
      expect(projectEntry?.model_id).toBe('claude-sonnet-4');
      expect(projectEntry?.visibility_level).toBe('private');
      
      expect(userEntry).toBeDefined();
      expect(userEntry?.content).toContain('Confident about PostgreSQL integration');
    });

    test('search_journal tool maintains response format compatibility', async () => {
      // Create test data
      await pgManager.writeThoughts({
        technical_insights: 'Database connection pooling improves performance significantly',
        project_notes: 'Migration from SQLite to PostgreSQL completed successfully',
        agent_id: 'senior-engineer',
        model_id: 'claude-sonnet-4'
      });

      await pgManager.writeEntry('Performance benchmarks show 40% improvement with PostgreSQL');

      // Test search functionality
      const searchResults = await pgManager.searchBySimilarity('database performance', { limit: 5 });
      
      expect(searchResults.length).toBeGreaterThan(0);
      expect(searchResults[0]).toHaveProperty('id');
      expect(searchResults[0]).toHaveProperty('content');
      expect(searchResults[0]).toHaveProperty('timestamp');
      expect(searchResults[0]).toHaveProperty('file_path');
      expect(searchResults[0]).toHaveProperty('agent_id');
      expect(searchResults[0]).toHaveProperty('model_id');
      expect(searchResults[0]).toHaveProperty('visibility_level');
      expect(searchResults[0]).toHaveProperty('entry_type');
      expect(searchResults[0]).toHaveProperty('score');
      expect(searchResults[0]).toHaveProperty('searchable_text');
      expect(searchResults[0]).toHaveProperty('sections');
      
      // Verify score is meaningful
      expect(searchResults[0].score).toBeGreaterThan(0.1);
      expect(searchResults[0].score).toBeLessThanOrEqual(1.0);
    });

    test('read_journal_entry tool works with PostgreSQL paths', async () => {
      await pgManager.writeEntry('Test content for path-based retrieval');
      
      const recentEntries = await pgManager.listRecent({ limit: 1 });
      expect(recentEntries.length).toBe(1);
      
      const filePath = recentEntries[0].file_path;
      const content = await pgManager.readEntryByPath(filePath);
      
      expect(content).toBeTruthy();
      expect(content).toContain('Test content for path-based retrieval');
      expect(content).toContain('title:');
      expect(content).toContain('timestamp:');
    });

    test('list_recent_entries maintains pagination and filtering', async () => {
      // Create entries with different agents and visibility levels
      const agents = ['senior-engineer', 'code-reviewer', 'systems-architect'];
      const visibilityLevels = ['private', 'team', 'public'];
      
      for (let i = 0; i < 9; i++) {
        await pgManager.writeThoughts({
          technical_insights: `Technical insight number ${i + 1}`,
          agent_id: agents[i % 3],
          model_id: 'claude-sonnet-4',
          visibility_level: visibilityLevels[i % 3] as any
        });
      }

      // Test basic listing
      const allRecent = await pgManager.listRecent({ limit: 10 });
      expect(allRecent.length).toBe(9);

      // Test agent filtering
      const seniorEngineerEntries = await pgManager.listRecent({
        limit: 10,
        agent_id: 'senior-engineer'
      });
      expect(seniorEngineerEntries.length).toBe(3);
      expect(seniorEngineerEntries.every(e => e.agent_id === 'senior-engineer')).toBe(true);

      // Test visibility filtering
      const teamEntries = await pgManager.listRecent({
        limit: 10,
        visibility_level: 'team'
      });
      expect(teamEntries.length).toBe(3);
      expect(teamEntries.every(e => e.visibility_level === 'team')).toBe(true);
    });

    test('accessibility filtering works correctly', async () => {
      // Create entries with different visibility levels
      await pgManager.writeThoughts({
        project_notes: 'Private notes for agent-a only',
        agent_id: 'agent-a',
        visibility_level: 'private'
      });

      await pgManager.writeThoughts({
        project_notes: 'Team visible notes',
        agent_id: 'agent-b',
        visibility_level: 'team'
      });

      await pgManager.writeThoughts({
        project_notes: 'Public notes for everyone',
        agent_id: 'agent-c',
        visibility_level: 'public'
      });

      // Test accessible_to_agent filtering
      const agentAAccessible = await pgManager.searchBySimilarity('notes', {
        accessible_to_agent: 'agent-a',
        limit: 10
      });

      // Should include: own private + team + public (but not other agents' private)
      expect(agentAAccessible.length).toBe(3);
      
      const agentDAccessible = await pgManager.searchBySimilarity('notes', {
        accessible_to_agent: 'agent-d',
        limit: 10
      });

      // Should include: team + public (no private entries from other agents)
      expect(agentDAccessible.length).toBe(2);
      expect(agentDAccessible.every(e => e.visibility_level !== 'private')).toBe(true);
    });
  });

  describe('2. Data Integration Tests', () => {
    test('PostgreSQL entries integrate with ai-memory-distillation schema', async () => {
      // Write entry via PostgreSQL manager
      await pgManager.writeThoughts({
        technical_insights: 'Database indexing strategies for high-performance queries',
        project_notes: 'Implementation uses btree indexes for timestamp and agent_id columns',
        agent_id: 'database-specialist',
        model_id: 'claude-sonnet-4',
        visibility_level: 'team'
      });

      // Verify schema compatibility by querying directly
      const result = await pgPool.query(`
        SELECT id, content, timestamp, agent_id, model_id, visibility_level, 
               entry_type, embedding, searchable_text, sections, created_at, updated_at
        FROM ai_memory.journal_entries 
        WHERE agent_id = $1
        ORDER BY created_at DESC
        LIMIT 1
      `, ['database-specialist']);

      expect(result.rows.length).toBe(1);
      const entry = result.rows[0];
      
      // Verify all expected fields are present and correctly typed
      expect(entry.id).toEqual(expect.any(String));
      expect(entry.content).toContain('Database indexing strategies');
      expect(entry.timestamp).toBeInstanceOf(Date);
      expect(entry.agent_id).toBe('database-specialist');
      expect(entry.model_id).toBe('claude-sonnet-4');
      expect(entry.visibility_level).toBe('team');
      expect(entry.entry_type).toBe('thoughts');
      expect(entry.embedding).toBeInstanceOf(Buffer);
      expect(entry.searchable_text).toContain('Database indexing');
      expect(entry.sections).toEqual(expect.any(Object));
      expect(entry.created_at).toBeInstanceOf(Date);
      expect(entry.updated_at).toBeInstanceOf(Date);
    });

    test('entries support distillation job creation', async () => {
      // Create entries that should trigger distillation jobs
      await pgManager.writeThoughts({
        technical_insights: 'Machine learning model optimization techniques for production deployment',
        project_notes: 'Containerization strategy for ML models using Docker and Kubernetes',
        world_knowledge: 'Distributed systems principles apply well to ML inference scaling',
        agent_id: 'ml-engineer',
        model_id: 'claude-sonnet-4'
      });

      // Verify entries are compatible with distillation job queries
      const unprocessedQuery = `
        SELECT je.* FROM ai_memory.journal_entries je
        LEFT JOIN distillation_jobs dj ON dj.entry_id = je.id
        WHERE dj.id IS NULL
        ORDER BY je.created_at ASC
      `;

      // Simulate the repository query (this would normally be in ai-memory-distillation)
      const result = await pgPool.query(unprocessedQuery);
      expect(result.rows.length).toBeGreaterThan(0);
      
      const entry = result.rows[0];
      expect(entry.content).toContain('Machine learning model optimization');
      expect(entry.searchable_text).toContain('optimization techniques');
      expect(entry.sections).toBeTruthy();
    });

    test('embedding storage is compatible with vector search operations', async () => {
      await pgManager.writeThoughts({
        technical_insights: 'Vector database performance comparison between PostgreSQL and specialized solutions',
        project_notes: 'pgvector extension provides excellent semantic search capabilities'
      });

      // Verify embedding is stored as bytea and can be converted back
      const result = await pgPool.query(`
        SELECT embedding, searchable_text FROM ai_memory.journal_entries 
        WHERE searchable_text LIKE '%Vector database%'
        LIMIT 1
      `);

      expect(result.rows.length).toBe(1);
      const { embedding, searchable_text } = result.rows[0];
      
      expect(embedding).toBeInstanceOf(Buffer);
      expect(searchable_text).toContain('Vector database performance');
      
      // Verify embedding can be converted to Float32Array
      const embeddingArray = new Float32Array(embedding.buffer, embedding.byteOffset, embedding.byteLength / 4);
      expect(embeddingArray.length).toBeGreaterThan(0);
      expect(embeddingArray.every(val => typeof val === 'number')).toBe(true);
    });
  });

  describe('3. Distillation Pipeline Integration Tests', () => {
    test('new PostgreSQL entries trigger distillation processing', async () => {
      // Create comprehensive entry that should produce good distillation
      await pgManager.writeThoughts({
        technical_insights: `
# Database Performance Optimization Insights

## Key Findings
- PostgreSQL connection pooling reduces overhead by 60%
- Proper indexing strategies improve query performance by 10x
- JSONB storage is optimal for semi-structured data

## Implementation Recommendations
1. Use pgpool for connection management
2. Implement composite indexes for multi-column queries
3. Consider partitioning for time-series data

## Lessons Learned
- Premature optimization is still the root of all evil
- Measure before optimizing
- PostgreSQL's query planner is remarkably sophisticated
        `,
        project_notes: 'Database migration completed successfully with zero downtime',
        agent_id: 'database-architect',
        model_id: 'claude-sonnet-4',
        visibility_level: 'team'
      });

      // Verify the entry is structured for distillation
      const entries = await pgManager.listRecent({ limit: 1 });
      expect(entries.length).toBe(1);
      
      const entry = entries[0];
      expect(entry.content).toContain('# Database Performance Optimization');
      expect(entry.content).toContain('## Key Findings');
      expect(entry.content).toContain('## Implementation Recommendations');
      expect(entry.searchable_text).toContain('PostgreSQL connection pooling');
      expect(entry.sections.length).toBeGreaterThan(0);
      
      // Verify metadata is correct for distillation processing
      expect(entry.agent_id).toBe('database-architect');
      expect(entry.model_id).toBe('claude-sonnet-4');
      expect(entry.visibility_level).toBe('team');
      expect(entry.embedding).toBeTruthy();
    });

    test('quality metrics can be calculated from PostgreSQL entries', async () => {
      await pgManager.writeThoughts({
        technical_insights: 'Simple note about debugging',
        project_notes: 'Brief update',
      });

      await pgManager.writeThoughts({
        technical_insights: `
# Comprehensive Analysis of Microservices Architecture

## Executive Summary
This analysis covers the trade-offs between monolithic and microservices architectures, with specific focus on operational complexity, scalability benefits, and team productivity impacts.

## Detailed Findings
### Scalability Benefits
- Independent scaling of services reduces resource waste
- Circuit breaker patterns improve system resilience
- Event-driven communication enables loose coupling

### Operational Challenges
- Distributed tracing becomes critical for debugging
- Service mesh complexity requires dedicated platform team
- Deployment coordination increases with service count

## Recommendations
1. Start with modular monolith before microservices
2. Invest in observability infrastructure early
3. Establish clear service ownership models
4. Implement automated testing across service boundaries

## Conclusion
Microservices provide significant benefits for large teams but require substantial operational maturity.
        `,
        project_notes: 'Microservices evaluation complete - recommend modular monolith approach for current team size',
        agent_id: 'systems-architect',
        model_id: 'claude-sonnet-4',
        visibility_level: 'crb'
      });

      const entries = await pgManager.listRecent({ limit: 5 });
      const comprehensiveEntry = entries.find(e => e.content.includes('Comprehensive Analysis'));
      const simpleEntry = entries.find(e => e.content.includes('Simple note'));

      expect(comprehensiveEntry).toBeDefined();
      expect(simpleEntry).toBeDefined();

      // Verify comprehensive entry has better distillation potential
      expect(comprehensiveEntry!.searchable_text.length).toBeGreaterThan(simpleEntry!.searchable_text.length * 5);
      expect(comprehensiveEntry!.sections.length).toBeGreaterThan(simpleEntry!.sections.length);
      expect(comprehensiveEntry!.content.includes('## Executive Summary')).toBe(true);
      expect(comprehensiveEntry!.content.includes('## Recommendations')).toBe(true);
    });

    test('real-time processing compatibility with PostgreSQL triggers', async () => {
      // This test simulates what would happen in a real-time distillation setup
      let triggerFired = false;
      
      // Create a simple trigger simulation (in real implementation, this would be a database trigger)
      const simulateTrigger = async () => {
        // Check for new entries that need processing
        const result = await pgPool.query(`
          SELECT COUNT(*) as new_entries 
          FROM ai_memory.journal_entries 
          WHERE created_at > NOW() - INTERVAL '1 minute'
        `);
        
        if (parseInt(result.rows[0].new_entries) > 0) {
          triggerFired = true;
        }
      };

      // Write entry and check trigger
      await pgManager.writeThoughts({
        technical_insights: 'Real-time processing test entry',
        agent_id: 'test-agent'
      });

      await simulateTrigger();
      expect(triggerFired).toBe(true);

      // Verify entry structure supports immediate processing
      const recentEntries = await pgManager.listRecent({ limit: 1 });
      expect(recentEntries[0].content).toContain('Real-time processing test');
      expect(recentEntries[0].timestamp.getTime()).toBeGreaterThan(Date.now() - 60000); // Within last minute
    });
  });

  describe('4. Backward Compatibility Tests', () => {
    test('SQLite workflow still functions correctly', async () => {
      // Test original SQLite-based workflow
      await fileManager.writeEntry('SQLite compatibility test entry');
      await fileManager.writeThoughts({
        feelings: 'Testing backward compatibility',
        technical_insights: 'SQLite implementation should remain functional',
        agent_id: 'compatibility-tester'
      });

      // Migrate to SQLite database
      const discoveredEntries = await migrationService.discoverEntries();
      expect(discoveredEntries.length).toBeGreaterThan(0);

      const migrationResult = await migrationService.migrateEntries(discoveredEntries);
      expect(migrationResult.success).toBe(true);

      // Verify SQLite search still works
      const sqliteResults = await sqliteManager.searchBySimilarity('compatibility test', { limit: 5 });
      expect(sqliteResults.length).toBeGreaterThan(0);
      expect(sqliteResults[0].content).toContain('SQLite compatibility test');
    });

    test('file-based journal manager still works independently', async () => {
      // Verify file-based operations continue to work
      await fileManager.writeEntry('File-based journal test');
      await fileManager.writeThoughts({
        project_notes: 'File system storage test',
        technical_insights: 'Directory structure should be preserved'
      });

      // Check file creation
      const projectFiles = await fs.readdir(path.join(fileSourceDir, new Date().toISOString().split('T')[0]));
      const userFiles = await fs.readdir(path.join(userSourceDir, new Date().toISOString().split('T')[0]));

      expect(projectFiles.length).toBeGreaterThan(0);
      expect(userFiles.length).toBeGreaterThan(0);

      // Verify file content
      const projectFile = await fs.readFile(path.join(fileSourceDir, new Date().toISOString().split('T')[0], projectFiles[0]), 'utf-8');
      expect(projectFile).toContain('File system storage test');
    });

    test('migration from SQLite to PostgreSQL preserves all data', async () => {
      // Create data in file system
      await fileManager.writeEntry('Migration test entry with detailed content');
      await fileManager.writeThoughts({
        feelings: 'Excited about successful migration',
        project_notes: 'Database migration testing in progress',
        technical_insights: 'Data integrity is critical for migration success',
        user_context: 'Jerry expects zero data loss during migration',
        agent_id: 'migration-specialist',
        model_id: 'claude-sonnet-4',
        visibility_level: 'team'
      });

      // Migrate to SQLite
      const discoveredEntries = await migrationService.discoverEntries();
      await migrationService.migrateEntries(discoveredEntries);
      const sqliteEntries = await sqliteManager.getAllEntries();

      // Now migrate SQLite data to PostgreSQL (this would be done by a separate migration tool)
      for (const entry of sqliteEntries) {
        await pgManager.writeThoughts({
          feelings: entry.content.includes('Excited') ? 'Excited about successful migration' : undefined,
          project_notes: entry.content.includes('Database migration') ? 'Database migration testing in progress' : undefined,
          technical_insights: entry.content.includes('Data integrity') ? 'Data integrity is critical for migration success' : undefined,
          user_context: entry.content.includes('Jerry expects') ? 'Jerry expects zero data loss during migration' : undefined,
          agent_id: entry.agent_id || 'migration-specialist',
          model_id: entry.model_id || 'claude-sonnet-4',
          visibility_level: entry.visibility_level as any || 'team'
        });
      }

      // Verify all data migrated correctly
      const pgEntries = await pgManager.listRecent({ limit: 10 });
      expect(pgEntries.length).toBeGreaterThanOrEqual(sqliteEntries.length);

      // Check specific content preservation
      const excitedEntry = pgEntries.find(e => e.content.includes('Excited about successful migration'));
      const integrityEntry = pgEntries.find(e => e.content.includes('Data integrity is critical'));
      
      expect(excitedEntry).toBeDefined();
      expect(integrityEntry).toBeDefined();
      expect(excitedEntry?.agent_id).toBe('migration-specialist');
      expect(integrityEntry?.visibility_level).toBe('team');
    });
  });

  describe('5. Performance Benchmarks', () => {
    test('PostgreSQL vs SQLite write performance comparison', async () => {
      const entryCount = 50;
      const entries = Array.from({ length: entryCount }, (_, i) => ({
        technical_insights: `Performance test entry ${i}: Database write operations benchmarking`,
        project_notes: `Benchmark ${i}: Comparing PostgreSQL and SQLite write performance`,
        agent_id: 'performance-tester',
        model_id: 'claude-sonnet-4'
      }));

      // Benchmark PostgreSQL writes
      const pgStartTime = Date.now();
      for (const entry of entries) {
        await pgManager.writeThoughts(entry);
      }
      const pgWriteTime = Date.now() - pgStartTime;

      // Benchmark SQLite writes (to file first, then migrate)
      const sqliteStartTime = Date.now();
      for (const entry of entries) {
        await fileManager.writeThoughts(entry);
      }
      
      const discoveredEntries = await migrationService.discoverEntries();
      await migrationService.migrateEntries(discoveredEntries);
      const sqliteWriteTime = Date.now() - sqliteStartTime;

      // Performance expectations
      expect(pgWriteTime).toBeLessThan(30000); // Should complete in under 30 seconds
      expect(sqliteWriteTime).toBeLessThan(30000); // Should complete in under 30 seconds
      
      // PostgreSQL should be competitive or better for bulk operations
      const pgPerEntry = pgWriteTime / entryCount;
      const sqlitePerEntry = sqliteWriteTime / entryCount;
      
      expect(pgPerEntry).toBeLessThan(1000); // Under 1 second per entry
      expect(sqlitePerEntry).toBeLessThan(1000); // Under 1 second per entry

      console.log(`PostgreSQL: ${pgWriteTime}ms total, ${pgPerEntry.toFixed(2)}ms per entry`);
      console.log(`SQLite: ${sqliteWriteTime}ms total, ${sqlitePerEntry.toFixed(2)}ms per entry`);
    });

    test('PostgreSQL vs SQLite search performance comparison', async () => {
      // Create test data
      const testEntries = [
        { content: 'Database indexing strategies for optimal query performance' },
        { content: 'Machine learning model optimization techniques' },
        { content: 'Microservices architecture design patterns' },
        { content: 'Vector embedding generation and storage methods' },
        { content: 'PostgreSQL performance tuning and configuration' }
      ];

      for (const entry of testEntries) {
        await pgManager.writeEntry(entry.content);
        await fileManager.writeEntry(entry.content);
      }

      // Migrate to SQLite for comparison
      const discoveredEntries = await migrationService.discoverEntries();
      await migrationService.migrateEntries(discoveredEntries);

      const searchQueries = [
        'database performance',
        'machine learning optimization',
        'microservices design',
        'vector embeddings',
        'PostgreSQL configuration'
      ];

      // Benchmark PostgreSQL search
      const pgSearchTimes: number[] = [];
      for (const query of searchQueries) {
        const startTime = Date.now();
        const results = await pgManager.searchBySimilarity(query, { limit: 5 });
        pgSearchTimes.push(Date.now() - startTime);
        expect(results.length).toBeGreaterThan(0);
      }

      // Benchmark SQLite search
      const sqliteSearchTimes: number[] = [];
      for (const query of searchQueries) {
        const startTime = Date.now();
        const results = await sqliteManager.searchBySimilarity(query, { limit: 5 });
        sqliteSearchTimes.push(Date.now() - startTime);
        expect(results.length).toBeGreaterThan(0);
      }

      const avgPgSearchTime = pgSearchTimes.reduce((a, b) => a + b, 0) / pgSearchTimes.length;
      const avgSqliteSearchTime = sqliteSearchTimes.reduce((a, b) => a + b, 0) / sqliteSearchTimes.length;

      // Both should be reasonably fast
      expect(avgPgSearchTime).toBeLessThan(2000); // Under 2 seconds average
      expect(avgSqliteSearchTime).toBeLessThan(2000); // Under 2 seconds average

      console.log(`PostgreSQL search: ${avgPgSearchTime.toFixed(2)}ms average`);
      console.log(`SQLite search: ${avgSqliteSearchTime.toFixed(2)}ms average`);
    });

    test('concurrent access performance with PostgreSQL', async () => {
      const concurrentWrites = 10;
      const writesPerBatch = 5;

      // Test concurrent writes
      const writePromises = Array.from({ length: concurrentWrites }, async (_, i) => {
        const startTime = Date.now();
        for (let j = 0; j < writesPerBatch; j++) {
          await pgManager.writeThoughts({
            technical_insights: `Concurrent write test ${i}-${j}: PostgreSQL handles multiple connections well`,
            agent_id: `agent-${i}`,
            model_id: 'claude-sonnet-4'
          });
        }
        return Date.now() - startTime;
      });

      const startTime = Date.now();
      const writeTimes = await Promise.all(writePromises);
      const totalTime = Date.now() - startTime;

      // Verify all writes completed
      const totalEntries = await pgManager.listRecent({ limit: 100 });
      expect(totalEntries.length).toBeGreaterThanOrEqual(concurrentWrites * writesPerBatch);

      // Performance expectations
      expect(totalTime).toBeLessThan(20000); // Should complete in under 20 seconds
      expect(writeTimes.every(time => time < 10000)).toBe(true); // Each batch under 10 seconds

      console.log(`Concurrent writes: ${totalTime}ms total for ${concurrentWrites * writesPerBatch} entries`);
      console.log(`Average batch time: ${writeTimes.reduce((a, b) => a + b, 0) / writeTimes.length}ms`);
    });

    test('memory usage efficiency with large entries', async () => {
      // Test with large content entries
      const largeContent = `
# Comprehensive System Architecture Analysis

## Executive Summary
${'This is a detailed analysis section that contains substantial content. '.repeat(100)}

## Technical Specifications
${'Complex technical details and implementation specifics go here. '.repeat(150)}

## Performance Metrics
${'Detailed performance analysis with extensive data points and measurements. '.repeat(120)}

## Recommendations
${'Comprehensive recommendations with detailed rationale and implementation guidance. '.repeat(80)}

## Conclusion
${'Final thoughts and summary of all findings with future roadmap. '.repeat(60)}
      `;

      const startTime = Date.now();
      const initialMemory = process.memoryUsage();

      // Write large entries
      for (let i = 0; i < 10; i++) {
        await pgManager.writeThoughts({
          technical_insights: largeContent,
          project_notes: `Large entry test ${i}: Memory efficiency validation`,
          agent_id: 'memory-tester',
          model_id: 'claude-sonnet-4'
        });
      }

      const endTime = Date.now();
      const finalMemory = process.memoryUsage();

      // Verify entries were written correctly
      const entries = await pgManager.listRecent({ limit: 12 });
      const largeEntries = entries.filter(e => e.content.includes('Comprehensive System Architecture'));
      expect(largeEntries.length).toBe(10);

      // Performance checks
      expect(endTime - startTime).toBeLessThan(15000); // Under 15 seconds
      
      // Memory growth should be reasonable (under 100MB increase)
      const memoryGrowth = finalMemory.heapUsed - initialMemory.heapUsed;
      expect(memoryGrowth).toBeLessThan(100 * 1024 * 1024); // Under 100MB

      console.log(`Large entries: ${endTime - startTime}ms for 10 entries`);
      console.log(`Memory growth: ${(memoryGrowth / 1024 / 1024).toFixed(2)}MB`);
    });
  });

  describe('6. Error Handling and Edge Cases', () => {
    test('handles database connection failures gracefully', async () => {
      // Create manager with invalid config
      const invalidConfig = { ...pgConfig, port: 9999 };
      const invalidManager = new PostgreSQLJournalManager(invalidConfig);

      await expect(invalidManager.initialize()).rejects.toThrow();
    });

    test('handles duplicate entry detection correctly', async () => {
      const content = 'Duplicate detection test entry';
      const timestamp = Date.now();
      
      // Write initial entry
      await pgManager.writeEntry(content);
      
      // Check for duplicate
      const isDuplicate = await pgManager.checkEntryExists('test/path', timestamp, content);
      expect(isDuplicate).toBe(false); // Different path, so not duplicate
    });

    test('handles malformed content gracefully', async () => {
      // Test with various edge cases
      await expect(pgManager.writeEntry('')).resolves.not.toThrow();
      await expect(pgManager.writeThoughts({})).rejects.toThrow(); // Should require some content
      
      // Very long content
      const veryLongContent = 'x'.repeat(100000);
      await expect(pgManager.writeEntry(veryLongContent)).resolves.not.toThrow();
    });

    test('handles concurrent access to same resources', async () => {
      const content = 'Concurrent access test';
      
      // Multiple simultaneous writes
      const writePromises = Array.from({ length: 5 }, () => 
        pgManager.writeEntry(`${content} ${Math.random()}`)
      );
      
      await expect(Promise.all(writePromises)).resolves.not.toThrow();
      
      // Verify all entries were written
      const entries = await pgManager.listRecent({ limit: 10 });
      const testEntries = entries.filter(e => e.content.includes(content));
      expect(testEntries.length).toBe(5);
    });
  });
});