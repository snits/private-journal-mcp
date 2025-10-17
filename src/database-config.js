"use strict";
// ABOUTME: Database configuration for PostgreSQL connection
// ABOUTME: Simplified config management for private-journal-mcp
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDatabaseConfig = createDatabaseConfig;
function createDatabaseConfig() {
    return {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        database: process.env.DB_NAME || 'mnemosyne_prod',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || 'postgres',
        ssl: process.env.DB_SSL === 'true',
        maxConnections: 10,
        idleTimeoutMs: 30000,
        connectionTimeoutMs: 5000,
    };
}
