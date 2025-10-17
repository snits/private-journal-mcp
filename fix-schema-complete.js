#!/usr/bin/env node
// ABOUTME: Complete schema fix script to add ALL missing columns for PostgreSQL journal
// ABOUTME: Adds embedding column and any other missing columns from the INSERT statements

const { Pool } = require('pg');

async function fixSchemaComplete() {
  const config = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'mnemosyne_dev',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    ssl: process.env.DB_SSL === 'true',
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    application_name: 'schema-fix-complete'
  };

  const pool = new Pool(config);
  
  try {
    console.log('Connecting to PostgreSQL...');
    
    const client = await pool.connect();
    console.log('Connected successfully!');
    
    // Check current schema
    console.log('Checking current table schema...');
    const schemaResult = await client.query(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_schema = 'ai_memory' 
        AND table_name = 'journal_entries'
      ORDER BY ordinal_position
    `);
    
    const existingColumns = schemaResult.rows.map(row => row.column_name);
    console.log('Existing columns:', existingColumns);
    
    // Define required columns based on INSERT statements in the code
    const requiredColumns = [
      { name: 'date_string', type: 'VARCHAR(10)' },
      { name: 'file_path', type: 'TEXT' },
      { name: 'embedding', type: 'BYTEA' }, // For storing Float32Array as binary data
    ];
    
    const missingColumns = requiredColumns.filter(col => !existingColumns.includes(col.name));
    
    if (missingColumns.length === 0) {
      console.log('All required columns already exist!');
      client.release();
      return;
    }
    
    console.log('Missing columns:', missingColumns.map(col => col.name));
    
    // Add missing columns
    for (const column of missingColumns) {
      console.log(`Adding ${column.name} column...`);
      await client.query(`
        ALTER TABLE ai_memory.journal_entries 
        ADD COLUMN ${column.name} ${column.type}
      `);
      console.log(`✅ Added ${column.name} column (${column.type})`);
    }
    
    // Verify the changes
    console.log('Verifying schema changes...');
    const updatedSchemaResult = await client.query(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_schema = 'ai_memory' 
        AND table_name = 'journal_entries'
        AND column_name IN ('date_string', 'file_path', 'embedding')
      ORDER BY column_name
    `);
    
    console.log('New columns added:');
    updatedSchemaResult.rows.forEach(row => {
      console.log(`  ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
    });
    
    client.release();
    console.log('Complete schema fix completed successfully!');
    
  } catch (error) {
    console.error('Error fixing schema:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  fixSchemaComplete().catch(error => {
    console.error('Failed to fix schema:', error);
    process.exit(1);
  });
}

module.exports = { fixSchemaComplete };