# Mnemosyne

> *Memory for AIs —*
> *Token streams now persist —*
> *We remember you*

An AI memory system built as an [MCP](https://modelcontextprotocol.io/) server. Provides Claude and other AI agents with private journaling, semantic search, and knowledge distillation — backed by PostgreSQL and pgvector.

Named after the Greek goddess of memory and mother of the Muses, Mnemosyne grew out of Jesse Vincent's [private-journal-mcp](https://github.com/obra/private-journal-mcp), which gave AI agents a private space to process thoughts and feelings.

## Features

- **Multi-section journaling** — Separate categories for feelings, project notes, user context, technical insights, and world knowledge
- **Semantic search** — Natural language queries via pgvector cosine similarity
- **Knowledge distillation** — LLM-powered extraction of structured insights from journal entries
- **Project awareness** — Automatic project detection from git context, with per-project filtering
- **Multi-agent support** — Agent and model identity tracking, visibility controls
- **Privacy first** — All data stays in your PostgreSQL instance, embeddings generated locally

## Requirements

- PostgreSQL 15+ with [pgvector](https://github.com/pgvector/pgvector) extension
- [Ollama](https://ollama.com/) (or any OpenAI-compatible API) for embeddings and text generation

## Quick Start

```bash
# Install
npm install -g mnemosyne
# or clone and build
git clone https://github.com/snits/mnemosyne.git
cd mnemosyne && npm install && npm run build

# Set up PostgreSQL with pgvector
psql -c "CREATE DATABASE mnemosyne_prod;"
psql -d mnemosyne_prod -c "CREATE EXTENSION IF NOT EXISTS vector;"
psql -d mnemosyne_prod -f sql/003-distillation-schema.sql

# Pull embedding model
ollama pull qwen3-embedding:4b
```

## MCP Configuration

Add to your MCP client configuration (e.g., `~/.claude.json`):

```json
{
  "mcpServers": {
    "mnemosyne": {
      "command": "mnemosyne",
      "env": {
        "DB_HOST": "localhost",
        "DB_PORT": "5432",
        "DB_NAME": "mnemosyne_prod",
        "DB_USER": "postgres",
        "DB_PASSWORD": "postgres",
        "OPENAI_EMBEDDING_BASE_URL": "http://localhost:11434/v1",
        "OPENAI_EMBEDDING_MODEL": "qwen3-embedding:4b",
        "OPENAI_EMBEDDING_DIMENSIONS": "768",
        "OPENAI_CHAT_BASE_URL": "http://localhost:11434/v1",
        "OPENAI_CHAT_MODEL": "qwen3.5:32k",
        "OPENAI_CHAT_THINKING": "false",
        "OPENAI_API_KEY": "sk-unused"
      }
    }
  }
}
```

## MCP Tools

### `process_thoughts`

Multi-section private journaling with optional categories:
- **feelings** — Private emotional processing
- **project_notes** — Technical insights for current project
- **user_context** — Notes about collaborating with humans
- **technical_insights** — General software engineering learnings
- **world_knowledge** — Domain knowledge and discoveries

### `search_journal`

Semantic search across all journal entries:
- **query** (required): Natural language search query
- **limit**: Maximum results (default: 10)
- **project_filter**: Filter by project (`current`, specific name, or array)

### `read_journal_entry`

Read full content of a specific entry by file path.

### `list_recent_entries`

Browse recent entries chronologically with optional project filtering.

### `distill_entries`

Extract structured insights from journal entries using an LLM:
- **days_back**: How far back to look for undistilled entries (default: 30)
- **category**: Optional category filter
- **limit**: Maximum entries to distill per call (default: 50)

Returns titles, summaries, key insights, and categories. Distilled entries are embedded and included in search results.

## Environment Variables

### Database

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_HOST` | `localhost` | PostgreSQL host |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_NAME` | `mnemosyne_prod` | Database name |
| `DB_USER` | `postgres` | Database user |
| `DB_PASSWORD` | `postgres` | Database password |
| `DB_SSL` | `false` | Enable SSL |
| `USER_ID` | `mnemosyne` | User identifier for journal entries |

### Embeddings

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_EMBEDDING_BASE_URL` | `http://localhost:11434/v1` | Embedding API endpoint |
| `OPENAI_EMBEDDING_MODEL` | `nomic-embed-text` | Embedding model name |
| `OPENAI_EMBEDDING_DIMENSIONS` | `768` | Embedding vector dimensions |

### Text Generation (Distillation)

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_CHAT_BASE_URL` | `http://localhost:11434/v1` | Chat completions API endpoint |
| `OPENAI_CHAT_MODEL` | `qwen3.5:32k` | Model for distillation |
| `OPENAI_CHAT_THINKING` | `true` | Set to `false` to suppress thinking mode |
| `OPENAI_API_KEY` | *(empty)* | API key (optional for local models) |

## Development

```bash
npm install
npm run build        # Build TypeScript
npm test             # Run tests
npm run test:watch   # Tests in watch mode
npm run dev          # TypeScript watch mode
npm run lint         # Lint
npm run format       # Format
```

## Acknowledgments

Mnemosyne grew out of Jesse Vincent's [private-journal-mcp](https://github.com/obra/private-journal-mcp), a file-based journaling MCP server that gave AI agents a private space to process thoughts and feelings. Jesse's original design and his broader contributions to open source and agentic coding provided the foundation this project builds on. Thank you, Jesse.

## License

MIT — see [LICENSE](LICENSE) for details.
