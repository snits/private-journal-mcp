# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## PROJECT SCALE CONTEXT

- **Tool type**: Personal AI memory system (single user)
- **Codebase size**: ~2,000 lines TypeScript, small
- **Complexity preference**: Simple and direct, no over-engineering
- **Process overhead**: Minimal — TDD, atomic commits, domain review for non-trivial changes
- **Default approach**: Pragmatic

## Common Development Commands

```bash
npm run build        # Build the project
npm test             # Run tests
npm run test:watch   # Tests in watch mode
npm run dev          # TypeScript watcher
npm run lint         # Lint the code
npm run format       # Format the code
npm start            # Start the server

# Run a single test file
npx vitest run tests/parameter-transformation.test.ts
```

## Architecture Overview

Mnemosyne is an MCP server that provides AI agents with private journaling and semantic search backed by PostgreSQL+pgvector.

**Core Components:**
- `src/index.ts` — Entry point, starts the MCP server
- `src/server.ts` — MCP server with stdio transport, registers all tools
- `src/postgresql-journal-simple.ts` — All database operations (read/write/search)
- `src/openai-embedding-service.ts` — Embedding generation via OpenAI-compatible API
- `src/openai-client.ts` — Low-level HTTP client for embedding endpoints
- `src/project-context.ts` — Automatic project detection from git context
- `src/database-config.ts` — Database connection configuration from env vars
- `src/types.ts` — MCP tool request/response types
- `src/private-journal-types.ts` — Core data model types
- `src/response-formatting.ts` — Search result normalization for MCP responses

**Database:**
- PostgreSQL with pgvector extension
- Schema: `ai_memory`
- Primary table: `journal_entries` with `embedding_768d` vector(768) column
- HNSW index for cosine similarity search
- Production database: `mnemosyne_prod`
- Test database: `mnemosyne_test`

**Key Patterns:**
- All storage is PostgreSQL — no file-based fallback
- Embeddings via OpenAI-compatible API (default: Ollama with nomic-embed-text)
- Project context automatically detected from git and attached to entries
- User ID configurable via `USER_ID` env var (default: 'mnemosyne')

## MCP Tools

- `process_thoughts` — Multi-section private journaling (feelings, project_notes, user_context, technical_insights, world_knowledge)
- `search_journal` — Semantic search via pgvector with project filtering
- `read_journal_entry` — Read specific entry by file path
- `list_recent_entries` — Browse recent entries with optional filtering

## Testing

- Uses Vitest
- Tests in `tests/` directory
- Unit tests mock database connections
- Integration tests require running PostgreSQL with pgvector
