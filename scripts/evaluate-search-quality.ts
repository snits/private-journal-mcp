// ABOUTME: CLI tool to measure search quality against curated test queries
// ABOUTME: Computes Recall@k, MRR, and score distribution across eval fixtures

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Pool } from 'pg';
import { OpenAIClient } from '../src/openai-client';
import { getModelConfig } from '../src/embedding-config';
import { createDatabaseConfig } from '../src/database-config';

// --- Types ---

interface EvalQuery {
  id: string;
  query: string;
  description: string;
  expected_entry_ids: number[];
  expected_file_paths: string[];
  must_be_in_top_k: number;
}

interface EvalFixture {
  queries: EvalQuery[];
}

interface SearchResult {
  id: number;
  file_path: string;
  snippet: string;
  score: number;
}

interface QueryResult {
  query: EvalQuery;
  results: SearchResult[];
  recallAtK: number;
  recallAt3: number;
  recallAt5: number;
  reciprocalRank: number;
  foundIds: number[];
}

// --- Column whitelist ---

const ALLOWED_COLUMNS = ['embedding', 'embedding_768d', 'embedding_qwen3'];

function validateColumn(column: string): void {
  if (!ALLOWED_COLUMNS.includes(column)) {
    throw new Error(
      `Unknown column "${column}". Allowed columns: ${ALLOWED_COLUMNS.join(', ')}`
    );
  }
}

// --- CLI argument parsing ---

interface CliArgs {
  column: string;
  model?: string;
  verbose: boolean;
  limit: number;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    column: 'embedding',
    verbose: false,
    limit: 10,
  };

  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--column':
        args.column = argv[++i];
        break;
      case '--model':
        args.model = argv[++i];
        break;
      case '--verbose':
        args.verbose = true;
        break;
      case '--limit':
        args.limit = parseInt(argv[++i], 10);
        break;
      default:
        console.error(`Unknown argument: ${argv[i]}`);
        process.exit(1);
    }
  }

  validateColumn(args.column);

  if (isNaN(args.limit) || args.limit < 1) {
    throw new Error(`Invalid limit: ${args.limit}`);
  }

  return args;
}

// --- Metrics ---

function computeRecall(expectedIds: number[], resultIds: number[], k: number): number {
  if (expectedIds.length === 0) return 1;
  const topK = resultIds.slice(0, k);
  const found = expectedIds.filter((id) => topK.includes(id));
  return found.length / expectedIds.length;
}

