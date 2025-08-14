// ABOUTME: Semantic search MCP tools integration for Mnemosyne AI Memory Distillation
// ABOUTME: Provides enhanced semantic search capabilities for journal entries and distilled insights

// Type definitions for the enhanced MCP tools
export interface MCPToolResult {
  success: boolean;
  data?: any;
  error?: string;
  metadata?: Record<string, any>;
}

export interface DistilledInsight {
  id: string;
  title: string;
  summary: string;
  key_insights: string[];
  action_items?: string[];
  category: string;
  quality_score: number;
  similarity_score?: number;
  source_entry_id: string;
  timestamp: string;
  tags?: string[];
}

export interface SearchInsightsRequest {
  query: string;
  limit?: number;
  similarity_threshold?: number;
  category?: string;
  quality_threshold?: number;
  date_range?: {
    start: string;
    end: string;
  };
  search_mode?: 'insights_only' | 'hybrid' | 'entries_only';
}

export interface SearchInsightsResponse {
  success: boolean;
  results?: {
    insights: DistilledInsight[];
    raw_entries?: any[];
    metadata: {
      total_insights: number;
      avg_quality_score: number;
      avg_similarity_score: number;
      search_duration_ms: number;
      search_mode: string;
    };
  };
  error?: string;
}

export interface FindRelatedRequest {
  reference_id: string;
  reference_type: 'entry' | 'insight';
  limit?: number;
  similarity_threshold?: number;
  exclude_original?: boolean;
  expand_context?: boolean;
}

export interface FindRelatedResponse {
  success: boolean;
  results?: {
    related_insights: DistilledInsight[];
    reference_context?: {
      title: string;
      summary: string;
      category: string;
    };
    metadata: {
      reference_id: string;
      total_related: number;
      avg_similarity: number;
      search_duration_ms: number;
    };
  };
  error?: string;
}

export interface DistillAndSearchRequest {
  query: string;
  days_back?: number;
  auto_distill?: boolean;
  search_after_distillation?: boolean;
  quality_threshold?: number;
  category?: string;
  batch_size?: number;
  limit?: number;
  similarity_threshold?: number;
}

export interface DistillAndSearchResponse {
  success: boolean;
  results?: {
    distillation_stats: {
      entries_processed: number;
      insights_created: number;
      avg_quality: number;
      processing_time_ms: number;
      quality_filtered?: number;
      message?: string;
    };
    search_results: DistilledInsight[];
    metadata?: {
      search_duration_ms: number;
      total_found: number;
      avg_similarity_score: number;
    };
  };
  error?: string;
}

export interface SemanticSearchStatsResponse {
  success: boolean;
  data?: {
    database: {
      total_entries: number;
      total_distillations: number;
      avg_quality_score: number;
      recent_entries_count: number;
    };
    vector_store: {
      status: 'healthy' | 'unavailable' | 'degraded';
      collection_name?: string;
      total_documents?: number;
      embedding_model?: string;
      last_updated?: string;
    };
    search_capabilities: {
      semantic_search_available: boolean;
      distillation_available: boolean;
      model_endpoints: string[];
      quality_thresholds: {
        min: number;
        default: number;
        max: number;
      };
    };
    system_health: {
      overall_status: 'healthy' | 'degraded' | 'unavailable';
      components: {
        database: boolean;
        vector_store: boolean;
        embedding_service: boolean;
        distillation_engine: boolean;
      };
      last_check: string;
    };
  };
  error?: string;
}

// =====================================================
// CHUNK SEARCH INTERFACES
// =====================================================

export interface ChunkSearchRequest {
  query: string;
  limit?: number;
  expand_chunks?: boolean;
}

export interface SemanticChunk {
  chunk_id: string;
  summary: string;
  member_count: number;
  member_ids: string[];
  agents: string[];
  date_range: string;
  similarity_score: number;
}

export interface ChunkSearchResponse {
  success: boolean;
  results?: {
    chunks: SemanticChunk[];
    expanded_entries?: any[];
    metadata: {
      total_chunks: number;
      avg_similarity_score: number;
      search_duration_ms: number;
      compression_ratio: string;
    };
  };
  error?: string;
}

