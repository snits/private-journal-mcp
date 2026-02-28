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
  batchSize: number = 50,
  missingOnly: boolean = false,
  sequential: boolean = false
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
      ${missingOnly ? 'WHERE embedding_768d IS NULL' : ''}
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

    // Process entries
    let processed = 0;
    let errors = 0;

    if (sequential) {
      // Process one at a time
      console.log('\nProcessing entries sequentially (one at a time)...');
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        console.log(`\n[${i + 1}/${entries.length}] Processing entry ${entry.id}...`);

        try {
          const { text } = embeddingService.extractSearchableText(entry.content);

          if (text.trim().length === 0) {
            console.log(`  Skipping empty entry`);
            continue;
          }

          const startTime = Date.now();
          const embedding = await embeddingService.generateDocumentEmbedding(text);
          const duration = ((Date.now() - startTime) / 1000).toFixed(2);

          if (!embedding || embedding.length === 0) {
            console.warn(`  Warning: Empty embedding returned`);
            errors++;
            continue;
          }

          const embeddingVector = `[${embedding.join(',')}]`;

          await pool.query(
            'UPDATE ai_memory.journal_entries SET embedding_768d = $1::vector WHERE id = $2',
            [embeddingVector, entry.id]
          );

          processed++;
          console.log(`  ✓ Done in ${duration}s (${processed}/${entries.length})`);
        } catch (error) {
          console.error(`  ✗ Failed:`, error);
          errors++;
        }
      }
    } else {
      // Process in batches
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
          const embeddings = await embeddingService.generateDocumentBatch(texts);
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

              const embeddingVector = `[${embedding.join(',')}]`;

              await client.query(
                'UPDATE ai_memory.journal_entries SET embedding_768d = $1::vector WHERE id = $2',
                [embeddingVector, entry.id]
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
const missingOnly = args.includes('--missing-only');
const sequential = args.includes('--sequential');
const limitArg = args.find(arg => arg.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1]) : undefined;
const batchSizeArg = args.find(arg => arg.startsWith('--batch-size='));
const batchSize = batchSizeArg ? parseInt(batchSizeArg.split('=')[1]) : 50;

console.log('=== OpenAI Embedding Regeneration ===');
console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
console.log(`Missing only: ${missingOnly}`);
console.log(`Sequential: ${sequential}`);
console.log(`Batch size: ${sequential ? 'N/A' : batchSize}`);
console.log(`\nConfiguration:`);
console.log(`  Model: ${process.env.OPENAI_EMBEDDING_MODEL || 'nomic-embed-text'}`);
console.log(`  Dimensions: ${process.env.OPENAI_EMBEDDING_DIMENSIONS || '768'}`);
console.log(`  Base URL: ${process.env.OPENAI_EMBEDDING_BASE_URL || 'http://localhost:11434/v1'}`);
console.log(`  Database: ${process.env.DB_NAME || 'mnemosyne_prod'}\n`);

regenerateEmbeddings(dryRun, limit, batchSize, missingOnly, sequential)
  .then(() => {
    console.log('\nDone!');
    process.exit(0);
  })
  .catch(error => {
    console.error('\nFailed:', error);
    process.exit(1);
  });
