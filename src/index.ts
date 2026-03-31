#!/usr/bin/env node

// ABOUTME: Entry point for the mnemosyne MCP server
// ABOUTME: Initializes and starts the server with PostgreSQL backend

import { PrivateJournalServer } from './server';
import 'dotenv/config';

async function main(): Promise<void> {
  try {
    console.error('=== Mnemosyne MCP Server ===');
    console.error(`Node.js version: ${process.version}`);
    console.error(`Platform: ${process.platform}`);

    try {
      console.error(`Working directory: ${process.cwd()}`);
    } catch (error) {
      console.error(`Failed to get working directory: ${error}`);
    }

    const server = new PrivateJournalServer();
    await server.run();
  } catch (error) {
    console.error('Failed to start mnemosyne MCP server:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
