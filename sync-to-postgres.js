#!/usr/bin/env node
// ABOUTME: Sync script to transfer missing entries from SQLite to PostgreSQL
// ABOUTME: Transfers only new entries that don't exist in PostgreSQL yet

const { Pool } = require('pg');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// PostgreSQL configuration
const pgConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'mnemosyne_dev',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  ssl: process.env.DB_SSL === 'true',
};

// SQLite path
const sqlitePath = path.join(process.env.HOME, '.private-journal', 'journal.db');

async function syncEntries() {
  console.log('🔄 Starting SQLite → PostgreSQL sync...');
  
  // Connect to PostgreSQL
  const pgPool = new Pool(pgConfig);
  console.log('✅ Connected to PostgreSQL');
  
  // Connect to SQLite
  const sqlite = new sqlite3.Database(sqlitePath);
  console.log('✅ Connected to SQLite');
  
  try {
    // Get latest timestamp from PostgreSQL
    const latestPgResult = await pgPool.query(`
      SELECT MAX(EXTRACT(EPOCH FROM timestamp) * 1000) as latest_timestamp 
      FROM ai_memory.journal_entries
    `);
    const latestPgTimestamp = latestPgResult.rows[0].latest_timestamp;
    console.log(`🔍 Raw timestamp value: ${latestPgTimestamp} (type: ${typeof latestPgTimestamp})`);
    
    let latestDate = 'No entries';
    let timestampForQuery = 0;
    
    if (latestPgTimestamp && !isNaN(parseFloat(latestPgTimestamp)) && parseFloat(latestPgTimestamp) > 0) {
      timestampForQuery = parseFloat(latestPgTimestamp);
      latestDate = new Date(timestampForQuery).toISOString();
    }
    console.log(`📅 Latest PostgreSQL entry: ${latestDate}`);
    
    // Get entries from SQLite newer than latest PostgreSQL entry
    const sqliteEntries = await new Promise((resolve, reject) => {
      sqlite.all(`
        SELECT * FROM journal_entries 
        WHERE timestamp > ? 
        ORDER BY timestamp ASC
      `, [timestampForQuery], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
    
    console.log(`📊 Found ${sqliteEntries.length} new entries to sync`);
    
    if (sqliteEntries.length === 0) {
      console.log('🎯 No new entries to sync. Databases are in sync!');
      return;
    }
    
    // Insert entries into PostgreSQL
    let synced = 0;
    for (const entry of sqliteEntries) {
      try {
        await pgPool.query(`
          INSERT INTO ai_memory.journal_entries (
            content, timestamp, agent_id, model_id, visibility_level, entry_type, 
            user_id, type, category, sections
          ) VALUES ($1, to_timestamp($2::bigint / 1000), $3, $4, $5, $6, $7, $8, $9, $10)
        `, [
          entry.content,
          entry.timestamp,
          entry.agent_id || 'unknown',
          entry.model_id || 'unknown', 
          entry.visibility_level || 'private',
          entry.entry_type || 'reflection',
          'private-journal-mcp', // user_id
          entry.entry_type || 'general', // type
          'general', // category
          entry.sections ? JSON.parse(entry.sections) : [] // sections as array
        ]);
        synced++;
        
        if (synced % 50 === 0) {
          console.log(`📈 Synced ${synced}/${sqliteEntries.length} entries...`);
        }
      } catch (error) {
        console.error(`❌ Failed to sync entry ${entry.id}:`, error.message);
      }
    }
    
    console.log(`✅ Successfully synced ${synced}/${sqliteEntries.length} entries`);
    
    // Verify sync
    const finalPgCount = await pgPool.query('SELECT COUNT(*) FROM ai_memory.journal_entries');
    const finalSqliteCount = await new Promise((resolve, reject) => {
      sqlite.get('SELECT COUNT(*) as count FROM journal_entries', (err, row) => {
        if (err) reject(err);
        else resolve(row.count);
      });
    });
    
    console.log(`📊 Final counts: PostgreSQL = ${finalPgCount.rows[0].count}, SQLite = ${finalSqliteCount}`);
    
  } finally {
    await pgPool.end();
    sqlite.close();
    console.log('🔌 Connections closed');
  }
}

if (require.main === module) {
  syncEntries().catch(error => {
    console.error('💥 Sync failed:', error);
    process.exit(1);
  });
}