// Test MCP server with PostgreSQL backend
const { PrivateJournalServer } = require('./dist/server.js');

async function testMCPPostgreSQL() {
  console.log('Testing MCP server with PostgreSQL backend...');
  
  // Set environment to use PostgreSQL
  process.env.JOURNAL_BACKEND = 'postgresql';
  process.env.DB_HOST = 'localhost';
  process.env.DB_PORT = '5432';
  process.env.DB_NAME = 'ai_memory_distillation_dev';
  process.env.DB_USER = 'postgres';
  process.env.DB_PASSWORD = 'postgres';
  
  try {
    const server = new PrivateJournalServer('/tmp/test-journal', {
      defaultModelId: 'claude-sonnet-4',
      defaultAgentId: 'test-agent'
    });
    
    console.log('✅ MCP server initialized with PostgreSQL backend');
    
    // Test that server starts without errors
    await server.run();
    console.log('✅ MCP server started successfully with PostgreSQL!');
    
  } catch (error) {
    console.error('❌ MCP PostgreSQL test failed:', error.message);
    process.exit(1);
  }
}

testMCPPostgreSQL();