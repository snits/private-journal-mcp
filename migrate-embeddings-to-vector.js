#!/usr/bin/env ts-node
"use strict";
// ABOUTME: Migrates journal entries from legacy bytea embedding format to pgvector format
// ABOUTME: Converts existing embeddings in-place without regenerating from content
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const pg_1 = require("pg");
const database_config_1 = require("./src/database-config");
const dotenv = __importStar(require("dotenv"));
dotenv.config();
async function migrateEmbeddings(batchSize = 100) {
    const config = (0, database_config_1.createDatabaseConfig)();
    const pool = new pg_1.Pool({
        host: config.host,
        port: config.port,
        database: config.database,
        user: config.user,
        password: config.password,
        ssl: config.ssl,
    });
    const startTime = Date.now();
    try {
        // Get count of entries to migrate
        const countResult = await pool.query(`
      SELECT COUNT(*) as total
      FROM ai_memory.journal_entries
      WHERE embedding IS NOT NULL
        AND embedding_768d IS NULL
        AND octet_length(embedding) > 0
    `);
        const totalToMigrate = parseInt(countResult.rows[0].total);
        console.log('=== Embedding Migration to pgvector ===');
        console.log(`Entries to migrate: ${totalToMigrate}`);
        console.log(`Batch size: ${batchSize}`);
        console.log('');
        if (totalToMigrate === 0) {
            console.log('No entries to migrate. All embeddings are already in vector format.');
            return;
        }
        let totalMigrated = 0;
        let totalErrors = 0;
        let batchNum = 0;
        while (true) {
            // Fetch batch of entries with legacy embeddings
            // Always use OFFSET 0 since WHERE clause filters out migrated entries
            const query = `
        SELECT id, embedding, file_path
        FROM ai_memory.journal_entries
        WHERE embedding IS NOT NULL
          AND embedding_768d IS NULL
          AND octet_length(embedding) > 0
        ORDER BY id
        LIMIT $1
      `;
            const result = await pool.query(query, [batchSize]);
            const entries = result.rows;
            if (entries.length === 0) {
                break;
            }
            batchNum++;
            const totalBatches = Math.ceil(totalToMigrate / batchSize);
            console.log(`Processing batch ${batchNum}/${totalBatches} (${entries.length} entries)...`);
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                for (const entry of entries) {
                    try {
                        // Convert Buffer (bytea) to Float32Array
                        const embeddingArray = Array.from(new Float32Array(entry.embedding.buffer, entry.embedding.byteOffset, entry.embedding.byteLength / 4));
                        // Verify expected dimension
                        if (embeddingArray.length !== 768) {
                            console.warn(`  Warning: Entry ${entry.id} has unexpected dimension ${embeddingArray.length}, expected 768`);
                            totalErrors++;
                            continue;
                        }
                        // Update embedding_768d column with array literal format
                        const vectorLiteral = `[${embeddingArray.join(',')}]`;
                        await client.query('UPDATE ai_memory.journal_entries SET embedding_768d = $1::vector WHERE id = $2', [vectorLiteral, entry.id]);
                        totalMigrated++;
                    }
                    catch (error) {
                        console.error(`  Error processing entry ${entry.id}:`, error);
                        totalErrors++;
                    }
                }
                await client.query('COMMIT');
                console.log(`  ✓ Batch complete (${totalMigrated}/${totalToMigrate} migrated)`);
            }
            catch (error) {
                await client.query('ROLLBACK');
                console.error(`  ✗ Batch failed:`, error);
                totalErrors += entries.length;
            }
            finally {
                client.release();
            }
        }
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log('');
        console.log('=== Migration Summary ===');
        console.log(`Total entries: ${totalToMigrate}`);
        console.log(`Successfully migrated: ${totalMigrated}`);
        console.log(`Errors: ${totalErrors}`);
        console.log(`Success rate: ${((totalMigrated / totalToMigrate) * 100).toFixed(1)}%`);
        console.log(`Time taken: ${duration}s`);
        console.log('');
        // Verify final state
        console.log('=== Verification ===');
        const verifyResult = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE embedding IS NOT NULL AND embedding_768d IS NULL AND octet_length(embedding) > 0) as legacy_only,
        COUNT(*) FILTER (WHERE embedding IS NOT NULL AND octet_length(embedding) = 0) as empty_embedding,
        COUNT(*) FILTER (WHERE embedding_768d IS NOT NULL) as new_format,
        COUNT(*) as total
      FROM ai_memory.journal_entries
    `);
        const stats = verifyResult.rows[0];
        console.log(`Legacy format only: ${stats.legacy_only}`);
        console.log(`Empty embeddings (skipped): ${stats.empty_embedding}`);
        console.log(`New pgvector format: ${stats.new_format}`);
        console.log(`Total entries: ${stats.total}`);
        if (parseInt(stats.legacy_only) === 0) {
            console.log('');
            console.log('✓ Migration complete! All valid entries now use pgvector format.');
            if (parseInt(stats.empty_embedding) > 0) {
                console.log(`Note: ${stats.empty_embedding} entries have empty embeddings and were skipped.`);
            }
        }
        else {
            console.log('');
            console.log(`⚠ Warning: ${stats.legacy_only} entries still in legacy format.`);
        }
    }
    catch (error) {
        console.error('Fatal error:', error);
        throw error;
    }
    finally {
        await pool.end();
    }
}
// Parse command line arguments
const args = process.argv.slice(2);
const batchSizeArg = args.find((arg) => arg.startsWith('--batch-size='));
const batchSize = batchSizeArg ? parseInt(batchSizeArg.split('=')[1]) : 100;
console.log('Starting embedding migration...');
console.log('');
migrateEmbeddings(batchSize)
    .then(() => {
    console.log('Done!');
    process.exit(0);
})
    .catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
});
