// ABOUTME: Batch re-embedding script for migrating journal entries to qwen3-embedding:4b
// ABOUTME: Idempotent and resumable — writes to a temporary embedding_qwen3 column

import { Client } from 'pg';
import { OpenAIClient } from '../src/openai-client';
import { getModelConfig } from '../src/embedding-config';
import { createDatabaseConfig } from '../src/database-config';

// --- Searchable text extraction (canonical logic from OpenAIEmbeddingService) ---

function extractSearchableText(content: string): { text: string; sections: string[] } {
  const withoutFrontmatter = content.replace(/^---[\s\S]*?---\n/, '');

  const sections: string[] = [];
  const headerRegex = /^## (.+)$/gm;
  let match;
  while ((match = headerRegex.exec(withoutFrontmatter)) !== null) {
    sections.push(match[1].trim());
  }

  const text = withoutFrontmatter
    .replace(/^#+\s+/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`(.*?)`/g, '$1')
    .replace(/\n+/g, ' ')
    .trim();

  return { text, sections };
}

// --- CLI argument parsing ---

interface CliArgs {
  batchSize: number;
  dryRun: boolean;
}

function printUsage(): void {
  console.log(`Usage: npx tsx scripts/reembed-qwen3.ts [options]

Re-embed journal entries using qwen3-embedding:4b into a temporary
embedding_qwen3 column. Idempotent: skips entries that already have
a qwen3 embedding.

Options:
  --batch-size N   Entries per batch (default: 10)
  --dry-run        Print counts and exit without modifying data
  --help           Show this help message`);
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    batchSize: 10,
    dryRun: false,
  };

  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--batch-size': {
        const val = parseInt(argv[++i], 10);
        if (isNaN(val) || val < 1) {
          console.error(`Invalid --batch-size: ${argv[i]}`);
          process.exit(1);
        }
        args.batchSize = val;
        break;
      }
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--help':
        printUsage();
        process.exit(0);
        break;
      default:
        console.error(`Unknown argument: ${argv[i]}`);
        printUsage();
        process.exit(1);
    }
  }

  return args;
}

// --- Pre-flight check ---

async function preflightCheck(client: OpenAIClient, model: string, dimensions: number): Promise<void> {
  console.log(`Pre-flight: embedding test string with ${model} at ${dimensions} dimensions...`);

  const testText = 'Pre-flight embedding check for qwen3 migration.';
  const embeddings = await client.generateEmbedding([testText], model, dimensions);

  if (!embeddings || embeddings.length === 0) {
    throw new Error('Pre-flight failed: API returned no embeddings');
  }

  const dims = embeddings[0].length;
  if (dims !== dimensions) {
    throw new Error(
      `Pre-flight failed: expected ${dimensions} dimensions, got ${dims}. ` +
        `Check that ${model} supports Matryoshka dimension truncation.`
    );
  }

  console.log(`Pre-flight passed: got ${dims} dimensions`);
}

// --- Column setup ---

async function ensureQwen3Column(db: Client, dimensions: number): Promise<void> {
  await db.query(`
    ALTER TABLE ai_memory.journal_entries
    ADD COLUMN IF NOT EXISTS embedding_qwen3 vector(${dimensions})
  `);
  console.log('Column embedding_qwen3 ready');
}

// --- Backfill searchable_text ---

async function backfillSearchableText(db: Client): Promise<number> {
  const BATCH_SIZE = 100;
  let totalProcessed = 0;

  while (true) {
    const batchRes = await db.query(
      `SELECT id, content FROM ai_memory.journal_entries
       WHERE searchable_text IS NULL AND content IS NOT NULL AND LENGTH(content) > 0
       ORDER BY id
       LIMIT $1`,
      [BATCH_SIZE]
    );

    if (batchRes.rows.length === 0) break;

    await db.query('BEGIN');
    try {
      for (const row of batchRes.rows) {
        const { text, sections } = extractSearchableText(row.content);
        // Empty string sentinel means "processed, genuinely empty"
        await db.query(
          `UPDATE ai_memory.journal_entries
           SET searchable_text = $1, sections = $2
           WHERE id = $3`,
          [text, JSON.stringify(sections), row.id]
        );
      }
      await db.query('COMMIT');
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    }

    totalProcessed += batchRes.rows.length;

    if (totalProcessed % 1000 < BATCH_SIZE) {
      console.log(`  Backfill progress: ${totalProcessed} entries processed`);
    }
  }

  console.log(`Backfill complete: ${totalProcessed} entries processed`);
  return totalProcessed;
}