// =====================================================
// CHUNK EXPANSION INTERFACES
// =====================================================

export interface ChunkExpansionRequest {
  chunk_id: string;
}

export interface ChunkExpansionResponse {
  success: boolean;
  results?: {
    chunk_info: SemanticChunk;
    entries: any[];
    metadata: {
      chunk_id: string;
      entry_count: number;
      expansion_duration_ms: number;
    };
  };
  error?: string;
}

/**
 * Semantic Search Tools Integration
 * 
 * This class provides integration points for the Mnemosyne semantic search tools
 * without requiring the full Mnemosyne infrastructure to be available.
 * It gracefully degrades to traditional search when semantic capabilities are unavailable.
 */
export class SemanticSearchTools {
  private dbManager: any;
  private isInitialized = false;
  private mnemosyneAvailable = false;

  constructor(dbManager: any) {
    this.dbManager = dbManager;
  }

  /**
   * Adapter method to handle different database manager types
   */
  private async query(sql: string, params: any[] = []): Promise<{ rows: any[] }> {
    // If dbManager has a direct query method (like DatabaseManager)
    if (this.dbManager.query) {
      return await this.dbManager.query(sql, params);
    }
    
    // If dbManager has a pool (like PostgreSQLJournalManager)
    if (this.dbManager.pool) {
      const client = await this.dbManager.pool.connect();
      try {
        const result = await client.query(sql, params);
        return { rows: result.rows };
      } finally {
        client.release();
      }
    }
    
    throw new Error('No suitable query method available on database manager');
  }

