# Project-Aware Journal Entries

## Overview

Journal entries automatically capture and store project context, enabling agents to filter searches by project and avoid cross-project confusion.

## How It Works

### Write Path
When journal entries are created:
1. `ProjectContextDetector` analyzes the current working directory
2. Extracts: project name, git remote, branch, primary language, working directory
3. Stores both `project` name (string) and full `project_context` (JSON)

### Search Path
When searching journals:
- `project_filter: 'current'` - Filter to current project only
- `project_filter: 'project-name'` - Filter to specific project
- `project_filter: ['proj1', 'proj2']` - Filter to multiple projects
- No filter - Search all projects (including NULL from old entries)

## Usage Examples

### Filter to current project
```json
{
  "query": "authentication implementation",
  "project_filter": "current"
}
```

### Filter to specific project
```json
{
  "query": "database schema",
  "project_filter": "private-journal-mcp"
}
```

### Filter to multiple projects
```json
{
  "query": "API design",
  "project_filter": ["project-a", "project-b"]
}
```

## Technical Details

- **Database**: PostgreSQL with `project` varchar and `project_context` jsonb columns
- **Index**: Partial index on `project WHERE project IS NOT NULL` for performance
- **Detection**: Uses git commands to extract project metadata
- **Fallback**: Gracefully handles detection failures by storing NULL

## Migration Notes

Old entries (pre-implementation) have NULL project fields and:
- Appear in unfiltered searches
- Excluded from project-filtered searches
- Show as "(no project)" in results
