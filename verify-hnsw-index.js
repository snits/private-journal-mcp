// ABOUTME: Verification script to check HNSW index usage in PostgreSQL
// ABOUTME: Generates real embedding and runs EXPLAIN ANALYZE to verify query plan

const { Pool } = require('pg');
const { OpenAIEmbeddingService } = require('./dist/openai-embedding-service.js');

async function verifyHNSWIndex() {
  console.log('='.repeat(80));
  console.log('HNSW Index Verification for pgvector');
  console.log('='.repeat(80));
  console.log();

  // Initialize database connection
  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'mnemosyne_prod',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  });

  try {
    // Step 1: Generate a real 768-dimensional embedding
    console.log('Step 1: Generating real embedding...');
    console.log('---------------------------------------');
    const embeddingService = OpenAIEmbeddingService.getInstance();
    const modelInfo = embeddingService.getModelInfo();
    console.log(`Model: ${modelInfo.name}`);
    console.log(`Dimensions: ${modelInfo.dimensions}`);
    console.log();

    const testQuery = 'technical insights about database performance';
    console.log(`Query text: "${testQuery}"`);
    const embedding = await embeddingService.generateEmbedding(testQuery);
    console.log(`✓ Generated ${embedding.length}-dimensional embedding`);
    console.log();

    // Step 2: Check database statistics
    console.log('Step 2: Database statistics');
    console.log('---------------------------');
    const statsResult = await pool.query(`
      SELECT
        COUNT(*) as total_entries,
        COUNT(embedding) as entries_with_embedding,
        COUNT(*) - COUNT(embedding) as entries_without_embedding
      FROM ai_memory.journal_entries
    `);
    console.log(`Total entries: ${statsResult.rows[0].total_entries}`);
    console.log(`Entries with embedding: ${statsResult.rows[0].entries_with_embedding}`);
    console.log(`Entries without embedding: ${statsResult.rows[0].entries_without_embedding}`);
    console.log();

    // Step 3: Verify HNSW index exists
    console.log('Step 3: Verify HNSW index');
    console.log('-------------------------');
    const indexResult = await pool.query(`
      SELECT
        indexname,
        indexdef
      FROM pg_indexes
      WHERE schemaname = 'ai_memory'
        AND tablename = 'journal_entries'
        AND indexname LIKE '%hnsw%'
    `);

    if (indexResult.rows.length > 0) {
      console.log('✓ HNSW index found:');
      indexResult.rows.forEach(row => {
        console.log(`  Name: ${row.indexname}`);
        console.log(`  Definition: ${row.indexdef}`);
      });
    } else {
      console.log('✗ No HNSW index found!');
    }
    console.log();

    // Step 4: Run EXPLAIN ANALYZE with real embedding
    console.log('Step 4: Query plan analysis');
    console.log('----------------------------');
    const embeddingLiteral = `[${embedding.join(',')}]`;
    const minSimilarity = 0.6;
    const limit = 10;

    const queryPlanSQL = `
      EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
      SELECT
        id,
        1 - (embedding <=> $1::vector) AS score
      FROM ai_memory.journal_entries
      WHERE embedding IS NOT NULL
        AND (1 - (embedding <=> $1::vector)) >= $2
      ORDER BY embedding <=> $1::vector
      LIMIT $3
    `;

    console.log('Query:');
    console.log(queryPlanSQL.replace('$1', "'[...]'").replace('$2', minSimilarity).replace('$3', limit));
    console.log();

    const planResult = await pool.query(queryPlanSQL, [embeddingLiteral, minSimilarity, limit]);

    console.log('Query Plan:');
    console.log('-----------');
    planResult.rows.forEach(row => {
      console.log(row['QUERY PLAN']);
    });
    console.log();

    // Step 5: Analyze query plan output
    console.log('Step 5: Analysis');
    console.log('----------------');
    const planText = planResult.rows.map(r => r['QUERY PLAN']).join('\n');

    const usesHNSW = planText.includes('idx_journal_entries_embedding_hnsw');
    const usesIndexScan = planText.includes('Index Scan');
    const usesSeqScan = planText.includes('Seq Scan');

    // Extract execution time
    const executionTimeMatch = planText.match(/Execution Time: ([\d.]+) ms/);
    const executionTime = executionTimeMatch ? parseFloat(executionTimeMatch[1]) : null;

    // Extract rows
    const rowsMatch = planText.match(/rows=(\d+)/);
    const rowsReturned = rowsMatch ? parseInt(rowsMatch[1]) : null;

    console.log(`HNSW Index Used: ${usesHNSW ? '✓ YES' : '✗ NO'}`);
    console.log(`Index Scan: ${usesIndexScan ? '✓ YES' : '✗ NO'}`);
    console.log(`Sequential Scan: ${usesSeqScan ? '✗ YES (BAD!)' : '✓ NO (GOOD!)'}`);
    if (executionTime !== null) {
      console.log(`Execution Time: ${executionTime.toFixed(2)} ms`);
    }
    if (rowsReturned !== null) {
      console.log(`Rows Returned: ${rowsReturned}`);
    }
    console.log();

    // Step 6: Performance comparison notes
    console.log('Step 6: Performance Notes');
    console.log('-------------------------');
    console.log('Old Approach (JavaScript):');
    console.log('  - Fetch ALL entries with embeddings from database');
    console.log(`  - Calculate cosine similarity for each entry in JavaScript (~${statsResult.rows[0].entries_with_embedding} calculations)`);
    console.log('  - Sort results in memory');
    console.log('  - Return top N results');
    console.log();
    console.log('New Approach (pgvector):');
    console.log('  - Use HNSW index for approximate nearest neighbor search');
    console.log('  - Calculate similarity in PostgreSQL using native vector operators');
    console.log('  - PostgreSQL returns pre-sorted top N results');
    console.log(`  - Index scan processes ~${limit} rows instead of all ${statsResult.rows[0].entries_with_embedding} rows`);
    console.log();

    if (usesHNSW) {
      console.log('✓ SUCCESS: HNSW index is being used!');
      console.log(`  Query execution time: ${executionTime ? executionTime.toFixed(2) + ' ms' : 'N/A'}`);
      console.log('  This is a significant performance improvement over the old approach.');
    } else {
      console.log('✗ WARNING: HNSW index is NOT being used!');
      console.log('  Investigate why the query planner chose a different plan.');
      if (usesSeqScan) {
        console.log('  Sequential scan indicates the index is not being utilized.');
      }
    }
    console.log();
    console.log('='.repeat(80));

  } catch (error) {
    console.error('Error during verification:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run verification
verifyHNSWIndex()
  .then(() => {
    console.log('Verification complete.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Verification failed:', error);
    process.exit(1);
  });
