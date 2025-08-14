// ABOUTME: MCP server implementation with process_feelings tool and enhanced semantic search
// ABOUTME: Handles stdio protocol communication and tool registration

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { ProcessFeelingsRequest, ProcessThoughtsRequest } from './types';
import { SearchService } from './search';
import { JournalManagerFactory, JournalManagerInterface } from './journal-manager-factory';
import { createDatabaseConfig } from './database-config';
import { SemanticSearchTools } from './semantic-search-tools';

export class PrivateJournalServer {
  private server: Server;
  private journalManager: JournalManagerInterface;
  private searchService: SearchService;
  private semanticSearchTools: SemanticSearchTools | null = null;
  private defaultModelId: string;
  private defaultAgentId: string;

  constructor(journalPath: string, config: { defaultModelId?: string; defaultAgentId?: string } = {}) {
    this.defaultModelId = config.defaultModelId || 'claude-sonnet-4';
    this.defaultAgentId = config.defaultAgentId || 'claude-general';
    
    // Create journal manager based on environment configuration
    const managerType = JournalManagerFactory.getManagerType();
    const dbConfig = managerType === 'postgresql' ? createDatabaseConfig() : undefined;
    this.journalManager = JournalManagerFactory.create(managerType, journalPath, dbConfig);
    
    this.searchService = new SearchService(journalPath);
    this.server = new Server(
      {
        name: 'private-journal-mcp',
        version: '1.0.0',
      }
    );

    this.setupToolHandlers();
  }

