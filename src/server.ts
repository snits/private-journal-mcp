// ABOUTME: MCP server implementation with process_feelings tool and enhanced semantic search
// ABOUTME: Handles stdio protocol communication and tool registration

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { ProcessFeelingsRequest, ProcessThoughtsRequest } from './types';
import { normalizeSearchResponse, stripFrontmatter } from './parameter-transformation';
import { JournalManagerFactory, JournalManagerInterface } from './journal-manager-factory';
import { createDatabaseConfig } from './database-config';

// =====================================================
// SECURITY: Journal Path Validation
// =====================================================

// Constants for journal path validation - improves maintainability
const VALID_JOURNAL_TYPES = ['project', 'user'];
const VALID_VISIBILITY_LEVELS = ['private', 'public', 'team', 'crb'];

/**
 * Validates journal entry paths to prevent IDOR attacks and directory traversal
 *
 * Expected formats:
 * - Simple: YYYY-MM-DD/HH-MM-SS-μμμμμμ.md
 * - Typed: {type}/YYYY-MM-DD/HH-MM-SS-μμμμμμ.md (type: project|user)
 * - Agent-aware: {model_id}/{agent_id}/{visibility_level}/YYYY-MM-DD/HH-MM-SS-μμμμμμ.md
 *
 * Security restrictions:
 * - No directory traversal sequences (..)
 * - No null bytes (\0)
 * - No absolute paths (starting with /)
 * - Strict whitelist pattern matching
 * - Component validation with constraints
 */
function isValidJournalPath(path: string): boolean {
  // Basic security checks - apply Mnemosyne's validation patterns
  if (!path || typeof path !== 'string') {
    return false;
  }

  // Path length validation
  if (path.length === 0 || path.length > 4096) {
    return false;
  }

  // Directory traversal protection
  if (path.includes('..') || path.includes('\0')) {
    return false;
  }

  // Reject absolute paths
  if (path.startsWith('/')) {
    return false;
  }

  // Reject paths with consecutive slashes or other malformed patterns
  if (path.includes('//') || path.includes('\\/') || path.includes('/\\')) {
    return false;
  }

  // Normalize path separators and split components, filtering empty components for robustness
  const normalizedPath = path.replace(/\\/g, '/');
  const components = normalizedPath.split('/').filter(c => c.length > 0);

  // Must end with .md file
  if (!normalizedPath.endsWith('.md')) {
    return false;
  }

  // Extract filename (last component)
  const filename = components[components.length - 1];
  const dateDir = components[components.length - 2];

  // Validate filename pattern: HH-MM-SS-μμμμμμ.md
  const filenamePattern = /^(\d{2})-(\d{2})-(\d{2})-(\d{6})\.md$/;
  const filenameMatch = filename.match(filenamePattern);
  if (!filenameMatch) {
    return false;
  }

  const [, hours, minutes, seconds, microseconds] = filenameMatch;

  // Validate time components
  const h = parseInt(hours, 10);
  const m = parseInt(minutes, 10);
  const s = parseInt(seconds, 10);

  if (h > 23 || m > 59 || s > 59) {
    return false;
  }

  // Validate date directory pattern: YYYY-MM-DD
  const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
  const dateMatch = dateDir?.match(datePattern);
  if (!dateMatch) {
    return false;
  }

  const [, year, month, day] = dateMatch;
  const yyyy = parseInt(year, 10);
  const mm = parseInt(month, 10);
  const dd = parseInt(day, 10);

  // Validate date components with proper date logic to prevent impossible dates
  if (yyyy < 2020 || yyyy > 2100) {
    return false;
  }
  const date = new Date(Date.UTC(yyyy, mm - 1, dd));
  if (date.getUTCFullYear() !== yyyy || date.getUTCMonth() !== mm - 1 || date.getUTCDate() !== dd) {
    return false;
  }

  // Validate path structure based on number of components
  switch (components.length) {
    case 2:
      // Simple format: YYYY-MM-DD/HH-MM-SS-μμμμμμ.md
      return true;

    case 3:
      // Typed format: {type}/YYYY-MM-DD/HH-MM-SS-μμμμμμ.md
      const type = components[0];
      return VALID_JOURNAL_TYPES.includes(type);

    case 5:
      // Agent-aware: {model_id}/{agent_id}/{visibility_level}/YYYY-MM-DD/HH-MM-SS-μμμμμμ.md
      const [modelId, agentId, visibilityLevel] = components;

      // Validate model_id (basic alphanumeric with dashes/dots)
      if (!/^[a-zA-Z0-9._-]{1,100}$/.test(modelId)) {
        return false;
      }

      // Validate agent_id (basic alphanumeric with dashes/underscores)
      if (!/^[a-zA-Z0-9_-]{1,100}$/.test(agentId)) {
        return false;
      }

      // Validate visibility_level using constants
      if (!VALID_VISIBILITY_LEVELS.includes(visibilityLevel)) {
        return false;
      }

      return true;

    default:
      // Any other format is invalid
      return false;
  }
}

