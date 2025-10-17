#!/usr/bin/env ts-node
// ABOUTME: Regenerate all embeddings using OpenAI-compatible API (Ollama/vLLM)
// ABOUTME: Batch processes all journal entries for efficient embedding generation

import { Pool } from 'pg';
import { createDatabaseConfig } from './src/database-config';
import { OpenAIEmbeddingService } from './src/openai-embedding-service';
import * as dotenv from 'dotenv';

dotenv.config();

interface JournalEntry {
  id: number;
  content: string;
  file_path: string;
}

async function regenerateEmbeddings(
  dryRun: boolean = false,
  limit?: number,
  batchSize: number = 50
) {
  const config = createDatabaseConfig();
  const pool = new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: config.ssl,
  });

  const embeddingService = OpenAIEmbeddingService.getInstance();

  try {
    // Verify embedding service compatibility
    console.log('Verifying embedding service compatibility...');
    const isCompatible = await embeddingService.verifyCompatibility();
    if (!isCompatible) {
      throw new Error('Embedding service compatibility check failed');
    }

    // Get total count
    const countResult = await pool.query(
      'SELECT COUNT(*) as total FROM ai_memory.journal_entries'
    );
    const totalEntries = parseInt(countResult.rows[0].total);
    console.log(`\nTotal entries in database: ${totalEntries}`);

    if (limit) {
      console.log(`Processing limit: ${limit} entries`);
    }

    // Fetch entries to process
    const query = `
      SELECT id, content, file_path
      FROM ai_memory.journal_entries
      ORDER BY timestamp DESC
      ${limit ? `LIMIT ${limit}` : ''}
    `;

    console.log('\nFetching entries...');
    const result = await pool.query<JournalEntry>(query);
    const entries = result.rows;

    console.log(`Fetched ${entries.length} entries to process`);

    if (dryRun) {
      console.log('\n[DRY RUN] Would process these entries:');
      entries.slice(0, 5).forEach(entry => {
        console.log(`  - ID ${entry.id}: ${entry.file_path} (${entry.content.length} chars)`);
      });
      if (entries.length > 5) {
        console.log(`  ... and ${entries.length - 5} more`);
      }
      return;
    }

    // Process in batches
    let processed = 0;
    let errors = 0;

    for (let i = 0; i < entries.length; i += batchSize) {
      const batch = entries.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(entries.length / batchSize);

      console.log(`\nProcessing batch ${batchNum}/${totalBatches} (${batch.length} entries)...`);

      try {
        // Extract searchable text for each entry
        const texts = batch.map(entry => {
          const { text } = embeddingService.extractSearchableText(entry.content);
          return text;
        });

        // Generate embeddings in batch
        console.log(`  Generating embeddings...`);
        const startTime = Date.now();
        const embeddings = await embeddingService.generateBatch(texts);
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`  Generated ${embeddings.length} embeddings in ${duration}s`);

        // Update database
        console.log(`  Updating database...`);
        const client = await pool.connect();
        try {
          await client.query('BEGIN');

          for (let j = 0; j < batch.length; j++) {
            const entry = batch[j];
            const embedding = embeddings[j];

            if (!embedding || embedding.length === 0) {
              console.warn(`  Warning: Empty embedding for entry ${entry.id}`);
              continue;
            }

            // Convert to Buffer for PostgreSQL bytea storage
            const embeddingBuffer = Buffer.from(new Float32Array(embedding).buffer);

            await client.query(
              'UPDATE ai_memory.journal_entries SET embedding = $1 WHERE id = $2',
              [embeddingBuffer, entry.id]
            );

            processed++;
          }

          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }

        console.log(`  ✓ Batch complete (${processed}/${entries.length})`);
      } catch (error) {
        console.error(`  ✗ Batch failed:`, error);
        errors += batch.length;
      }
    }

    console.log(`\n=== Summary ===`);
    console.log(`Processed: ${processed}/${entries.length}`);
    console.log(`Errors: ${errors}`);
    console.log(`Success rate: ${((processed / entries.length) * 100).toFixed(1)}%`);
  } catch (error) {
    console.error('Fatal error:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitArg = args.find(arg => arg.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1]) : undefined;
const batchSizeArg = args.find(arg => arg.startsWith('--batch-size='));
const batchSize = batchSizeArg ? parseInt(batchSizeArg.split('=')[1]) : 50;

console.log('=== OpenAI Embedding Regeneration ===');
console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
console.log(`Batch size: ${batchSize}`);
console.log(`\nConfiguration:`);
console.log(`  Model: ${process.env.OPENAI_EMBEDDING_MODEL || 'nomic-embed-text'}`);
console.log(`  Dimensions: ${process.env.OPENAI_EMBEDDING_DIMENSIONS || '768'}`);
console.log(`  Base URL: ${process.env.OPENAI_EMBEDDING_BASE_URL || 'http://localhost:11434/v1'}`);
console.log(`  Database: ${process.env.DB_NAME || 'mnemosyne_prod'}\n`);

regenerateEmbeddings(dryRun, limit, batchSize)
  .then(() => {
    console.log('\nDone!');
    process.exit(0);
  })
  .catch(error => {
    console.error('\nFailed:', error);
    process.exit(1);
  });