  async initialize(): Promise<void> {
    try {
      // Check if Mnemosyne tables exist
      const result = await this.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'ai_memory' 
          AND table_name = 'distillations'
        ) as distillations_exist
      `);
      
      this.mnemosyneAvailable = result.rows[0]?.distillations_exist || false;
      this.isInitialized = true;
    } catch (error) {
      console.warn('Could not check Mnemosyne availability:', error);
      this.mnemosyneAvailable = false;
      this.isInitialized = true;
    }
  }

  /**
   * MCP Tool: mcp__semantic_search_insights
   * Search through distilled insights using semantic similarity
   */
  async semanticSearchInsights(request: SearchInsightsRequest): Promise<SearchInsightsResponse> {
    const startTime = Date.now();

    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      if (!this.mnemosyneAvailable) {
        return {
          success: false,
          error: 'Semantic search insights are not available. Mnemosyne distillation system not detected.',
        };
      }

      // Validate input
      const validationErrors = this.validateSearchInsightsRequest(request);
      if (validationErrors.length > 0) {
        return {
          success: false,
          error: `Validation failed: ${validationErrors.join(', ')}`,
        };
      }

      // Apply defaults
      const searchParams = {
        query: request.query,
        limit: request.limit || 10,
        similarity_threshold: request.similarity_threshold || 0.7,
        quality_threshold: request.quality_threshold || 0.7,
        search_mode: request.search_mode || 'insights_only',
        category: request.category,
        date_range: request.date_range,
      };

      // Build SQL query for distillations
      const whereConditions: string[] = [];
      const params: any[] = [];
      let paramIndex = 1;

      // Quality threshold filter
      whereConditions.push(`overall_quality >= $${paramIndex}`);
      params.push(searchParams.quality_threshold);
      paramIndex++;

      // Category filter
      if (searchParams.category) {
        whereConditions.push(`category = $${paramIndex}`);
        params.push(searchParams.category);
        paramIndex++;
      }

      // Date range filter
      if (searchParams.date_range) {
        whereConditions.push(`created_at >= $${paramIndex} AND created_at <= $${paramIndex + 1}`);
        params.push(searchParams.date_range.start, searchParams.date_range.end);
        paramIndex += 2;
      }

      const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

      // Use traditional text search (fallback approach)
      const query = `
        SELECT * FROM ai_memory.distillations 
        WHERE (title ILIKE $1 OR summary ILIKE $1 OR key_insights::text ILIKE $1) 
        ${whereClause ? whereClause.replace('WHERE', 'AND') : ''}
        ORDER BY overall_quality DESC, created_at DESC
        LIMIT $${params.length + 1}
      `;

      const queryParams = [`%${searchParams.query}%`, ...params, searchParams.limit];
      const result = await this.query(query, queryParams);

      const insights = result.rows.map((row: any) => this.convertToDistilledInsight(row));

      // Calculate metrics
      const avgQualityScore = insights.length > 0
        ? insights.reduce((sum: number, insight: DistilledInsight) => sum + insight.quality_score, 0) / insights.length
        : 0;

      const searchDuration = Date.now() - startTime;

      return {
        success: true,
        results: {
          insights,
          metadata: {
            total_insights: insights.length,
            avg_quality_score: avgQualityScore,
            avg_similarity_score: 0, // Not available in fallback mode
            search_duration_ms: searchDuration,
            search_mode: searchParams.search_mode,
          },
        },
      };
    } catch (error) {
      const searchDuration = Date.now() - startTime;
      return {
        success: false,
        error: `Semantic search is temporarily unavailable: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * MCP Tool: mcp__find_related_insights
   */
  async findRelatedInsights(request: FindRelatedRequest): Promise<FindRelatedResponse> {
    const startTime = Date.now();

    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      if (!this.mnemosyneAvailable) {
        return {
          success: false,
          error: 'Related insights search is not available. Mnemosyne distillation system not detected.',
        };
      }

      // Validate input
      const validationErrors = this.validateFindRelatedRequest(request);
      if (validationErrors.length > 0) {
        return {
          success: false,
          error: `Validation failed: ${validationErrors.join(', ')}`,
        };
      }

      // Apply defaults
      const searchParams = {
        reference_id: request.reference_id,
        reference_type: request.reference_type,
        limit: request.limit || 8,
        similarity_threshold: request.similarity_threshold || 0.75,
        exclude_original: request.exclude_original ?? true,
        expand_context: request.expand_context || false,
      };

      let referenceContent = '';
      let referenceContext: { title: string; summary: string; category: string } | undefined;

      // Resolve reference content based on type
      if (searchParams.reference_type === 'entry') {
        const entryResult = await this.query(
          'SELECT content, category FROM ai_memory.journal_entries WHERE id = $1',
          [searchParams.reference_id]
        );

        if (entryResult.rows.length === 0) {
          return {
            success: false,
            error: `Journal entry not found: ${searchParams.reference_id}`,
          };
        }

        referenceContent = entryResult.rows[0].content;
        referenceContext = {
          title: 'Journal Entry',
          summary: referenceContent.substring(0, 200) + (referenceContent.length > 200 ? '...' : ''),
          category: entryResult.rows[0].category || 'uncategorized',
        };
      } else if (searchParams.reference_type === 'insight') {
        const insightResult = await this.query(
          'SELECT title, summary, category, key_insights FROM ai_memory.distillations WHERE id = $1',
          [searchParams.reference_id]
        );

        if (insightResult.rows.length === 0) {
          return {
            success: false,
            error: `Distilled insight not found: ${searchParams.reference_id}`,
          };
        }

        const insight = insightResult.rows[0];
        referenceContent = `${insight.title}\n${insight.summary}\n${insight.key_insights.join('\n')}`;
        referenceContext = {
          title: insight.title,
          summary: insight.summary,
          category: insight.category,
        };
      }

      // Use traditional search to find related insights
      const fallbackQuery = `
        SELECT * FROM ai_memory.distillations 
        WHERE (title ILIKE $1 OR summary ILIKE $1 OR key_insights::text ILIKE $1) 
        AND overall_quality >= 0.7
        ORDER BY overall_quality DESC, created_at DESC
        LIMIT $2
      `;

      const queryParams = [`%${referenceContent.substring(0, 100)}%`, searchParams.limit + 1]; // Get extra for exclusion
      const result = await this.query(fallbackQuery, queryParams);

      let insights = result.rows.map((row: any) => this.convertToDistilledInsight(row));

      // Exclude original reference if requested
      if (searchParams.exclude_original) {
        if (searchParams.reference_type === 'insight') {
          insights = insights.filter((insight: DistilledInsight) => insight.id !== searchParams.reference_id);
        } else {
          insights = insights.filter((insight: DistilledInsight) => insight.source_entry_id !== searchParams.reference_id);
        }
      }

      // Apply final limit
      insights = insights.slice(0, searchParams.limit);

      const searchDuration = Date.now() - startTime;

      return {
        success: true,
        results: {
          related_insights: insights,
          reference_context: searchParams.expand_context ? referenceContext : undefined,
          metadata: {
            reference_id: searchParams.reference_id,
            total_related: insights.length,
            avg_similarity: 0, // Not available in fallback mode
            search_duration_ms: searchDuration,
          },
        },
      };
    } catch (error) {
      const searchDuration = Date.now() - startTime;
      return {
        success: false,
        error: `Related insights search is temporarily unavailable: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * MCP Tool: mcp__distill_and_search
   */
  async distillAndSearch(request: DistillAndSearchRequest): Promise<DistillAndSearchResponse> {
    const startTime = Date.now();

    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      if (!this.mnemosyneAvailable) {
        return {
          success: false,
          error: 'Distillation and search is not available. Mnemosyne distillation system not detected.',
        };
      }

      // Validate input
      const validationErrors = this.validateDistillAndSearchRequest(request);
      if (validationErrors.length > 0) {
        return {
          success: false,
          error: `Validation failed: ${validationErrors.join(', ')}`,
        };
      }

      // Apply defaults
      const searchParams = {
        query: request.query,
        days_back: request.days_back || 7,
        auto_distill: request.auto_distill ?? false, // Disabled by default since distillation engine not available
        search_after_distillation: request.search_after_distillation ?? true,
        quality_threshold: request.quality_threshold || 0.7,
        category: request.category,
        batch_size: request.batch_size || 20,
        limit: request.limit || 10,
        similarity_threshold: request.similarity_threshold || 0.7,
      };

      // For now, just search existing distillations without auto-distilling
      const searchResult = await this.semanticSearchInsights({
        query: searchParams.query,
        limit: searchParams.limit,
        similarity_threshold: searchParams.similarity_threshold,
        quality_threshold: searchParams.quality_threshold,
        category: searchParams.category,
      });

      const processingTime = Date.now() - startTime;

      if (!searchResult.success) {
        return {
          success: false,
          error: searchResult.error,
        };
      }

      return {
        success: true,
        results: {
          distillation_stats: {
            entries_processed: 0,
            insights_created: 0,
            avg_quality: 0,
            processing_time_ms: processingTime,
            quality_filtered: 0,
            message: 'Auto-distillation not available. Searched existing insights only.',
          },
          search_results: searchResult.results?.insights || [],
          metadata: {
            search_duration_ms: searchResult.results?.metadata.search_duration_ms || 0,
            total_found: searchResult.results?.insights.length || 0,
            avg_similarity_score: searchResult.results?.metadata.avg_similarity_score || 0,
          },
        },
      };
    } catch (error) {
      const searchDuration = Date.now() - startTime;
      return {
        success: false,
        error: `Distillation and search is temporarily unavailable: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * MCP Tool: mcp__get_semantic_search_stats
   */
  async getSemanticSearchStats(): Promise<SemanticSearchStatsResponse> {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      // Get database statistics
      const dbStats = await this.getDatabaseStats();
      
      // Check vector store status by connecting to ChromaDB
      const vectorStoreStatus = await this.checkVectorStoreHealth();

      // Define search capabilities based on actual availability
      const searchCapabilities = {
        semantic_search_available: vectorStoreStatus.status === 'healthy',
        distillation_available: this.mnemosyneAvailable,
        model_endpoints: vectorStoreStatus.status === 'healthy' ? [`${process.env.CHROMA_HOST || 'localhost'}:${process.env.CHROMA_PORT || '8000'}`] : [],
        quality_thresholds: {
          min: 0.0,
          default: 0.7,
          max: 1.0,
        },
      };

      // System health check
      const systemHealth = {
        overall_status: this.mnemosyneAvailable ? 'degraded' as const : 'unavailable' as const,
        components: {
          database: true,
          vector_store: false,
          embedding_service: false,
          distillation_engine: false,
        },
        last_check: new Date().toISOString(),
      };

      return {
        success: true,
        data: {
          database: dbStats,
          vector_store: vectorStoreStatus,
          search_capabilities: searchCapabilities,
          system_health: systemHealth,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get semantic search stats: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Get database statistics
   */
  private async getDatabaseStats() {
    try {
      // Get journal entries count
      const entriesResult = await this.query(
        'SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL \'7 days\') as recent FROM ai_memory.journal_entries'
      );

      let distillationsData = {
        total_distillations: 0,
        avg_quality_score: 0,
      };

      // Get distillations count if available
      if (this.mnemosyneAvailable) {
        try {
          const distillationsResult = await this.query(
            'SELECT COUNT(*) as total, AVG(overall_quality) as avg_quality FROM ai_memory.distillations'
          );
          distillationsData = {
            total_distillations: parseInt(distillationsResult.rows[0]?.total || '0'),
            avg_quality_score: parseFloat(distillationsResult.rows[0]?.avg_quality || '0'),
          };
        } catch (error) {
          // Ignore if distillations table doesn't exist
        }
      }

      return {
        total_entries: parseInt(entriesResult.rows[0]?.total || '0'),
        recent_entries_count: parseInt(entriesResult.rows[0]?.recent || '0'),
        ...distillationsData,
      };
    } catch (error) {
      return {
        total_entries: 0,
        total_distillations: 0,
        avg_quality_score: 0,
        recent_entries_count: 0,
      };
    }
  }

  // Helper methods for input validation
  private validateSearchInsightsRequest(request: any): string[] {
    const errors: string[] = [];

    if (!request.query || typeof request.query !== 'string' || request.query.trim() === '') {
      errors.push('query is required and must be a non-empty string');
    }

    if (request.limit !== undefined) {
      if (typeof request.limit !== 'number' || request.limit < 1 || request.limit > 100) {
        errors.push('limit must be a number between 1 and 100');
      }
    }

    if (request.similarity_threshold !== undefined) {
      if (
        typeof request.similarity_threshold !== 'number' ||
        request.similarity_threshold < 0 ||
        request.similarity_threshold > 1
      ) {
        errors.push('similarity_threshold must be a number between 0 and 1');
      }
    }

    if (request.quality_threshold !== undefined) {
      if (
        typeof request.quality_threshold !== 'number' ||
        request.quality_threshold < 0 ||
        request.quality_threshold > 1
      ) {
        errors.push('quality_threshold must be a number between 0 and 1');
      }
    }

    return errors;
  }

  private validateFindRelatedRequest(request: any): string[] {
    const errors: string[] = [];

    if (!request.reference_id || typeof request.reference_id !== 'string') {
      errors.push('reference_id is required and must be a string');
    }

    if (!request.reference_type || !['entry', 'insight'].includes(request.reference_type)) {
      errors.push('reference_type must be either "entry" or "insight"');
    }

    if (request.limit !== undefined) {
      if (typeof request.limit !== 'number' || request.limit < 1 || request.limit > 50) {
        errors.push('limit must be a number between 1 and 50');
      }
    }

    return errors;
  }

  private validateDistillAndSearchRequest(request: any): string[] {
    const errors: string[] = [];

    if (!request.query || typeof request.query !== 'string' || request.query.trim() === '') {
      errors.push('query is required and must be a non-empty string');
    }

    if (request.days_back !== undefined) {
      if (typeof request.days_back !== 'number' || request.days_back < 1 || request.days_back > 365) {
        errors.push('days_back must be a number between 1 and 365');
      }
    }

    return errors;
  }

  private async checkVectorStoreHealth(): Promise<{
    status: 'healthy' | 'unavailable' | 'degraded';
    collection_name?: string;
    total_documents?: number;
    embedding_model?: string;
    last_updated?: string;
  }> {
    try {
      const chromaHost = process.env.CHROMA_HOST || 'localhost';
      const chromaPort = process.env.CHROMA_PORT || '8000';
      const chromaUrl = `http://${chromaHost}:${chromaPort}`;
      
      // Check ChromaDB heartbeat
      const response = await fetch(`${chromaUrl}/api/v2/heartbeat`, { 
        method: 'GET'
      });
      
      if (!response.ok) {
        return { status: 'unavailable' };
      }
      
      // Try to get collection info
      const collectionName = process.env.CHROMA_COLLECTION || 'ai_memory_journal';
      const embeddingModel = process.env.EMBEDDING_MODEL || 'bge-large';
      
      return {
        status: 'healthy',
        collection_name: collectionName,
        total_documents: undefined, // Would need collection API call
        embedding_model: embeddingModel,
        last_updated: new Date().toISOString(),
      };
    } catch (error) {
      return { status: 'unavailable' };
    }
  }

  private convertToDistilledInsight(row: any): DistilledInsight {
    return {
      id: row.id,
      title: row.title,
      summary: row.summary,
      key_insights: row.key_insights,
      action_items: row.action_items,
      category: row.category,
      quality_score: row.overall_quality,
      source_entry_id: row.entry_id?.toString(),
      timestamp: row.created_at.toISOString(),
      tags: row.tags,
    };
  }

  /**
   * MCP Tool: mcp__semantic_search_chunks
   * Searches semantic chunks for faster topic-level discovery
   */
  async semanticSearchChunks(request: ChunkSearchRequest): Promise<ChunkSearchResponse> {
    const startTime = Date.now();

    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      // Validate input
      if (!request.query || typeof request.query !== 'string') {
        return {
          success: false,
          error: 'Query is required and must be a string',
        };
      }

      const limit = request.limit || 5;
      const expandChunks = request.expand_chunks || false;

      // Connect to chunk collection
      let chunkCollection;
      try {
        const ChromaClient = require('chromadb').ChromaClient;
        const client = new ChromaClient({ path: 'http://localhost:8000' });
        chunkCollection = await client.getCollection({ name: 'ai_memory_chunks' });
      } catch (error) {
        return {
          success: false,
          error: 'Chunk collection not available. Please run chunk generation first.',
        };
      }

      // Generate embedding for query
      let embedding;
      try {
        const embeddingResponse = await fetch('http://localhost:11434/api/embeddings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'nomic-embed-text',
            prompt: request.query
          })
        });

        if (!embeddingResponse.ok) {
          return {
            success: false,
            error: 'Failed to generate query embedding',
          };
        }

        const embeddingData = await embeddingResponse.json() as { embedding: number[] };
        embedding = embeddingData.embedding;
      } catch (error) {
        return {
          success: false,
          error: 'Embedding service unavailable',
        };
      }

      // Search chunks
      const chunkResults = await chunkCollection.query({
        queryEmbeddings: [embedding],
        nResults: limit,
        include: ['distances', 'documents', 'metadatas']
      });

      if (!chunkResults.documents || !chunkResults.documents[0] || chunkResults.documents[0].length === 0) {
        return {
          success: true,
          results: {
            chunks: [],
            metadata: {
              total_chunks: 0,
              avg_similarity_score: 0,
              search_duration_ms: Date.now() - startTime,
              compression_ratio: 'N/A'
            }
          }
        };
      }

      // Convert results to semantic chunks
      const chunks: SemanticChunk[] = chunkResults.documents[0].map((summary: string, i: number) => {
        const metadata = chunkResults.metadatas![0]![i];
        const distance = chunkResults.distances![0]![i];
        
        return {
          chunk_id: metadata!.chunk_id as string,
          summary: summary,
          member_count: parseInt(metadata!.member_count as string),
          member_ids: (metadata!.member_ids as string).split(','),
          agents: metadata!.agents ? (metadata!.agents as string).split(',').filter((a: string) => a.trim()) : [],
          date_range: (metadata!.date_range as string) || 'unknown',
          similarity_score: 1 - (distance! / 1000) // Convert distance to similarity
        };
      });

      let expandedEntries = null;

      // If expand_chunks is true, get the full entries for the top chunk
      if (expandChunks && chunks.length > 0) {
        const topChunk = chunks[0]!;
        const entryIds = topChunk.member_ids.map(id => parseInt(id));
        
        const entriesQuery = `
          SELECT id, title, content, created_at, metadata
          FROM ai_memory.journal_entries 
          WHERE id = ANY($1)
          ORDER BY created_at DESC
        `;
        
        try {
          const entriesResult = await this.query(entriesQuery, [entryIds]);
          expandedEntries = entriesResult.rows;
        } catch (error) {
          console.warn('Failed to expand chunk entries:', error);
        }
      }

      const totalChunks = await chunkCollection.count();
      const avgSimilarity = chunks.length > 0 
        ? chunks.reduce((sum, c) => sum + c.similarity_score, 0) / chunks.length 
        : 0;

      return {
        success: true,
        results: {
          chunks,
          expanded_entries: expandedEntries || undefined,
          metadata: {
            total_chunks: totalChunks,
            avg_similarity_score: avgSimilarity,
            search_duration_ms: Date.now() - startTime,
            compression_ratio: `~${Math.round(totalChunks * 5)}:${totalChunks} (5x)`
          }
        }
      };

    } catch (error) {
      return {
        success: false,
        error: `Chunk search failed: ${(error as Error).message}`,
      };
    }
  }

  /**
   * MCP Tool: mcp__expand_chunk
   * Expands a specific chunk to show all its member entries
   */
  async expandChunk(request: ChunkExpansionRequest): Promise<ChunkExpansionResponse> {
    const startTime = Date.now();

    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      // Validate input
      if (!request.chunk_id || typeof request.chunk_id !== 'string') {
        return {
          success: false,
          error: 'chunk_id is required and must be a string',
        };
      }

      // Connect to chunk collection
      let chunkCollection;
      try {
        const ChromaClient = require('chromadb').ChromaClient;
        const client = new ChromaClient({ path: 'http://localhost:8000' });
        chunkCollection = await client.getCollection({ name: 'ai_memory_chunks' });
      } catch (error) {
        return {
          success: false,
          error: 'Chunk collection not available. Please run chunk generation first.',
        };
      }

      // Get chunk metadata
      const chunkResults = await chunkCollection.get({
        ids: [request.chunk_id],
        include: ['documents', 'metadatas']
      });

      if (!chunkResults.documents || !chunkResults.documents[0] || chunkResults.documents.length === 0) {
        return {
          success: false,
          error: `Chunk not found: ${request.chunk_id}`,
        };
      }

      const chunkDocument = chunkResults.documents[0];
      const chunkMetadata = chunkResults.metadatas![0];
      const memberIds = (chunkMetadata!.member_ids as string).split(',').map((id: string) => parseInt(id.trim()));

      // Create chunk info object
      const chunkInfo: SemanticChunk = {
        chunk_id: request.chunk_id,
        summary: chunkDocument,
        member_count: parseInt(chunkMetadata!.member_count as string),
        member_ids: memberIds.map((id: number) => id.toString()),
        agents: chunkMetadata!.agents ? (chunkMetadata!.agents as string).split(',').filter((a: string) => a.trim()) : [],
        date_range: (chunkMetadata!.date_range as string) || 'unknown',
        similarity_score: 1.0 // Perfect match since we're getting the exact chunk
      };

      // Get all member entries
      const entriesQuery = `
        SELECT id, title, content, created_at, agent_id, model_id, 
               user_project, visibility_level, sections, entry_type, 
               word_count, category, metadata
        FROM ai_memory.journal_entries 
        WHERE id = ANY($1)
        ORDER BY created_at DESC
      `;
      
      const entriesResult = await this.query(entriesQuery, [memberIds]);
      const entries = entriesResult.rows;

      return {
        success: true,
        results: {
          chunk_info: chunkInfo,
          entries: entries,
          metadata: {
            chunk_id: request.chunk_id,
            entry_count: entries.length,
            expansion_duration_ms: Date.now() - startTime
          }
        }
      };

    } catch (error) {
      return {
        success: false,
        error: `Chunk expansion failed: ${(error as Error).message}`,
      };
    }
  }
}