// --- Count work ---

interface WorkCounts {
  totalWithText: number;
  emptyEntries: number;
  needsEmbedding: number;
  alreadyDone: number;
  unprocessed: number;
}

async function countWork(db: Client): Promise<WorkCounts> {
  const totalRes = await db.query(
    `SELECT COUNT(*) FROM ai_memory.journal_entries
     WHERE searchable_text IS NOT NULL AND LENGTH(searchable_text) > 0`
  );
  const totalWithText = parseInt(totalRes.rows[0].count, 10);

  const emptyRes = await db.query(
    `SELECT COUNT(*) FROM ai_memory.journal_entries
     WHERE searchable_text IS NOT NULL AND LENGTH(searchable_text) = 0`
  );
  const emptyEntries = parseInt(emptyRes.rows[0].count, 10);

  const needsRes = await db.query(
    `SELECT COUNT(*) FROM ai_memory.journal_entries
     WHERE searchable_text IS NOT NULL AND LENGTH(searchable_text) > 0
       AND embedding_qwen3 IS NULL`
  );
  const needsEmbedding = parseInt(needsRes.rows[0].count, 10);

  const unprocessedRes = await db.query(
    `SELECT COUNT(*) FROM ai_memory.journal_entries WHERE searchable_text IS NULL`
  );
  const unprocessed = parseInt(unprocessedRes.rows[0].count, 10);

  return {
    totalWithText,
    emptyEntries,
    needsEmbedding,
    alreadyDone: totalWithText - needsEmbedding,
    unprocessed,
  };
}

function printCounts(counts: WorkCounts): void {
  console.log(`\nWork summary:`);
  console.log(`  Entries with searchable content:    ${counts.totalWithText.toLocaleString()}`);
  console.log(`  Empty entries (frontmatter only):   ${counts.emptyEntries.toLocaleString()}`);
  console.log(`  Unprocessed (NULL searchable_text): ${counts.unprocessed.toLocaleString()}`);
  console.log(`  Already embedded (qwen3):           ${counts.alreadyDone.toLocaleString()}`);
  console.log(`  Needs embedding:                    ${counts.needsEmbedding.toLocaleString()}`);
}

// --- Batch re-embedding ---

async function reembedBatches(
  db: Client,
  embeddingClient: OpenAIClient,
  model: string,
  dimensions: number,
  documentPrefix: string,
  maxInputChars: number,
  batchSize: number
): Promise<void> {
  let totalProcessed = 0;
  const startTime = Date.now();
  let batchNum = 0;

  while (true) {
    // Fetch next batch of entries needing embedding
    const batchRes = await db.query(
      `SELECT id, searchable_text FROM ai_memory.journal_entries
       WHERE searchable_text IS NOT NULL AND LENGTH(searchable_text) > 0
         AND embedding_qwen3 IS NULL
       ORDER BY id
       LIMIT $1`,
      [batchSize]
    );

    if (batchRes.rows.length === 0) break;

    batchNum++;
    const entries = batchRes.rows as Array<{ id: number; searchable_text: string }>;

    // Prepare texts with document prefix and truncation
    const texts = entries.map((entry) => {
      const prefixed = documentPrefix + entry.searchable_text;
      return prefixed.length > maxInputChars ? prefixed.substring(0, maxInputChars) : prefixed;
    });

    // Generate embeddings with retry logic
    let embeddings: number[][] | undefined;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        embeddings = await embeddingClient.generateEmbedding(texts, model, dimensions);
        break;
      } catch (err) {
        if (attempt === 3) {
          throw new Error(
            `Batch ${batchNum} failed after 3 attempts: ${err instanceof Error ? err.message : String(err)}`
          );
        }
        const delayMs = Math.pow(2, attempt) * 1000;
        console.error(
          `  Batch ${batchNum} attempt ${attempt} failed, retrying in ${delayMs}ms: ${err instanceof Error ? err.message : String(err)}`
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    if (!embeddings || embeddings.length !== entries.length) {
      throw new Error(
        `Batch ${batchNum}: expected ${entries.length} embeddings, got ${embeddings?.length ?? 0}`
      );
    }

    // Write embeddings in a transaction for atomicity
    await db.query('BEGIN');
    try {
      for (let i = 0; i < entries.length; i++) {
        const vectorStr = `[${embeddings[i].join(',')}]`;
        await db.query(
          `UPDATE ai_memory.journal_entries SET embedding_qwen3 = $1::vector WHERE id = $2`,
          [vectorStr, entries[i].id]
        );
      }
      await db.query('COMMIT');
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    }

    totalProcessed += entries.length;

    // Progress report every 100 entries
    if (totalProcessed % 100 < batchSize) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = totalProcessed / elapsed;
      const remaining = await db.query(
        `SELECT COUNT(*) FROM ai_memory.journal_entries
         WHERE searchable_text IS NOT NULL AND LENGTH(searchable_text) > 0
           AND embedding_qwen3 IS NULL`
      );
      const remainingCount = parseInt(remaining.rows[0].count, 10);
      const etaSeconds = rate > 0 ? remainingCount / rate : 0;
      const etaMin = (etaSeconds / 60).toFixed(1);
      console.log(
        `  Progress: ${totalProcessed} done, ${rate.toFixed(1)} entries/sec, ` +
          `~${remainingCount} remaining, ETA ~${etaMin} min`
      );
    }
  }

  const elapsed = (Date.now() - startTime) / 1000;
  console.log(
    `\nRe-embedding complete: ${totalProcessed} entries in ${elapsed.toFixed(1)}s`
  );
}

