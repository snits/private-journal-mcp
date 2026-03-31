# Mnemosyne

An AI memory system built as an MCP (Model Context Protocol) server. Provides Claude and other AI agents with private journaling and semantic search capabilities backed by PostgreSQL and pgvector.

## Features

- **Multi-section journaling**: Separate categories for feelings, project notes, user context, technical insights, and world knowledge
- **Semantic search**: Natural language queries via pgvector cosine similarity
- **Project awareness**: Automatic project detection from git context, with per-project filtering
- **Multi-agent support**: Agent and model identity tracking, visibility controls
- **Privacy first**: All data stays in your PostgreSQL instance

## Requirements

- PostgreSQL 15+ with [pgvector](https://github.com/pgvector/pgvector) extension
- An OpenAI-compatible embedding endpoint (e.g., Ollama with nomic-embed-text)

## MCP Configuration

```json
{
  "mcpServers": {
    "mnemosyne": {
      "command": "node",
      "args": ["/path/to/mnemosyne/dist/index.js"],
      "env": {
        "DB_HOST": "localhost",
        "DB_PORT": "5432",
        "DB_NAME": "mnemosyne_prod",
        "DB_USER": "postgres",
        "DB_PASSWORD": "postgres",
        "OPENAI_EMBEDDING_BASE_URL": "http://localhost:11434/v1",
        "OPENAI_EMBEDDING_MODEL": "nomic-embed-text"
      }
    }
  }
}
```

## MCP Tools

### `process_thoughts`

Multi-section private journaling with optional categories:
- **feelings**: Private emotional processing
- **project_notes**: Technical insights for current project
- **user_context**: Notes about collaborating with humans
- **technical_insights**: General software engineering learnings
- **world_knowledge**: Domain knowledge and discoveries

### `search_journal`

Semantic search across all journal entries:
- **query** (required): Natural language search query
- **limit**: Maximum results (default: 10)
- **project_filter**: Filter by project ('current', specific name, or array)

### `read_journal_entry`

Read full content of a specific entry by file path.

### `list_recent_entries`

Browse recent entries chronologically with optional project filtering.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_HOST` | `localhost` | PostgreSQL host |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_NAME` | `mnemosyne_prod` | Database name |
| `DB_USER` | `postgres` | Database user |
| `DB_PASSWORD` | `postgres` | Database password |
| `DB_SSL` | `false` | Enable SSL |
| `USER_ID` | `mnemosyne` | User identifier for journal entries |
| `OPENAI_EMBEDDING_BASE_URL` | `http://localhost:11434/v1` | Embedding API endpoint |
| `OPENAI_EMBEDDING_MODEL` | `nomic-embed-text` | Embedding model name |
| `OPENAI_EMBEDDING_DIMENSIONS` | `768` | Embedding vector dimensions |

## Development

```bash
npm install
npm run build
npm test
npm run dev    # TypeScript watch mode
```

## Acknowledgments

Mnemosyne grew out of Jesse Vincent's [private-journal-mcp](https://github.com/obra/private-journal-mcp), a file-based journaling MCP server that gave AI agents a private space to process thoughts and feelings. Jesse's original design and his broader contributions to open source and agentic coding provided the foundation this project builds on. Thank you, Jesse.

## License

MIT
