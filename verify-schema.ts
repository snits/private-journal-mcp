#!/usr/bin/env ts-node
// ABOUTME: Verifies that the journal_entries schema has all required columns and indexes
// ABOUTME: Reports on migration status for project columns and embedding conversion

import { Pool } from 'pg';
import { createDatabaseConfig } from './src/database-config';
import * as dotenv from 'dotenv';

dotenv.config();

interface ColumnInfo {
  column_name: string;
  data_type: string;
  is_nullable: string;
}

interface IndexInfo {
  indexname: string;
  indexdef: string;
}

async function verifySchema() {
  const config = createDatabaseConfig();
  const pool = new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: config.ssl,
  });

  try {
    console.log('=== Database Schema Verification ===');
    console.log(`Database: ${config.database}`);
    console.log(`Host: ${config.host}:${config.port}`);
    console.log('');

    // Check required columns
    console.log('--- Required Columns ---');
    const requiredColumns = [
      { name: 'project', type: 'character varying' },
      { name: 'project_context', type: 'jsonb' },
      { name: 'embedding', type: 'USER-DEFINED' }, // pgvector types show as USER-DEFINED
    ];

    const columnsResult = await pool.query<ColumnInfo>(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'ai_memory'
        AND table_name = 'journal_entries'
      ORDER BY ordinal_position
    `);

    const columns = columnsResult.rows;
    let allColumnsExist = true;

    for (const required of requiredColumns) {
      const found = columns.find((c) => c.column_name === required.name);
      if (found) {
        const typeMatch =
          found.data_type === required.type ||
          (required.type === 'USER-DEFINED' && found.data_type === 'USER-DEFINED');
        console.log(
          `✓ ${required.name.padEnd(20)} ${found.data_type.padEnd(25)} (nullable: ${found.is_nullable})`
        );
        if (!typeMatch && required.type !== 'USER-DEFINED') {
          console.log(`  ⚠ Warning: Expected type ${required.type}, got ${found.data_type}`);
        }
      } else {
        console.log(`✗ ${required.name.padEnd(20)} MISSING`);
        allColumnsExist = false;
      }
    }
    console.log('');

    // Check required indexes
    console.log('--- Required Indexes ---');
    const indexesResult = await pool.query<IndexInfo>(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'ai_memory'
        AND tablename = 'journal_entries'
      ORDER BY indexname
    `);

    const indexes = indexesResult.rows;
    const requiredIndexes = [
      'idx_journal_entries_embedding_hnsw',
      'idx_journal_entries_project',
    ];

    let allIndexesExist = true;
    for (const indexName of requiredIndexes) {
      const found = indexes.find((i) => i.indexname === indexName);
      if (found) {
        console.log(`✓ ${indexName}`);
        if (indexName.includes('hnsw')) {
          console.log(`  Type: HNSW vector similarity index`);
        } else if (indexName.includes('project')) {
          console.log(`  Type: Partial B-tree index on project column`);
        }
      } else {
        console.log(`✗ ${indexName} MISSING`);
        allIndexesExist = false;
      }
    }
    console.log('');

    // Check data migration status (only if new columns exist)
    console.log('--- Data Migration Status ---');

    // Check which columns exist
    const hasEmbedding = columns.find((c) => c.column_name === 'embedding');
    const hasProject = columns.find((c) => c.column_name === 'project');
    const hasProjectContext = columns.find((c) => c.column_name === 'project_context');

    if (!hasEmbedding && !hasProject && !hasProjectContext) {
      console.log('Migration columns not yet added. Run 001-add-project-columns.sql first.');
      console.log('');
    } else {
      // Build dynamic query based on which columns exist
      const filters = [];
      if (hasEmbedding) {
        filters.push('COUNT(*) FILTER (WHERE embedding IS NOT NULL) as has_embedding');
      }
      if (hasProject) {
        filters.push('COUNT(*) FILTER (WHERE project IS NOT NULL) as has_project');
      }
      if (hasProjectContext) {
        filters.push('COUNT(*) FILTER (WHERE project_context IS NOT NULL) as has_project_context');
      }

      const statsQuery = `
        SELECT
          COUNT(*) as total_entries
          ${filters.length > 0 ? ',' : ''}
          ${filters.join(',\n          ')}
        FROM ai_memory.journal_entries
      `;

      const statsResult = await pool.query(statsQuery);
      const stats = statsResult.rows[0];

      console.log(`Total entries: ${stats.total_entries}`);

      if (hasEmbedding) {
        console.log(`With embedding (vector): ${stats.has_embedding || 0}`);
      }
      if (hasProject) {
        console.log(`With project name: ${stats.has_project || 0}`);
      }
      if (hasProjectContext) {
        console.log(`With project context: ${stats.has_project_context || 0}`);
      }
      console.log('');
    }

    // Final summary
    console.log('=== Summary ===');
    if (allColumnsExist && allIndexesExist) {
      console.log('✓ Schema is complete and up to date');
    } else {
      console.log('✗ Schema is missing required columns or indexes');
      console.log('');
      console.log('Next steps:');
      if (!allColumnsExist) {
        console.log('1. Run: psql -h localhost -U postgres -d mnemosyne_prod -f 001-add-project-columns.sql');
      }
      if (!hasEmbedding) {
        console.log('2. Run: ./migrate-embeddings-to-vector.ts (after step 1)');
      }
      if (!allIndexesExist) {
        console.log('3. Run: psql -h localhost -U postgres -d mnemosyne_prod -f 002-add-indexes.sql');
      }
    }

    // Check pgvector extension
    console.log('');
    console.log('--- Extensions ---');
    const extResult = await pool.query(`
      SELECT extname, extversion
      FROM pg_extension
      WHERE extname = 'vector'
    `);

    if (extResult.rows.length > 0) {
      console.log(`✓ pgvector extension installed (version ${extResult.rows[0].extversion})`);
    } else {
      console.log(`✗ pgvector extension NOT installed`);
      console.log(`  Run: CREATE EXTENSION vector;`);
    }
  } catch (error) {
    console.error('Error verifying schema:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

console.log('Starting schema verification...');
console.log('');

verifySchema()
  .then(() => {
    console.log('');
    console.log('Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Verification failed:', error);
    process.exit(1);
  });