// --- HNSW index ---

async function buildHnswIndex(db: Client): Promise<void> {
  console.log('\nBuilding HNSW index on embedding_qwen3 (this may take a while)...');
  await db.query(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_journal_entries_embedding_qwen3_hnsw
    ON ai_memory.journal_entries USING hnsw (embedding_qwen3 vector_cosine_ops)
    WITH (m=16, ef_construction=64)
  `);
  console.log('HNSW index created');
}

// --- Main ---

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const modelConfig = getModelConfig('qwen3-embedding:4b');

  const embeddingClient = new OpenAIClient({
    baseUrl: process.env.OPENAI_EMBEDDING_BASE_URL,
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 60000,
    concurrency: 1,
  });

  // 1. Pre-flight: verify the model produces correctly dimensioned vectors
  await preflightCheck(embeddingClient, modelConfig.model, modelConfig.dimensions);

  // Connect to database with a single Client (not Pool) for session-level trigger control
  const dbConfig = createDatabaseConfig();
  const db = new Client({
    host: dbConfig.host,
    port: dbConfig.port,
    database: dbConfig.database,
    user: dbConfig.user,
    password: dbConfig.password,
    ssl: dbConfig.ssl,
  });
  await db.connect();

  try {
    // 2. Ensure qwen3 column exists (DDL, always runs)
    await ensureQwen3Column(db, modelConfig.dimensions);

    // 3. Count work and print summary (read-only, always runs)
    const counts = await countWork(db);
    printCounts(counts);

    // 4. Dry-run gate: exit before any data modifications
    if (args.dryRun) {
      console.log('\n--dry-run specified, exiting without changes.');
      return;
    }

    // 5. Disable triggers for backfill and re-embedding (data repair operations)
    console.log('\nDisabling triggers on journal_entries...');
    await db.query('ALTER TABLE ai_memory.journal_entries DISABLE TRIGGER ALL');

    try {
      // 6. Backfill searchable_text for historical entries
      console.log('\nBackfilling searchable_text from content...');
      const backfilled = await backfillSearchableText(db);

      // 7. Re-count after backfill (counts changed if entries were processed)
      if (backfilled > 0) {
        const updatedCounts = await countWork(db);
        printCounts(updatedCounts);

        if (updatedCounts.needsEmbedding === 0) {
          console.log('\nAll entries already have qwen3 embeddings. Nothing to do.');
          return;
        }
      } else if (counts.needsEmbedding === 0) {
        console.log('\nAll entries already have qwen3 embeddings. Nothing to do.');
        return;
      }

      // 8. Re-embed entries
      await reembedBatches(
        db,
        embeddingClient,
        modelConfig.model,
        modelConfig.dimensions,
        modelConfig.documentPrefix,
        modelConfig.maxInputChars,
        args.batchSize
      );
    } finally {
      console.log('Re-enabling triggers on journal_entries...');
      await db.query('ALTER TABLE ai_memory.journal_entries ENABLE TRIGGER ALL');
    }

    // 9. Build HNSW index (outside trigger block, no surrounding transaction)
    await buildHnswIndex(db);
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error('Re-embedding failed:', err);
  process.exit(1);
});
