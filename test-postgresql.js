// Quick test to verify PostgreSQL integration works
const { PostgreSQLJournalManager } = require('./dist/postgresql-journal-simple.js');

async function testPostgreSQL() {
  console.log('Testing PostgreSQL integration...');
  
  const config = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'ai_memory_distillation_dev',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    ssl: false
  };
  
  const manager = new PostgreSQLJournalManager(config);
  
  try {
    console.log('Initializing connection...');
    await manager.initialize();
    console.log('✅ Connection successful!');
    
    console.log('Testing basic functionality...');
    // Test if we can read recent entries (this should work even with empty table)
    const recent = await manager.listRecent({ limit: 5 });
    console.log(`✅ Found ${recent.length} recent entries`);
    
    await manager.close();
    console.log('✅ PostgreSQL integration test completed successfully!');
    
  } catch (error) {
    console.error('❌ PostgreSQL integration test failed:', error.message);
    process.exit(1);
  }
}

testPostgreSQL();