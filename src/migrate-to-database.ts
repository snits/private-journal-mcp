#!/usr/bin/env node
// ABOUTME: Command-line migration utility for converting file-based journals to SQLite database
// ABOUTME: Provides progress reporting and handles large-scale migration of existing journal entries

import * as path from 'path';
import * as fs from 'fs/promises';
import { DatabaseJournalManager } from './database-journal';
import { MigrationService } from './migration';
import { resolveUserJournalPath, resolveProjectJournalPath } from './paths';

interface MigrationConfig {
  projectPath: string;
  userPath: string;
  databasePath: string;
  batchSize: number;
  continueOnError: boolean;
  dryRun: boolean;
}

async function parseArgs(): Promise<MigrationConfig> {
  const args = process.argv.slice(2);
  const config: MigrationConfig = {
    projectPath: resolveProjectJournalPath(),
    userPath: resolveUserJournalPath(),
    databasePath: path.join(resolveUserJournalPath(), 'journal.db'),
    batchSize: 50,
    continueOnError: true,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case '--project-path':
        if (!nextArg) throw new Error('--project-path requires a value');
        config.projectPath = path.resolve(nextArg);
        i++;
        break;
      case '--user-path':
        if (!nextArg) throw new Error('--user-path requires a value');
        config.userPath = path.resolve(nextArg);
        i++;
        break;
      case '--database':
        if (!nextArg) throw new Error('--database requires a value');
        config.databasePath = path.resolve(nextArg);
        i++;
        break;
      case '--batch-size':
        if (!nextArg) throw new Error('--batch-size requires a value');
        config.batchSize = parseInt(nextArg, 10);
        if (isNaN(config.batchSize) || config.batchSize < 1) {
          throw new Error('--batch-size must be a positive number');
        }
        i++;
        break;
      case '--stop-on-error':
        config.continueOnError = false;
        break;
      case '--dry-run':
        config.dryRun = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return config;
}

function printHelp(): void {
  console.log(`
Journal Database Migration Tool

Migrates file-based journal entries to SQLite database for improved performance.

Usage: npm run migrate [options]

Options:
  --project-path <path>    Path to project journal directory (default: current project)
  --user-path <path>       Path to user journal directory (default: ~/.private-journal)
  --database <path>        Path to SQLite database file (default: ./journal.db)
  --batch-size <number>    Number of entries to process per batch (default: 50)
  --stop-on-error          Stop migration on first error (default: continue)
  --dry-run                Discover entries but don't migrate (default: false)
  --help, -h               Show this help message

Examples:
  npm run migrate                                    # Migrate with defaults
  npm run migrate --database ./my-journal.db        # Use custom database path
  npm run migrate --dry-run                         # Check what would be migrated
  npm run migrate --stop-on-error --batch-size 10   # Smaller batches, fail fast
`);
}

async function checkPaths(config: MigrationConfig): Promise<void> {
  console.log('🔍 Checking source paths...');

  try {
    await fs.access(config.projectPath);
    console.log(`✅ Project path found: ${config.projectPath}`);
  } catch {
    console.log(`⚠️  Project path not found: ${config.projectPath}`);
  }

  try {
    await fs.access(config.userPath);
    console.log(`✅ User path found: ${config.userPath}`);
  } catch {
    console.log(`⚠️  User path not found: ${config.userPath}`);
  }

  // Check if database already exists
  try {
    await fs.access(config.databasePath);
    console.log(`⚠️  Database already exists: ${config.databasePath}`);
    console.log('   Migration will add to existing database.');
  } catch {
    console.log(`📊 Database will be created: ${config.databasePath}`);
  }
}

async function main(): Promise<void> {
  try {
    console.log('🚀 Journal Database Migration Tool');
    console.log('===================================\n');

    const config = await parseArgs();
    await checkPaths(config);

    console.log('\n📋 Configuration:');
    console.log(`   Project path: ${config.projectPath}`);
    console.log(`   User path: ${config.userPath}`);
    console.log(`   Database: ${config.databasePath}`);
    console.log(`   Batch size: ${config.batchSize}`);
    console.log(`   Continue on error: ${config.continueOnError}`);
    console.log(`   Dry run: ${config.dryRun}`);

    // Initialize database manager
    console.log('\n📊 Initializing database...');
    const dbManager = new DatabaseJournalManager(config.userPath);
    await dbManager.initialize();
    console.log('✅ Database initialized');

    // Initialize migration service
    const migrationService = new MigrationService(config.projectPath, config.userPath, dbManager);

    // Discover entries
    console.log('\n🔍 Discovering journal entries...');
    const discoveredEntries = await migrationService.discoverEntries();
    console.log(`📄 Found ${discoveredEntries.length} journal entries`);

    if (discoveredEntries.length === 0) {
      console.log('🎯 No entries found to migrate. Exiting.');
      await dbManager.close();
      return;
    }

    // Show breakdown
    const projectEntries = discoveredEntries.filter((e) => e.type === 'project');
    const userEntries = discoveredEntries.filter((e) => e.type === 'user');
    console.log(`   📁 Project entries: ${projectEntries.length}`);
    console.log(`   👤 User entries: ${userEntries.length}`);

    // Show agent breakdown
    const agentBreakdown = new Map<string, number>();
    discoveredEntries.forEach((entry) => {
      const agent = entry.metadata.agent_id || 'unknown';
      agentBreakdown.set(agent, (agentBreakdown.get(agent) || 0) + 1);
    });
    console.log('\n👥 Agent breakdown:');
    for (const [agent, count] of agentBreakdown.entries()) {
      console.log(`   ${agent}: ${count} entries`);
    }

    if (config.dryRun) {
      console.log('\n🎯 Dry run complete. No data was migrated.');
      await dbManager.close();
      return;
    }

    // Confirm migration
    console.log(`\n⚡ Ready to migrate ${discoveredEntries.length} entries to database.`);
    console.log('   This operation will copy all entries to the SQLite database.');
    console.log('   Original files will remain unchanged.');

    // In a real CLI tool, you'd prompt for confirmation here
    // For now, we'll proceed automatically
    console.log('\n🚀 Starting migration...');

    // Track progress
    let lastProgressTime = Date.now();
    const startTime = Date.now();

    const result = await migrationService.migrateEntries(discoveredEntries, {
      batchSize: config.batchSize,
      continueOnError: config.continueOnError,
      onProgress: (processed: number, total: number) => {
        const now = Date.now();
        if (now - lastProgressTime > 1000 || processed === total) {
          // Update every second
          const percentage = Math.round((processed / total) * 100);
          const elapsed = Math.round((now - startTime) / 1000);
          const rate = processed / elapsed;
          const eta = Math.round((total - processed) / rate);

          console.log(
            `📈 Progress: ${processed}/${total} (${percentage}%) - ${rate.toFixed(1)}/sec - ETA: ${eta}s`
          );
          lastProgressTime = now;
        }
      },
    });

    // Report results
    console.log('\n✅ Migration Complete!');
    console.log('===================');
    console.log(`📊 Total processed: ${result.totalProcessed}`);
    console.log(`✅ Successfully migrated: ${result.migratedCount}`);
    console.log(`⏭️  Skipped (duplicates): ${result.skippedCount}`);
    console.log(`❌ Failed: ${result.failedCount}`);
    console.log(`⚠️  Warnings: ${result.warningCount}`);
    console.log(`⏱️  Duration: ${(result.duration / 1000).toFixed(1)}s`);

    if (result.warnings.length > 0) {
      console.log('\n⚠️  Warnings:');
      result.warnings.slice(0, 10).forEach((warning) => console.log(`   ${warning}`));
      if (result.warnings.length > 10) {
        console.log(`   ... and ${result.warnings.length - 10} more warnings`);
      }
    }

    if (result.errors.length > 0) {
      console.log('\n❌ Errors:');
      result.errors.slice(0, 5).forEach((error) => console.log(`   ${error}`));
      if (result.errors.length > 5) {
        console.log(`   ... and ${result.errors.length - 5} more errors`);
      }
    }

    if (result.success) {
      console.log('\n🎉 Migration completed successfully!');
      console.log(`📊 Database ready at: ${config.databasePath}`);
    } else {
      console.log(`\n⚠️  Migration completed with ${result.failedCount} failures.`);
      console.log('   Check the errors above for details.');
      process.exit(1);
    }

    await dbManager.close();
  } catch (error) {
    console.error('\n💥 Migration failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Add npm script command to package.json
if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
