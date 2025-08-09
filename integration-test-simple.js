#!/usr/bin/env node

// Simple integration test for PostgreSQL migration without Jest dependencies
const { PostgreSQLJournalManager } = require('./dist/postgresql-journal-simple.js');
const { DatabaseJournalManager } = require('./dist/database-journal.js');
const { JournalManagerFactory } = require('./dist/journal-manager-factory.js');

async function runIntegrationTests() {
  console.log('🧪 Running PostgreSQL Integration Tests for private-journal-mcp\n');
  
  let passed = 0;
  let failed = 0;
  
  function test(name, testFn) {
    return async () => {
      try {
        process.stdout.write(`  ${name}... `);
        await testFn();
        console.log('✅ PASS');
        passed++;
      } catch (error) {
        console.log(`❌ FAIL: ${error.message}`);
        failed++;
      }
    };
  }
  
  // Test 1: PostgreSQL Connection
  await test('PostgreSQL connection and basic functionality', async () => {
    const config = {
      host: 'localhost',
      port: 5432,
      database: 'ai_memory_distillation_dev',
      user: 'postgres',
      password: 'postgres'
    };
    
    const manager = new PostgreSQLJournalManager(config);
    await manager.initialize();
    
    // Test basic operations
    const recent = await manager.listRecent({ limit: 5 });
    if (!Array.isArray(recent)) throw new Error('listRecent should return array');
    
    await manager.close();
  })();
  
  // Test 2: Factory Pattern
  await test('JournalManagerFactory creates correct backends', async () => {
    // Test SQLite creation
    const sqliteManager = JournalManagerFactory.create('sqlite', '/tmp/test');
    if (!sqliteManager) throw new Error('Failed to create SQLite manager');
    
    // Test PostgreSQL creation
    const pgManager = JournalManagerFactory.create('postgresql', '/tmp/test', {
      host: 'localhost',
      port: 5432,
      database: 'ai_memory_distillation_dev',
      user: 'postgres',
      password: 'postgres'
    });
    if (!pgManager) throw new Error('Failed to create PostgreSQL manager');
  })();
  
  // Test 3: Environment Variable Detection
  await test('Environment variable backend selection', async () => {
    // Test default (should be sqlite)
    const defaultType = JournalManagerFactory.getManagerType();
    if (defaultType !== 'sqlite') throw new Error(`Expected sqlite, got ${defaultType}`);
    
    // Test PostgreSQL selection
    process.env.JOURNAL_BACKEND = 'postgresql';
    const pgType = JournalManagerFactory.getManagerType();
    if (pgType !== 'postgresql') throw new Error(`Expected postgresql, got ${pgType}`);
    
    // Cleanup
    delete process.env.JOURNAL_BACKEND;
  })();
  
  // Test 4: Write and Read Functionality  
  await test('Write and read journal entries via PostgreSQL', async () => {
    const config = {
      host: 'localhost',
      port: 5432,
      database: 'ai_memory_distillation_dev',
      user: 'postgres',
      password: 'postgres'
    };
    
    const manager = new PostgreSQLJournalManager(config);
    await manager.initialize();
    
    // Write a test entry
    const testContent = `Integration test entry ${Date.now()}`;
    await manager.writeEntry(testContent);
    
    // Verify it appears in recent entries
    const recent = await manager.listRecent({ limit: 10 });
    const found = recent.some(entry => entry.content.includes(testContent));
    if (!found) throw new Error('Test entry not found in recent entries');
    
    await manager.close();
  })();
  
  // Test 5: Thoughts Processing
  await test('Process thoughts with PostgreSQL backend', async () => {
    const config = {
      host: 'localhost',
      port: 5432,
      database: 'ai_memory_distillation_dev',
      user: 'postgres',
      password: 'postgres'
    };
    
    const manager = new PostgreSQLJournalManager(config);
    await manager.initialize();
    
    // Write test thoughts
    await manager.writeThoughts({
      technical_insights: `Test technical insight ${Date.now()}`,
      project_notes: `Test project note ${Date.now()}`,
      agent_id: 'test-agent',
      model_id: 'test-model'
    });
    
    // Verify thoughts were written
    const recent = await manager.listRecent({ limit: 5 });
    const found = recent.some(entry => 
      entry.agent_id === 'test-agent' && 
      entry.model_id === 'test-model'
    );
    if (!found) throw new Error('Test thoughts not found');
    
    await manager.close();
  })();
  
  // Test 6: Search Functionality
  await test('Search functionality with PostgreSQL', async () => {
    const config = {
      host: 'localhost',
      port: 5432,
      database: 'ai_memory_distillation_dev',
      user: 'postgres',
      password: 'postgres'
    };
    
    const manager = new PostgreSQLJournalManager(config);
    await manager.initialize();
    
    // Test search (should not throw even if no embeddings)
    const results = await manager.searchBySimilarity('test query', { limit: 5 });
    if (!Array.isArray(results)) throw new Error('Search should return array');
    
    await manager.close();
  })();
  
  // Summary
  console.log(`\n📊 Test Results:`);
  console.log(`  ✅ Passed: ${passed}`);
  console.log(`  ❌ Failed: ${failed}`);
  console.log(`  📈 Success Rate: ${Math.round((passed / (passed + failed)) * 100)}%\n`);
  
  if (failed > 0) {
    console.log('❌ Some tests failed. Please check the PostgreSQL configuration and database setup.');
    process.exit(1);
  } else {
    console.log('🎉 All integration tests passed! PostgreSQL migration is successful.');
    console.log('\n📋 Next Steps:');
    console.log('  1. Set JOURNAL_BACKEND=postgresql to use PostgreSQL');
    console.log('  2. Configure database connection via environment variables');
    console.log('  3. Test with real MCP client integration');
  }
}

runIntegrationTests().catch(error => {
  console.error('💥 Integration test runner failed:', error);
  process.exit(1);
});