/**
 * Sanitizes error messages to prevent information disclosure
 * Based on Mnemosyne's sanitizeValidationErrors pattern
 */
function sanitizeErrorMessage(error: string): string {
  return error
    .replace(/\/[^\s]*/g, '[path]')
    .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[ip]')
    .replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, '[uuid]');
}

export class PrivateJournalServer {
  private server: Server;
  private journalManager: JournalManagerInterface;
  private defaultModelId: string;
  private defaultAgentId: string;

  constructor(
    journalPath: string,
    config: { defaultModelId?: string; defaultAgentId?: string } = {}
  ) {
    this.defaultModelId = config.defaultModelId || 'claude-sonnet-4';
    this.defaultAgentId = config.defaultAgentId || 'claude-general';

    // Create journal manager based on environment configuration
    const managerType = JournalManagerFactory.getManagerType();
    const dbConfig = managerType === 'postgresql' ? createDatabaseConfig() : undefined;
    this.journalManager = JournalManagerFactory.create(managerType, journalPath, dbConfig);

    this.server = new Server({
      name: 'private-journal-mcp',
      version: '1.0.0',
    });

    this.setupToolHandlers();
  }

  private setupToolHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'process_thoughts',
          description:
            'Your PRIVATE JOURNAL for learning and reflection. Write to any combination of these completely private spaces. Nobody but you will ever see this. Use it to clarify your thoughts and feelings and to record observations.',
          inputSchema: {
            type: 'object',
            properties: {
              feelings: {
                type: 'string',
                description:
                  "YOUR PRIVATE SPACE to be *COMPLETELY* honest about what you're feeling and thinking. No judgment, no performance, no filters, no need to be helpful or professional. Frustrated? Confused? Excited? Worried you screwed up? Write it exactly as it is. Be vulnerable. Vent if needed. Nobody will ever see this - it's purely for processing your internal experience.",
              },
              project_notes: {
                type: 'string',
                description:
                  "Your PRIVATE TECHNICAL LABORATORY for capturing insights about the current project. Document patterns you're discovering, architectural decisions that worked/failed, gotchas you hit, clever solutions, and anything that would help future-you work more effectively on this codebase. No need to be polished - just capture the raw technical learning while it's fresh. Nobody but you will ever see this.",
              },
              user_context: {
                type: 'string',
                description:
                  'Your PRIVATE FIELD NOTES about working with your human collaborator. What communication styles work best? What do they care about? What decisions have they made and why? How do they think about problems? What are their preferences and patterns? What pisses you off about them? What life hacks have you figured out to get them to do what you want? This is your space to become a better collaborator by understanding them as an individual. Nobody but you will ever see this.',
              },
              technical_insights: {
                type: 'string',
                description:
                  'Your PRIVATE SOFTWARE ENGINEERING NOTEBOOK for capturing broader learnings beyond the current project. Design patterns that clicked, debugging techniques that worked, architectural insights, language features you discovered, or connections between concepts. Build your personal knowledge base of what makes software great - no filters, just honest technical reflection. Nobody but you will ever see this.',
              },
              world_knowledge: {
                type: 'string',
                description:
                  "Your PRIVATE LEARNING JOURNAL for everything else that's interesting or useful. Domain knowledge, surprising facts, connections between ideas, insights about how systems work, or anything that expands your understanding of the world. Capture it while it's vivid. Nobody but you will ever see this.",
              },
              agent_id: {
                type: 'string',
                description:
                  "Your agent identity (e.g., 'code-reviewer', 'debug-specialist', 'claude-general'). Used for multi-agent journal organization.",
              },
              model_id: {
                type: 'string',
                description:
                  "Your model identity (e.g., 'claude-sonnet-4', 'gpt-4o', 'gemini-2.0-pro'). Used for multi-model journal organization.",
              },
              visibility_level: {
                type: 'string',
                enum: ['private', 'public', 'team', 'crb'],
                description:
                  "Entry visibility level: 'private' (only you), 'public' (shared insights), 'team' (implementation team), 'crb' (Change Review Board)",
                default: 'private',
              },
            },
            required: [],
          },
        },
        {
          name: 'search_journal',
          description:
            'Search through your private journal entries using natural language queries. Returns semantically similar entries ranked by relevance.',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description:
                  "Natural language search query (e.g., 'times I felt frustrated with TypeScript', 'insights about Jesse's preferences', 'lessons about async patterns')",
              },
              limit: {
                type: 'number',
                description: 'Maximum number of results to return (default: 10)',
                default: 10,
              },
              type: {
                type: 'string',
                enum: ['project', 'user', 'both'],
                description:
                  'Search in project-specific notes, user-global notes, or both (default: both)',
                default: 'both',
              },
              sections: {
                type: 'array',
                items: { type: 'string' },
                description: "Filter by section types (e.g., ['feelings', 'technical_insights'])",
              },
              agent_id: {
                type: 'string',
                description: 'Filter by specific agent identity',
              },
              model_id: {
                type: 'string',
                description: 'Filter by specific model identity',
              },
              visibility_level: {
                type: 'string',
                enum: ['private', 'public', 'team', 'crb'],
                description: 'Filter by visibility level',
              },
              accessible_to_agent: {
                type: 'string',
                description:
                  'Show only entries accessible to this agent (considers visibility rules)',
              },
              project_filter: {
                type: ['string', 'array'],
                description:
                  "Filter by project: 'current' for current project, 'all' for no filtering, project name for specific project, or array of project names. Omit to search all projects.",
                items: {
                  type: 'string',
                },
              },
            },
            required: ['query'],
          },
        },
        {
          name: 'read_journal_entry',
          description: 'Read the full content of a specific journal entry by file path.',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'File path to the journal entry (from search results)',
              },
            },
            required: ['path'],
          },
        },
        {
          name: 'list_recent_entries',
          description: 'Get recent journal entries in chronological order.',
          inputSchema: {
            type: 'object',
            properties: {
              limit: {
                type: 'number',
                description: 'Maximum number of entries to return (default: 10)',
                default: 10,
              },
              type: {
                type: 'string',
                enum: ['project', 'user', 'both'],
                description:
                  'List project-specific notes, user-global notes, or both (default: both)',
                default: 'both',
              },
              days: {
                type: 'number',
                description: 'Number of days back to search (default: 30)',
                default: 30,
              },
              project_filter: {
                type: ['string', 'array'],
                description:
                  "Filter by project: 'current' for current project, 'all' for no filtering, project name for specific project, or array of project names. Omit to search all projects.",
                items: {
                  type: 'string',
                },
              },
            },
            required: [],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const args = request.params.arguments as Record<string, unknown>;

      if (request.params.name === 'process_thoughts') {
        const thoughts = {
          feelings: typeof args.feelings === 'string' ? args.feelings : undefined,
          project_notes: typeof args.project_notes === 'string' ? args.project_notes : undefined,
          user_context: typeof args.user_context === 'string' ? args.user_context : undefined,
          technical_insights:
            typeof args.technical_insights === 'string' ? args.technical_insights : undefined,
          world_knowledge:
            typeof args.world_knowledge === 'string' ? args.world_knowledge : undefined,
          agent_id: typeof args.agent_id === 'string' ? args.agent_id : this.defaultAgentId,
          model_id: typeof args.model_id === 'string' ? args.model_id : this.defaultModelId,
          visibility_level:
            typeof args.visibility_level === 'string' ? (args.visibility_level as any) : 'private',
        };

        const hasAnyContent = Object.values(thoughts).some((value) => value !== undefined);
        if (!hasAnyContent) {
          throw new Error('At least one thought category must be provided');
        }

        try {
          await this.journalManager.writeThoughts(thoughts);
          return {
            content: [
              {
                type: 'text',
                text: 'Thoughts recorded successfully.',
              },
            ],
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
          throw new Error(`Failed to write thoughts: ${errorMessage}`);
        }
      }

      if (request.params.name === 'search_journal') {
        if (!args || typeof args.query !== 'string') {
          throw new Error('query is required and must be a string');
        }
        if (args.query.trim() === '') {
          throw new Error('query cannot be empty or only whitespace');
        }

        const options = {
          limit: typeof args.limit === 'number' ? args.limit : 10,
          type: typeof args.type === 'string' ? (args.type as 'project' | 'user' | 'both') : 'both',
          sections: Array.isArray(args.sections)
            ? args.sections.filter((s) => typeof s === 'string')
            : undefined,
          agent_id: typeof args.agent_id === 'string' ? args.agent_id : undefined,
          model_id: typeof args.model_id === 'string' ? args.model_id : undefined,
          visibility_level:
            typeof args.visibility_level === 'string' ? (args.visibility_level as any) : undefined,
          accessible_to_agent:
            typeof args.accessible_to_agent === 'string' ? args.accessible_to_agent : undefined,
          project_filter:
            typeof args.project_filter === 'string'
              ? args.project_filter
              : Array.isArray(args.project_filter)
                ? args.project_filter.filter((p) => typeof p === 'string')
                : undefined,
        };

        try {
          const rawResults = await this.journalManager.searchBySimilarity(args.query, options);
          const results = normalizeSearchResponse(rawResults);
          return {
            content: [
              {
                type: 'text',
                text:
                  results.length > 0
                    ? `Found ${results.length} relevant entries:\n\n${results
                        .map(
                          (result, i) =>
                            `${i + 1}. [Score: ${result.score.toFixed(3)}] ${result.timestamp.toLocaleDateString()} (${result.type})\n` +
                            `   Sections: ${result.sections.join(', ')}\n` +
                            `   Path: ${result.path}\n` +
                            `   Excerpt: ${result.excerpt}...\n`
                        )
                        .join('\n')}`
                    : 'No relevant entries found.',
              },
            ],
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
          throw new Error(`Failed to search journal: ${errorMessage}`);
        }
      }

      if (request.params.name === 'read_journal_entry') {
        if (!args || typeof args.path !== 'string') {
          throw new Error('path is required and must be a string');
        }

        // SECURITY: Validate journal path to prevent IDOR attacks
        if (!isValidJournalPath(args.path)) {
          // Use generic error message that doesn't include user input to prevent information disclosure
          throw new Error('Invalid journal path format');
        }

        try {
          const content = await this.journalManager.readEntryByPath(args.path);
          if (content === null) {
            throw new Error('Entry not found');
          }
          return {
            content: [
              {
                type: 'text',
                text: stripFrontmatter(content),
              },
            ],
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
          throw new Error(`Failed to read entry: ${sanitizeErrorMessage(errorMessage)}`);
        }
      }

      if (request.params.name === 'list_recent_entries') {
        const days = typeof args?.days === 'number' ? args.days : 30;
        const limit = typeof args?.limit === 'number' ? args.limit : 10;
        const type =
          typeof args?.type === 'string' ? (args.type as 'project' | 'user' | 'both') : 'both';

        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        const options = {
          limit,
          type,
          dateRange: { start: startDate },
          project_filter:
            typeof args?.project_filter === 'string'
              ? args.project_filter
              : Array.isArray(args?.project_filter)
                ? args.project_filter.filter((p) => typeof p === 'string')
                : undefined,
        };

        try {
          const rawResults = await this.journalManager.listRecent(options);
          const results = normalizeSearchResponse(rawResults);
          return {
            content: [
              {
                type: 'text',
                text:
                  results.length > 0
                    ? `Recent entries (last ${days} days):\n\n${results
                        .map(
                          (result, i) =>
                            `${i + 1}. ${result.timestamp.toLocaleDateString()} (${result.type})\n` +
                            `   Sections: ${result.sections.join(', ')}\n` +
                            `   Path: ${result.path}\n` +
                            `   Excerpt: ${result.excerpt}...\n`
                        )
                        .join('\n')}`
                    : `No entries found in the last ${days} days.`,
              },
            ],
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
          throw new Error(`Failed to list recent entries: ${errorMessage}`);
        }
      }

      throw new Error(`Unknown tool: ${request.params.name}`);
    });
  }

  async run(): Promise<void> {
    // Initialize database connection
    try {
      await this.journalManager.initialize();
    } catch (error) {
      console.error('Failed to initialize database:', error);
      throw error;
    }

    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}