function computeReciprocalRank(expectedIds: number[], resultIds: number[]): number {
  for (let i = 0; i < resultIds.length; i++) {
    if (expectedIds.includes(resultIds[i])) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

// --- Search ---

async function searchEntries(
  pool: Pool,
  embedding: number[],
  column: string,
  limit: number
): Promise<SearchResult[]> {
  // Column is validated against whitelist before reaching here
  const vectorStr = `[${embedding.join(',')}]`;
  const sql = `
    SELECT id, file_path, LEFT(searchable_text, 80) as snippet,
           1 - (${column} <=> $1::vector) AS score
    FROM ai_memory.journal_entries
    WHERE ${column} IS NOT NULL
    ORDER BY ${column} <=> $1::vector
    LIMIT $2
  `;

  const result = await pool.query(sql, [vectorStr, limit]);
  return result.rows.map((row: Record<string, unknown>) => ({
    id: Number(row.id),
    file_path: String(row.file_path),
    snippet: String(row.snippet || ''),
    score: Number(row.score),
  }));
}

// --- Output formatting ---

function printQueryResult(qr: QueryResult, verbose: boolean): void {
  const { query, results, foundIds, reciprocalRank } = qr;
  const scores = results.map((r) => r.score);
  const minScore = scores.length > 0 ? Math.min(...scores) : 0;
  const maxScore = scores.length > 0 ? Math.max(...scores) : 0;

  console.log(`\nQuery ${query.id}: "${query.query}"`);
  console.log(`  Expected: [${query.expected_entry_ids.join(', ')}]`);
  console.log(
    `  Found in top ${query.must_be_in_top_k}: [${foundIds.join(', ')}]  ` +
      `(${foundIds.length}/${query.expected_entry_ids.length} = ` +
      `${((foundIds.length / query.expected_entry_ids.length) * 100).toFixed(1)}%)`
  );

  if (reciprocalRank > 0) {
    const rank = Math.round(1 / reciprocalRank);
    console.log(
      `  First expected at rank: ${rank}  (RR = ${reciprocalRank.toFixed(3)})`
    );
  } else {
    console.log(`  First expected at rank: not found  (RR = 0.000)`);
  }

  console.log(`  Score range: ${minScore.toFixed(2)} - ${maxScore.toFixed(2)}`);

  if (verbose) {
    console.log(`  Top results:`);
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const marker = query.expected_entry_ids.includes(r.id) ? ' *' : '';
      console.log(
        `    #${i + 1} [id=${r.id}] (${r.score.toFixed(2)}) "${r.snippet.trim()}"${marker}`
      );
    }
  }
}

function printSummary(
  queryResults: QueryResult[],
  modelName: string,
  column: string
): void {
  const n = queryResults.length;
  const meanRecall3 = queryResults.reduce((s, qr) => s + qr.recallAt3, 0) / n;
  const meanRecall5 = queryResults.reduce((s, qr) => s + qr.recallAt5, 0) / n;
  const mrr = queryResults.reduce((s, qr) => s + qr.reciprocalRank, 0) / n;

  const allScores = queryResults.flatMap((qr) => qr.results.map((r) => r.score));
  const minScore = allScores.length > 0 ? Math.min(...allScores) : 0;
  const maxScore = allScores.length > 0 ? Math.max(...allScores) : 0;
  const meanScore =
    allScores.length > 0
      ? allScores.reduce((s, v) => s + v, 0) / allScores.length
      : 0;

  console.log(`\n=== Summary ===`);
  console.log(`  Recall@3: ${meanRecall3.toFixed(2)}`);
  console.log(`  Recall@5: ${meanRecall5.toFixed(2)}`);
  console.log(`  MRR: ${mrr.toFixed(2)}`);
  console.log(
    `  Score distribution: min=${minScore.toFixed(2)}, max=${maxScore.toFixed(2)}, mean=${meanScore.toFixed(2)}`
  );
  console.log(`  Queries evaluated: ${n}`);
}

// --- Main ---

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const config = getModelConfig(args.model);

  const client = new OpenAIClient({
    baseUrl: process.env.OPENAI_EMBEDDING_BASE_URL,
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 30000,
    concurrency: 1,
  });

  const dbConfig = createDatabaseConfig();
  const pool = new Pool({
    host: dbConfig.host,
    port: dbConfig.port,
    database: dbConfig.database,
    user: dbConfig.user,
    password: dbConfig.password,
    ssl: dbConfig.ssl,
    max: 3,
  });

  const fixturePath = resolve(__dirname, 'fixtures', 'eval-queries.json');
  const fixture: EvalFixture = JSON.parse(readFileSync(fixturePath, 'utf-8'));

  console.log(`=== Evaluation: ${config.model} (column: ${args.column}) ===`);

  const queryResults: QueryResult[] = [];

  for (const query of fixture.queries) {
    const prefixedQuery = config.queryPrefix + query.query;
    const [embedding] = await client.generateEmbedding([prefixedQuery], config.model);

    const results = await searchEntries(pool, embedding, args.column, args.limit);
    const resultIds = results.map((r) => r.id);

    const foundInTopK = query.expected_entry_ids.filter((id) =>
      resultIds.slice(0, query.must_be_in_top_k).includes(id)
    );

    const qr: QueryResult = {
      query,
      results,
      recallAtK: computeRecall(query.expected_entry_ids, resultIds, query.must_be_in_top_k),
      recallAt3: computeRecall(query.expected_entry_ids, resultIds, 3),
      recallAt5: computeRecall(query.expected_entry_ids, resultIds, 5),
      reciprocalRank: computeReciprocalRank(query.expected_entry_ids, resultIds),
      foundIds: foundInTopK,
    };

    queryResults.push(qr);
    printQueryResult(qr, args.verbose);
  }

  printSummary(queryResults, config.model, args.column);

  await pool.end();
}

main().catch((err) => {
  console.error('Evaluation failed:', err);
  process.exit(1);
});
