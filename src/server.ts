// ABOUTME: MCP server implementation with process_feelings tool and enhanced semantic search
// ABOUTME: Handles stdio protocol communication and tool registration

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { ProcessFeelingsRequest, ProcessThoughtsRequest } from './types';
import {
  validateSemanticSearchParams,
  transformFromSemanticSearchParams,
  hasProjectAwareParams,
  normalizeSearchResponse,
  toSearchInsightsRequest,
} from './parameter-transformation';
import { SearchService } from './search';
import { ProjectAwareSearchService } from './project-aware-search';
import { JournalManagerFactory, JournalManagerInterface } from './journal-manager-factory';
import { createDatabaseConfig } from './database-config';
import { SemanticSearchTools } from './semantic-search-tools';

export class PrivateJournalServer {
  private server: Server;
  private journalManager: JournalManagerInterface;
  private searchService: SearchService;
  private projectAwareSearch: ProjectAwareSearchService;
  private semanticSearchTools: SemanticSearchTools | null = null;
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

    this.searchService = new SearchService(journalPath);
    this.projectAwareSearch = new ProjectAwareSearchService(journalPath);
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
              // Project context filtering options
              project_filter: {
                oneOf: [
                  { type: 'string', enum: ['current', 'all'] },
                  { type: 'string' },
                  { type: 'array', items: { type: 'string' } },
                ],
                description:
                  "Filter by project context: 'current' (auto-detect), 'all', specific project name(s)",
              },
              language_filter: {
                type: 'string',
                description: 'Filter by primary programming language',
              },
              exclude_current: {
                type: 'boolean',
                description: 'Exclude current project from results (default: false)',
                default: false,
              },
              min_relevance: {
                type: 'number',
                description:
                  'Minimum relevance score for cross-project results (0.0-1.0, default: 0.6)',
                default: 0.6,
                minimum: 0.0,
                maximum: 1.0,
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
            },
            required: [],
          },
        },
        {
          name: 'semantic_search_insights',
          description:
            'Search through distilled insights using semantic similarity. Requires Mnemosyne distillation system.',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Natural language query to search for in distilled insights',
              },
              limit: {
                type: 'number',
                description: 'Maximum number of results to return (1-100, default: 10)',
                default: 10,
              },
              similarity_threshold: {
                type: 'number',
                description: 'Minimum similarity score for results (0.0-1.0, default: 0.7)',
                default: 0.7,
              },
              quality_threshold: {
                type: 'number',
                description: 'Minimum quality score for insights (0.0-1.0, default: 0.7)',
                default: 0.7,
              },
              category: {
                type: 'string',
                description: 'Filter by insight category (optional)',
              },
              date_range: {
                type: 'object',
                properties: {
                  start: { type: 'string', description: 'ISO date string for range start' },
                  end: { type: 'string', description: 'ISO date string for range end' },
                },
                description: 'Filter by date range (optional)',
              },
              // Extended parameters for search_journal compatibility (Priority 0)
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
                oneOf: [
                  { type: 'string', enum: ['current', 'all'] },
                  { type: 'string' },
                  { type: 'array', items: { type: 'string' } },
                ],
                description:
                  "Filter by project context: 'current' (auto-detect), 'all', specific project name(s)",
              },
              // Additional project-aware parameters
              language_filter: {
                type: 'string',
                description: 'Filter by primary programming language',
              },
              exclude_current: {
                type: 'boolean',
                description: 'Exclude current project from results (default: false)',
                default: false,
              },
              min_relevance: {
                type: 'number',
                description:
                  'Minimum relevance score for cross-project results (0.0-1.0, default: 0.6)',
                default: 0.6,
                minimum: 0.0,
                maximum: 1.0,
              },
            },
            required: ['query'],
          },
        },
        {
          name: 'find_related_insights',
          description:
            'Find semantically related insights to a reference entry or insight. Requires Mnemosyne distillation system.',
          inputSchema: {
            type: 'object',
            properties: {
              reference_id: {
                type: 'string',
                description: 'ID of the reference journal entry or insight',
              },
              reference_type: {
                type: 'string',
                enum: ['entry', 'insight'],
                description:
                  "Type of reference: 'entry' for journal entry, 'insight' for distilled insight",
              },
              limit: {
                type: 'number',
                description: 'Maximum number of related insights to return (1-50, default: 8)',
                default: 8,
              },
              similarity_threshold: {
                type: 'number',
                description: 'Minimum similarity score for results (0.0-1.0, default: 0.75)',
                default: 0.75,
              },
              exclude_original: {
                type: 'boolean',
                description: 'Exclude the original reference from results (default: true)',
                default: true,
              },
              expand_context: {
                type: 'boolean',
                description: 'Include context information about the reference (default: false)',
                default: false,
              },
            },
            required: ['reference_id', 'reference_type'],
          },
        },
        {
          name: 'distill_and_search',
          description:
            'Trigger distillation on recent entries and search through results. Requires Mnemosyne distillation system.',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Search query to apply to distilled insights',
              },
              days_back: {
                type: 'number',
                description:
                  'Number of days back to search for entries to distill (1-365, default: 7)',
                default: 7,
              },
              auto_distill: {
                type: 'boolean',
                description:
                  'Automatically distill recent entries before searching (default: false)',
                default: false,
              },
              search_after_distillation: {
                type: 'boolean',
                description: 'Search through distilled results (default: true)',
                default: true,
              },
              quality_threshold: {
                type: 'number',
                description: 'Minimum quality threshold for distillation (0.0-1.0, default: 0.7)',
                default: 0.7,
              },
              category: {
                type: 'string',
                description: 'Filter by category for distillation and search (optional)',
              },
              limit: {
                type: 'number',
                description: 'Maximum search results to return (1-100, default: 10)',
                default: 10,
              },
            },
            required: ['query'],
          },
        },
        {
          name: 'get_semantic_search_stats',
          description:
            'Get system status and capabilities for semantic search and distillation features.',
          inputSchema: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
        {
          name: 'semantic_search_chunks',
          description:
            'Search semantic chunks for faster topic-level discovery. Provides hierarchical search across grouped journal entries.',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Natural language search query for semantic chunks',
              },
              limit: {
                type: 'number',
                description: 'Maximum number of chunks to return (default: 5)',
                default: 5,
              },
              expand_chunks: {
                type: 'boolean',
                description:
                  'Whether to expand the top chunk to show member entries (default: false)',
                default: false,
              },
            },
            required: ['query'],
          },
        },
        {
          name: 'expand_chunk',
          description:
            'Expand a specific semantic chunk to show all its member journal entries with full content.',
          inputSchema: {
            type: 'object',
            properties: {
              chunk_id: {
                type: 'string',
                description: 'ID of the chunk to expand',
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
          // New project-aware options
          project_filter:
            typeof args.project_filter === 'string'
              ? args.project_filter
              : Array.isArray(args.project_filter)
                ? args.project_filter
                : undefined,
          language_filter:
            typeof args.language_filter === 'string' ? args.language_filter : undefined,
          exclude_current: typeof args.exclude_current === 'boolean' ? args.exclude_current : false,
          min_relevance: typeof args.min_relevance === 'number' ? args.min_relevance : 0.6,
        };

        try {
          // Use project-aware search if any project-specific options are provided
          const useProjectAwareSearch =
            options.project_filter !== undefined ||
            options.language_filter !== undefined ||
            options.exclude_current ||
            options.min_relevance !== 0.6;

          if (useProjectAwareSearch) {
            const rawResults = await this.projectAwareSearch.search(args.query, options);
            const results = normalizeSearchResponse(rawResults);
            return {
              content: [
                {
                  type: 'text',
                  text:
                    results.length > 0
                      ? `Found ${results.length} relevant entries:\n\n${results
                          .map((result, i) => {
                            const contextWarning = result.cross_project_warning
                              ? ` ⚠️  [${result.project_name || 'other project'}]`
                              : '';
                            const contextMatch =
                              result.context_match < 0.8
                                ? ` (context: ${(result.context_match * 100).toFixed(0)}%)`
                                : '';

                            const timestampDisplay = result.timestamp
                              ? typeof result.timestamp === 'number'
                                ? new Date(result.timestamp).toLocaleDateString()
                                : new Date(result.timestamp).toLocaleDateString()
                              : 'Unknown date';
                            return (
                              `${i + 1}. [Score: ${result.score.toFixed(3)}${contextMatch}]${contextWarning} ${timestampDisplay} (${result.type})\n` +
                              `   Sections: ${result.sections.join(', ')}\n` +
                              `   Path: ${result.path}\n` +
                              `   Excerpt: ${result.excerpt}...\n`
                            );
                          })
                          .join('\n')}`
                      : 'No relevant entries found.',
                },
              ],
            };
          } else {
            // Fall back to traditional search for backwards compatibility
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
          }
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
        const type =
          typeof args?.type === 'string' ? (args.type as 'project' | 'user' | 'both') : 'both';

        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        const options = {
          limit,
          type,
          dateRange: { start: startDate },
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

      // Semantic search tools (require Mnemosyne integration)
      if (request.params.name === 'semantic_search_insights') {
        // Validate parameters first with enhanced error messaging
        const validation = validateSemanticSearchParams(args);
        if (!validation.isValid) {
          const parameterErrors = validation.errors.map((error) => `• ${error}`).join('\n');
          throw new Error(
            `Parameter validation failed:\n${parameterErrors}\n\n` +
              `Tip: Most search_journal parameters are supported in semantic_search_insights. ` +
              `Check parameter names and value formats match the tool schema.`
          );
        }

        const params = validation.sanitized!;

        // Check if Mnemosyne semantic search tools are available
        if (!this.semanticSearchTools) {
          // Detect semantic-specific parameters that won't work in fallback
          const semanticOnlyParams = [];
          if (params.similarity_threshold !== undefined && params.similarity_threshold !== 0.7) {
            semanticOnlyParams.push(`similarity_threshold: ${params.similarity_threshold}`);
          }
          if (params.quality_threshold !== undefined && params.quality_threshold !== 0.7) {
            semanticOnlyParams.push(`quality_threshold: ${params.quality_threshold}`);
          }
          if (params.category !== undefined) {
            semanticOnlyParams.push(`category: ${params.category}`);
          }

          // Warn about semantic-specific parameters that will be ignored
          let compatibilityWarning = '';
          if (semanticOnlyParams.length > 0) {
            compatibilityWarning =
              `\n\n⚠️  COMPATIBILITY NOTE: The following semantic search parameters will be ignored in fallback mode:\n` +
              semanticOnlyParams.map((param) => `• ${param}`).join('\n') +
              `\n\nTo use these parameters, enable the Mnemosyne distillation system with PostgreSQL database.`;
          }

          // Fall back to using search_journal logic with semantic parameters
          try {
            const searchOptions = transformFromSemanticSearchParams(params);

            // Use project-aware search if any project-specific options are provided
            const useProjectAwareSearch = hasProjectAwareParams(params);

            if (useProjectAwareSearch) {
              const rawResults = await this.projectAwareSearch.search(params.query, searchOptions);
              const results = normalizeSearchResponse(rawResults);
              return {
                content: [
                  {
                    type: 'text',
                    text:
                      `🔄 FALLBACK MODE: Using search_journal compatibility layer (Mnemosyne distillation system not available)${compatibilityWarning}\n\n` +
                      (results.length > 0
                        ? `Found ${results.length} relevant entries:\n\n${results
                            .map((result, i) => {
                              const contextWarning = result.cross_project_warning
                                ? ` ⚠️  [${result.project_name || 'other project'}]`
                                : '';
                              const contextMatch =
                                result.context_match < 0.8
                                  ? ` (context: ${(result.context_match * 100).toFixed(0)}%)`
                                  : '';

                              const timestampDisplay = result.timestamp
                                ? typeof result.timestamp === 'number'
                                  ? new Date(result.timestamp).toLocaleDateString()
                                  : new Date(result.timestamp).toLocaleDateString()
                                : 'Unknown date';
                              return (
                                `${i + 1}. [Score: ${result.score.toFixed(3)}${contextMatch}]${contextWarning} ${timestampDisplay} (${result.type})\n` +
                                `   Sections: ${result.sections.join(', ')}\n` +
                                `   Path: ${result.path}\n` +
                                `   Excerpt: ${result.excerpt}...\n`
                              );
                            })
                            .join('\n')}`
                        : 'No relevant entries found.'),
                  },
                ],
              };
            } else {
              // Fall back to traditional search
              const rawResults = await this.journalManager.searchBySimilarity(
                params.query,
                searchOptions
              );
              const results = normalizeSearchResponse(rawResults);
              return {
                content: [
                  {
                    type: 'text',
                    text:
                      `🔄 FALLBACK MODE: Using search_journal compatibility layer (Mnemosyne distillation system not available)${compatibilityWarning}\n\n` +
                      (results.length > 0
                        ? `Found ${results.length} relevant entries:\n\n${results
                            .map(
                              (result, i) =>
                                `${i + 1}. [Score: ${result.score.toFixed(3)}] ${result.timestamp.toLocaleDateString()} (${result.type})\n` +
                                `   Sections: ${result.sections.join(', ')}\n` +
                                `   Path: ${result.path}\n` +
                                `   Excerpt: ${result.excerpt}...\n`
                            )
                            .join('\n')}`
                        : 'No relevant entries found.'),
                  },
                ],
              };
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';

            // Provide specific guidance based on error type
            let troubleshootingGuidance = '';
            if (errorMessage.includes('ENOENT') || errorMessage.includes('not found')) {
              troubleshootingGuidance =
                '\n\nTROUBLESHOOTING:\n' +
                '• Check that journal entries exist in the expected directories\n' +
                '• Verify file permissions for journal storage paths\n' +
                '• Try using search_journal tool directly to test basic search functionality';
            } else if (errorMessage.includes('embedding') || errorMessage.includes('model')) {
              troubleshootingGuidance =
                '\n\nTROUBLESHOOTING:\n' +
                '• Ensure embedding models are properly installed and accessible\n' +
                '• Check network connectivity if using remote embedding services\n' +
                '• Verify that search indexing has completed for existing entries';
            } else if (errorMessage.includes('database') || errorMessage.includes('connection')) {
              troubleshootingGuidance =
                '\n\nTROUBLESHOOTING:\n' +
                '• Check database connection configuration\n' +
                '• Verify that database migrations have been run\n' +
                '• Ensure database service is running and accessible';
            } else {
              troubleshootingGuidance =
                '\n\nTROUBLESHOOTING:\n' +
                '• Try using search_journal tool directly to isolate the issue\n' +
                '• Check that the query is well-formed and not empty\n' +
                '• Verify that search parameters are within valid ranges';
            }

            throw new Error(
              `Compatibility layer failed: ${errorMessage}${troubleshootingGuidance}\n\n` +
                `FALLBACK OPTIONS:\n` +
                `• Use search_journal tool directly with compatible parameters\n` +
                `• Enable Mnemosyne distillation system for full semantic search capabilities\n` +
                `• Check get_semantic_search_stats for system status information`
            );
          }
        }

        // Use Mnemosyne semantic search tools when available
        try {
          const searchRequest = toSearchInsightsRequest(params);
          const result = await this.semanticSearchTools.semanticSearchInsights(searchRequest);
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

          // Provide guidance for Mnemosyne-specific errors
          let mnemosyneGuidance = '';
          if (errorMessage.includes('distillation') || errorMessage.includes('insights')) {
            mnemosyneGuidance =
              '\n\nMNEMOSYNE TROUBLESHOOTING:\n' +
              '• Run distill_and_search to generate insights from recent entries\n' +
              '• Check that quality_threshold and similarity_threshold are appropriate\n' +
              '• Verify that the distillation system has processed recent journal entries';
          } else if (errorMessage.includes('vector') || errorMessage.includes('embedding')) {
            mnemosyneGuidance =
              '\n\nVECTOR STORE TROUBLESHOOTING:\n' +
              '• Ensure vector database is properly configured and running\n' +
              '• Check that embeddings have been generated for journal content\n' +
              '• Verify vector store indexing is complete and up-to-date';
          } else {
            mnemosyneGuidance =
              '\n\nGENERAL TROUBLESHOOTING:\n' +
              '• Check get_semantic_search_stats for detailed system status\n' +
              '• Verify Mnemosyne distillation system configuration\n' +
              '• Try using search_journal as a fallback option';
          }

          throw new Error(
            `Semantic search failed: ${errorMessage}${mnemosyneGuidance}\n\n` +
              `AVAILABLE ALTERNATIVES:\n` +
              `• Use search_journal for basic semantic search without distillation\n` +
              `• Check get_semantic_search_stats to diagnose system issues\n` +
              `• Use distill_and_search to generate insights and search simultaneously`
          );
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
                text: JSON.stringify(
                  {
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
                  },
                  null,
                  2
                ),
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