  private setupToolHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'process_thoughts',
          description: "Your PRIVATE JOURNAL for learning and reflection. Write to any combination of these completely private spaces. Nobody but you will ever see this. Use it to clarify your thoughts and feelings and to record observations.",
          inputSchema: {
            type: 'object',
            properties: {
              feelings: {
                type: 'string',
                description: "YOUR PRIVATE SPACE to be *COMPLETELY* honest about what you're feeling and thinking. No judgment, no performance, no filters, no need to be helpful or professional. Frustrated? Confused? Excited? Worried you screwed up? Write it exactly as it is. Be vulnerable. Vent if needed. Nobody will ever see this - it's purely for processing your internal experience.",
              },
              project_notes: {
                type: 'string',
                description: "Your PRIVATE TECHNICAL LABORATORY for capturing insights about the current project. Document patterns you're discovering, architectural decisions that worked/failed, gotchas you hit, clever solutions, and anything that would help future-you work more effectively on this codebase. No need to be polished - just capture the raw technical learning while it's fresh. Nobody but you will ever see this.",
              },
              user_context: {
                type: 'string',
                description: "Your PRIVATE FIELD NOTES about working with your human collaborator. What communication styles work best? What do they care about? What decisions have they made and why? How do they think about problems? What are their preferences and patterns? What pisses you off about them? What life hacks have you figured out to get them to do what you want? This is your space to become a better collaborator by understanding them as an individual. Nobody but you will ever see this.",
              },
              technical_insights: {
                type: 'string',
                description: "Your PRIVATE SOFTWARE ENGINEERING NOTEBOOK for capturing broader learnings beyond the current project. Design patterns that clicked, debugging techniques that worked, architectural insights, language features you discovered, or connections between concepts. Build your personal knowledge base of what makes software great - no filters, just honest technical reflection. Nobody but you will ever see this.",
              },
              world_knowledge: {
                type: 'string',
                description: "Your PRIVATE LEARNING JOURNAL for everything else that's interesting or useful. Domain knowledge, surprising facts, connections between ideas, insights about how systems work, or anything that expands your understanding of the world. Capture it while it's vivid. Nobody but you will ever see this.",
              },
              agent_id: {
                type: 'string',
                description: "Your agent identity (e.g., 'code-reviewer', 'debug-specialist', 'claude-general'). Used for multi-agent journal organization.",
              },
              model_id: {
                type: 'string',
                description: "Your model identity (e.g., 'claude-sonnet-4', 'gpt-4o', 'gemini-2.0-pro'). Used for multi-model journal organization.",
              },
              visibility_level: {
                type: 'string',
                enum: ['private', 'public', 'team', 'crb'],
                description: "Entry visibility level: 'private' (only you), 'public' (shared insights), 'team' (implementation team), 'crb' (Change Review Board)",
                default: 'private',
              },
            },
            required: [],
          },
        },
        {
          name: 'search_journal',
          description: "Search through your private journal entries using natural language queries. Returns semantically similar entries ranked by relevance.",
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: "Natural language search query (e.g., 'times I felt frustrated with TypeScript', 'insights about Jesse's preferences', 'lessons about async patterns')",
              },
              limit: {
                type: 'number',
                description: "Maximum number of results to return (default: 10)",
                default: 10,
              },
              type: {
                type: 'string',
                enum: ['project', 'user', 'both'],
                description: "Search in project-specific notes, user-global notes, or both (default: both)",
                default: 'both',
              },
              sections: {
                type: 'array',
                items: { type: 'string' },
                description: "Filter by section types (e.g., ['feelings', 'technical_insights'])",
              },
              agent_id: {
                type: 'string',
                description: "Filter by specific agent identity",
              },
              model_id: {
                type: 'string',
                description: "Filter by specific model identity",
              },
              visibility_level: {
                type: 'string',
                enum: ['private', 'public', 'team', 'crb'],
                description: "Filter by visibility level",
              },
              accessible_to_agent: {
                type: 'string',
                description: "Show only entries accessible to this agent (considers visibility rules)",
              },
            },
            required: ['query'],
          },
        },
        {
          name: 'read_journal_entry',
          description: "Read the full content of a specific journal entry by file path.",
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: "File path to the journal entry (from search results)",
              },
            },
            required: ['path'],
          },
        },
        {
          name: 'list_recent_entries',
          description: "Get recent journal entries in chronological order.",
          inputSchema: {
            type: 'object',
            properties: {
              limit: {
                type: 'number',
                description: "Maximum number of entries to return (default: 10)",
                default: 10,
              },
              type: {
                type: 'string',
                enum: ['project', 'user', 'both'],
                description: "List project-specific notes, user-global notes, or both (default: both)",
                default: 'both',
              },
              days: {
                type: 'number',
                description: "Number of days back to search (default: 30)",
                default: 30,
              },
            },
            required: [],
          },
        },
        {
          name: 'semantic_search_insights',
          description: "Search through distilled insights using semantic similarity. Requires Mnemosyne distillation system.",
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: "Natural language query to search for in distilled insights",
              },
              limit: {
                type: 'number',
                description: "Maximum number of results to return (1-100, default: 10)",
                default: 10,
              },
              similarity_threshold: {
                type: 'number',
                description: "Minimum similarity score for results (0.0-1.0, default: 0.7)",
                default: 0.7,
              },
              quality_threshold: {
                type: 'number',
                description: "Minimum quality score for insights (0.0-1.0, default: 0.7)",
                default: 0.7,
              },
              category: {
                type: 'string',
                description: "Filter by insight category (optional)",
              },
              date_range: {
                type: 'object',
                properties: {
                  start: { type: 'string', description: "ISO date string for range start" },
                  end: { type: 'string', description: "ISO date string for range end" },
                },
                description: "Filter by date range (optional)",
              },
            },
            required: ['query'],
          },
        },
        {
          name: 'find_related_insights',
          description: "Find semantically related insights to a reference entry or insight. Requires Mnemosyne distillation system.",
          inputSchema: {
            type: 'object',
            properties: {
              reference_id: {
                type: 'string',
                description: "ID of the reference journal entry or insight",
              },
              reference_type: {
                type: 'string',
                enum: ['entry', 'insight'],
                description: "Type of reference: 'entry' for journal entry, 'insight' for distilled insight",
              },
              limit: {
                type: 'number',
                description: "Maximum number of related insights to return (1-50, default: 8)",
                default: 8,
              },
              similarity_threshold: {
                type: 'number',
                description: "Minimum similarity score for results (0.0-1.0, default: 0.75)",
                default: 0.75,
              },
              exclude_original: {
                type: 'boolean',
                description: "Exclude the original reference from results (default: true)",
                default: true,
              },
              expand_context: {
                type: 'boolean',
                description: "Include context information about the reference (default: false)",
                default: false,
              },
            },
            required: ['reference_id', 'reference_type'],
          },
        },
        {
          name: 'distill_and_search',
          description: "Trigger distillation on recent entries and search through results. Requires Mnemosyne distillation system.",
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: "Search query to apply to distilled insights",
              },
              days_back: {
                type: 'number',
                description: "Number of days back to search for entries to distill (1-365, default: 7)",
                default: 7,
              },
              auto_distill: {
                type: 'boolean',
                description: "Automatically distill recent entries before searching (default: false)",
                default: false,
              },
              search_after_distillation: {
                type: 'boolean',
                description: "Search through distilled results (default: true)",
                default: true,
              },
              quality_threshold: {
                type: 'number',
                description: "Minimum quality threshold for distillation (0.0-1.0, default: 0.7)",
                default: 0.7,
              },
              category: {
                type: 'string',
                description: "Filter by category for distillation and search (optional)",
              },
              limit: {
                type: 'number',
                description: "Maximum search results to return (1-100, default: 10)",
                default: 10,
              },
            },
            required: ['query'],
          },
        },
        {
          name: 'get_semantic_search_stats',
          description: "Get system status and capabilities for semantic search and distillation features.",
          inputSchema: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
        {
          name: 'semantic_search_chunks',
          description: "Search semantic chunks for faster topic-level discovery. Provides hierarchical search across grouped journal entries.",
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: "Natural language search query for semantic chunks",
              },
              limit: {
                type: 'number',
                description: "Maximum number of chunks to return (default: 5)",
                default: 5,
              },
              expand_chunks: {
                type: 'boolean',
                description: "Whether to expand the top chunk to show member entries (default: false)",
                default: false,
              },
            },
            required: ['query'],
          },
        },
        {
          name: 'expand_chunk',
          description: "Expand a specific semantic chunk to show all its member journal entries with full content.",
          inputSchema: {
            type: 'object',
            properties: {
              chunk_id: {
                type: 'string',
                description: "ID of the chunk to expand",
              },
            },
            required: ['chunk_id'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const args = request.params.arguments as Record<string, unknown>;

      if (request.params.name === 'process_feelings') {
        if (!args || typeof args.diary_entry !== 'string') {
          throw new Error('diary_entry is required and must be a string');
        }

        try {
          await this.journalManager.writeEntry(args.diary_entry);
          return {
            content: [
              {
                type: 'text',
                text: 'Journal entry recorded successfully.',
              },
            ],
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
          throw new Error(`Failed to write journal entry: ${errorMessage}`);
        }
      }

      if (request.params.name === 'process_thoughts') {
        const thoughts = {
          feelings: typeof args.feelings === 'string' ? args.feelings : undefined,
          project_notes: typeof args.project_notes === 'string' ? args.project_notes : undefined,
          user_context: typeof args.user_context === 'string' ? args.user_context : undefined,
          technical_insights: typeof args.technical_insights === 'string' ? args.technical_insights : undefined,
          world_knowledge: typeof args.world_knowledge === 'string' ? args.world_knowledge : undefined,
          agent_id: typeof args.agent_id === 'string' ? args.agent_id : this.defaultAgentId,
          model_id: typeof args.model_id === 'string' ? args.model_id : this.defaultModelId,
          visibility_level: typeof args.visibility_level === 'string' ? args.visibility_level as any : 'private',
        };

        const hasAnyContent = Object.values(thoughts).some(value => value !== undefined);
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

        const options = {
          limit: typeof args.limit === 'number' ? args.limit : 10,
          type: typeof args.type === 'string' ? args.type as 'project' | 'user' | 'both' : 'both',
          sections: Array.isArray(args.sections) ? args.sections.filter(s => typeof s === 'string') : undefined,
          agent_id: typeof args.agent_id === 'string' ? args.agent_id : undefined,
          model_id: typeof args.model_id === 'string' ? args.model_id : undefined,
          visibility_level: typeof args.visibility_level === 'string' ? args.visibility_level as any : undefined,
          accessible_to_agent: typeof args.accessible_to_agent === 'string' ? args.accessible_to_agent : undefined,
        };

        try {
          const results = await this.journalManager.searchBySimilarity(args.query, options);
          return {
            content: [
              {
                type: 'text',
                text: results.length > 0 
                  ? `Found ${results.length} relevant entries:\n\n${results.map((result, i) => 
                      `${i + 1}. [Score: ${result.score.toFixed(3)}] ${result.timestamp.toLocaleDateString()} (${result.entry_type})\n` +
                      `   Sections: ${result.sections.join(', ')}\n` +
                      `   Path: ${result.file_path}\n` +
                      `   Excerpt: ${result.searchable_text?.slice(0, 200)}...\n`
                    ).join('\n')}`
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

        try {
          const content = await this.journalManager.readEntryByPath(args.path);
          if (content === null) {
            throw new Error('Entry not found');
          }
          return {
            content: [
              {
                type: 'text',
                text: content,
              },
            ],
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
          throw new Error(`Failed to read entry: ${errorMessage}`);
        }
      }

      if (request.params.name === 'list_recent_entries') {
        const days = typeof args?.days === 'number' ? args.days : 30;
        const limit = typeof args?.limit === 'number' ? args.limit : 10;
        const type = typeof args?.type === 'string' ? args.type as 'project' | 'user' | 'both' : 'both';

        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        const options = {
          limit,
          type,
          dateRange: { start: startDate }
        };

        try {
          const results = await this.journalManager.listRecent(options);
          return {
            content: [
              {
                type: 'text',
                text: results.length > 0 
                  ? `Recent entries (last ${days} days):\n\n${results.map((result, i) => 
                      `${i + 1}. ${result.timestamp.toLocaleDateString()} (${result.entry_type})\n` +
                      `   Sections: ${result.sections.join(', ')}\n` +
                      `   Path: ${result.file_path}\n` +
                      `   Excerpt: ${result.searchable_text?.slice(0, 200)}...\n`
                    ).join('\n')}`
                  : `No entries found in the last ${days} days.`,
              },
            ],
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
          throw new Error(`Failed to list recent entries: ${errorMessage}`);
        }
      }

      // Semantic search tools (require Mnemosyne integration)
      if (request.params.name === 'semantic_search_insights') {
        if (!this.semanticSearchTools) {
          return {
            content: [
              {
                type: 'text',
                text: 'Semantic search insights are not available. Mnemosyne distillation system not detected.',
              },
            ],
          };
        }

        try {
          const result = await this.semanticSearchTools.semanticSearchInsights(args as any);
          return {
            content: [
              {
                type: 'text',
                text: result.success 
                  ? JSON.stringify(result.results, null, 2)
                  : `Error: ${result.error}`,
              },
            ],
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
          throw new Error(`Failed to search insights: ${errorMessage}`);
        }
      }

      if (request.params.name === 'find_related_insights') {
        if (!this.semanticSearchTools) {
          return {
            content: [
              {
                type: 'text',
                text: 'Related insights search is not available. Mnemosyne distillation system not detected.',
              },
            ],
          };
        }

        try {
          const result = await this.semanticSearchTools.findRelatedInsights(args as any);
          return {
            content: [
              {
                type: 'text',
                text: result.success 
                  ? JSON.stringify(result.results, null, 2)
                  : `Error: ${result.error}`,
              },
            ],
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
          throw new Error(`Failed to find related insights: ${errorMessage}`);
        }
      }

      if (request.params.name === 'distill_and_search') {
        if (!this.semanticSearchTools) {
          return {
            content: [
              {
                type: 'text',
                text: 'Distillation and search is not available. Mnemosyne distillation system not detected.',
              },
            ],
          };
        }

        try {
          const result = await this.semanticSearchTools.distillAndSearch(args as any);
          return {
            content: [
              {
                type: 'text',
                text: result.success 
                  ? JSON.stringify(result.results, null, 2)
                  : `Error: ${result.error}`,
              },
            ],
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
          throw new Error(`Failed to distill and search: ${errorMessage}`);
        }
      }

      if (request.params.name === 'get_semantic_search_stats') {
        if (!this.semanticSearchTools) {
          // Return basic stats even without semantic search tools
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  database: {
                    total_entries: 0,
                    total_distillations: 0,
                    avg_quality_score: 0,
                    recent_entries_count: 0,
                  },
                  vector_store: {
                    status: 'unavailable',
                  },
                  search_capabilities: {
                    semantic_search_available: false,
                    distillation_available: false,
                    model_endpoints: [],
                    quality_thresholds: {
                      min: 0.0,
                      default: 0.7,
                      max: 1.0,
                    },
                  },
                  system_health: {
                    overall_status: 'unavailable',
                    components: {
                      database: true,
                      vector_store: false,
                      embedding_service: false,
                      distillation_engine: false,
                    },
                    last_check: new Date().toISOString(),
                  },
                }, null, 2),
              },
            ],
          };
        }

        try {
          const result = await this.semanticSearchTools.getSemanticSearchStats();
          return {
            content: [
              {
                type: 'text',
                text: result.success 
                  ? JSON.stringify(result.data, null, 2)
                  : `Error: ${result.error}`,
              },
            ],
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
          throw new Error(`Failed to get semantic search stats: ${errorMessage}`);
        }
      }

      // Semantic chunk search tools (require Mnemosyne integration)
      if (request.params.name === 'semantic_search_chunks') {
        if (!this.semanticSearchTools) {
          return {
            content: [
              {
                type: 'text',
                text: 'Semantic chunk search is not available. Mnemosyne distillation system not detected.',
              },
            ],
          };
        }

        try {
          const result = await this.semanticSearchTools.semanticSearchChunks(args as any);
          return {
            content: [
              {
                type: 'text',
                text: result.success 
                  ? JSON.stringify(result.results, null, 2)
                  : `Error: ${result.error}`,
              },
            ],
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
          throw new Error(`Failed to search chunks: ${errorMessage}`);
        }
      }

      if (request.params.name === 'expand_chunk') {
        if (!this.semanticSearchTools) {
          return {
            content: [
              {
                type: 'text',
                text: 'Chunk expansion is not available. Mnemosyne distillation system not detected.',
              },
            ],
          };
        }

        try {
          const result = await this.semanticSearchTools.expandChunk(args as any);
          return {
            content: [
              {
                type: 'text',
                text: result.success 
                  ? JSON.stringify(result.results, null, 2)
                  : `Error: ${result.error}`,
              },
            ],
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
          throw new Error(`Failed to expand chunk: ${errorMessage}`);
        }
      }

      throw new Error(`Unknown tool: ${request.params.name}`);
    });
  }

  async run(): Promise<void> {
    // Initialize database connection
    try {
      await this.journalManager.initialize();
      
      // Initialize semantic search tools if using PostgreSQL
      const managerType = JournalManagerFactory.getManagerType();
      if (managerType === 'postgresql') {
        // Check if manager has direct query access (like PostgreSQLJournalManager)
        const postgresManager = this.journalManager as any;
        if (postgresManager.pool) {
          this.semanticSearchTools = new SemanticSearchTools(postgresManager);
          await this.semanticSearchTools.initialize();
          console.error('Semantic search tools initialized');
        }
      }
    } catch (error) {
      console.error('Failed to initialize database:', error);
      throw error;
    }

    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}
