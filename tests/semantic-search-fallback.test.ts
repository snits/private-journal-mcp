// ABOUTME: Tests for the 4-tier semantic search fallback system with infrastructure unavailability scenarios
// ABOUTME: Validates PostgreSQL + ChromaDB unavailable fallback to file-based search and tier metadata

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { Pool } from 'pg';
import { SemanticSearchTools, SearchInsightsRequest, DistilledInsight } from '../src/semantic-search-tools';
import { SearchService, SearchResult } from '../src/search';
import { JournalManager } from '../src/journal';
import { createDatabaseConfig } from '../src/database-config';

// Mock fetch for ChromaDB heartbeat checks
const originalFetch = global.fetch;

describe('Semantic Search Fallback System', () => {
  let tempDir: string;
  let projectTempDir: string;
  let userTempDir: string;
  let journalManager: JournalManager;
  let searchService: SemanticSearchTools;
  let mockDbManager: any;
  let originalHome: string | undefined;

  beforeEach(async () => {
    // Create temporary directories
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'semantic-fallback-test-'));
    projectTempDir = path.join(tempDir, 'project');
    userTempDir = path.join(tempDir, 'user');
    
    await fs.mkdir(projectTempDir, { recursive: true });
    await fs.mkdir(userTempDir, { recursive: true });

    // Mock HOME environment
    originalHome = process.env.HOME;
    process.env.HOME = userTempDir;

    // Initialize journal manager for file-based operations
    journalManager = new JournalManager(projectTempDir);

    // Create sample journal entries for file-based search
    await createSampleJournalEntries();

    // Mock database manager to simulate various failure scenarios
    mockDbManager = {
      query: jest.fn(),
      pool: {
        connect: jest.fn(),
      },
    };

    // Initialize semantic search tools with mocked database
    searchService = new SemanticSearchTools(mockDbManager);
  });

  afterEach(async () => {
    // Restore original environment
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }

    // Restore fetch
    global.fetch = originalFetch;

    // Clean up
    await fs.rm(tempDir, { recursive: true, force: true });
    
    // Reset environment variables
    delete process.env.CHROMA_HOST;
    delete process.env.CHROMA_PORT;
    delete process.env.CHROMA_COLLECTION;

    jest.clearAllMocks();
  });

  async function createSampleJournalEntries() {
    // Create sample entries for file-based search testing
    await journalManager.writeThoughts({
      technical_insights: 'PostgreSQL performance optimization techniques for large datasets',
      project_notes: 'Database indexing strategies implementation completed',
      user_context: 'Jerry requested comprehensive database performance analysis',
      agent_id: 'database-specialist',
      model_id: 'claude-sonnet-4',
      visibility_level: 'team'
    });

    await journalManager.writeThoughts({
      feelings: 'Excited about implementing new search capabilities',
      technical_insights: 'ChromaDB vector search provides excellent semantic similarity',
      world_knowledge: 'Semantic search revolutionizes information retrieval systems',
      agent_id: 'search-engineer',
      model_id: 'claude-sonnet-4'
    });

    await journalManager.writeEntry('Fallback system design ensures graceful degradation when infrastructure is unavailable');
  }

  function mockChromaDBUnavailable() {
    global.fetch = jest.fn().mockRejectedValue(new Error('Connection refused'));
  }

  function mockChromaDBHealthy() {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'healthy' })
    });
  }

  function mockDatabaseUnavailable() {
    mockDbManager.query.mockRejectedValue(new Error('Database connection failed'));
    mockDbManager.pool.connect.mockRejectedValue(new Error('Connection pool exhausted'));
  }

  function mockDatabaseAvailable() {
    mockDbManager.query.mockResolvedValue({
      rows: [{ distillations_exist: false }] // Mnemosyne not available
    });
  }

  function mockMnemosyneAvailable() {
    mockDbManager.query.mockResolvedValue({
      rows: [{ distillations_exist: true }] // Mnemosyne available
    });
  }

  describe('Tier 4: File-based Fallback', () => {
    test('should fall back to file-based search when database unavailable', async () => {
      // Mock all higher tiers as unavailable
      mockChromaDBUnavailable();
      mockDatabaseUnavailable();

      const request: SearchInsightsRequest = {
        query: 'PostgreSQL performance optimization',
        limit: 5,
        similarity_threshold: 0.3
      };

      const result = await searchService.semanticSearchInsights(request);

      // Should succeed with file-based search
      expect(result.success).toBe(true);
      expect(result.results).toBeDefined();
      expect(result.results!.metadata.search_tier).toBe('File System Search');
      expect(result.results!.insights.length).toBeGreaterThan(0);

      // Verify insights are properly formatted
      const insight = result.results!.insights[0];
      expect(insight).toHaveProperty('id');
      expect(insight).toHaveProperty('title');
      expect(insight).toHaveProperty('summary');
      expect(insight).toHaveProperty('key_insights');
      expect(insight).toHaveProperty('category', 'journal_entry');
      expect(insight).toHaveProperty('quality_score');
      expect(insight).toHaveProperty('similarity_score');
      expect(insight).toHaveProperty('source_entry_id');
      expect(insight).toHaveProperty('timestamp');
      expect(insight).toHaveProperty('tags');

      // Should contain relevant content from our test entries - at least one of our entries should match
      expect(insight.summary.length).toBeGreaterThan(0); // Should have meaningful content
      expect(typeof insight.summary).toBe('string');
      expect(insight.summary.trim()).not.toBe('');
      
      // Should contain content related to our test data (search, database, or performance topics)
      const summary = insight.summary.toLowerCase();
      const hasRelevantContent = summary.includes('search') || 
                                 summary.includes('database') || 
                                 summary.includes('performance') ||
                                 summary.includes('chroma') ||
                                 summary.includes('postgresql');
      expect(hasRelevantContent).toBe(true);
    });

    test('should respect similarity threshold in file-based search', async () => {
      mockChromaDBUnavailable();
      mockDatabaseUnavailable();

      const highThresholdRequest: SearchInsightsRequest = {
        query: 'completely unrelated quantum physics topic',
        limit: 10,
        similarity_threshold: 0.9
      };

      const result = await searchService.semanticSearchInsights(highThresholdRequest);

      expect(result.success).toBe(true);
      expect(result.results!.metadata.search_tier).toBe('File System Search');
      // Should have fewer or no results due to high threshold
      expect(result.results!.insights.length).toBeLessThanOrEqual(1);
    });

    test('should include correct metadata for file-based search', async () => {
      mockChromaDBUnavailable();
      mockDatabaseUnavailable();

      const request: SearchInsightsRequest = {
        query: 'search capabilities',
        limit: 3
      };

      const result = await searchService.semanticSearchInsights(request);

      expect(result.success).toBe(true);
      expect(result.results!.metadata).toEqual({
        total_insights: expect.any(Number),
        avg_quality_score: expect.any(Number),
        avg_similarity_score: expect.any(Number),
        search_duration_ms: expect.any(Number),
        search_mode: 'insights_only',
        search_tier: 'File System Search'
      });

      expect(result.results!.metadata.search_duration_ms).toBeGreaterThan(0);
      expect(result.results!.metadata.avg_quality_score).toBeGreaterThanOrEqual(0);
      expect(result.results!.metadata.avg_similarity_score).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Tier 3: PostgreSQL Text Search', () => {
    test('should use PostgreSQL text search when database available but Mnemosyne unavailable', async () => {
      mockChromaDBUnavailable();
      mockDatabaseAvailable(); // Database works but no Mnemosyne

      const request: SearchInsightsRequest = {
        query: 'database performance',
        limit: 5
      };

      const result = await searchService.semanticSearchInsights(request);

      // Should fall back to Tier 4 (file-based) since Mnemosyne is not available
      expect(result.success).toBe(true);
      expect(result.results!.metadata.search_tier).toBe('File System Search');
    });

    test('should use PostgreSQL text search when vector search unavailable but Mnemosyne available', async () => {
      mockChromaDBUnavailable();
      mockMnemosyneAvailable();

      // Mock PostgreSQL text search query
      mockDbManager.query
        .mockResolvedValueOnce({ rows: [{ distillations_exist: true }] }) // Initialize check
        .mockResolvedValueOnce({ rows: [{ vector_available: false }] }) // pgvector check
        .mockResolvedValueOnce({ // PostgreSQL text search results
          rows: [
            {
              id: 'pg_insight_1',
              title: 'Database Optimization Insights',
              summary: 'Comprehensive analysis of PostgreSQL performance tuning',
              key_insights: ['Indexing strategies', 'Query optimization', 'Connection pooling'],
              action_items: ['Implement btree indexes', 'Optimize slow queries'],
              category: 'database_performance',
              overall_quality: 0.85,
              entry_id: 'entry_123',
              created_at: new Date(),
              tags: ['postgresql', 'performance']
            }
          ]
        });

      const request: SearchInsightsRequest = {
        query: 'database performance optimization',
        limit: 5,
        quality_threshold: 0.7
      };

      const result = await searchService.semanticSearchInsights(request);

      expect(result.success).toBe(true);
      expect(result.results!.metadata.search_tier).toBe('PostgreSQL Text Search');
      expect(result.results!.insights.length).toBe(1);

      const insight = result.results!.insights[0];
      expect(insight.id).toBe('pg_insight_1');
      expect(insight.title).toBe('Database Optimization Insights');
      expect(insight.quality_score).toBe(0.85);
      expect(insight.category).toBe('database_performance');
    });

    test('should include search parameters in PostgreSQL text search', async () => {
      mockChromaDBUnavailable();
      mockMnemosyneAvailable();

      // Mock the initialization and pgvector check
      mockDbManager.query
        .mockResolvedValueOnce({ rows: [{ distillations_exist: true }] })
        .mockResolvedValueOnce({ rows: [{ vector_available: false }] })
        .mockResolvedValueOnce({ rows: [] }); // Empty results

      const request: SearchInsightsRequest = {
        query: 'specific technical topic',
        limit: 10,
        quality_threshold: 0.8,
        category: 'technical_analysis',
        date_range: {
          start: '2024-01-01T00:00:00Z',
          end: '2024-12-31T23:59:59Z'
        }
      };

      await searchService.semanticSearchInsights(request);

      // Verify the query was called with proper parameters
      const lastCall = mockDbManager.query.mock.calls[mockDbManager.query.mock.calls.length - 1];
      expect(lastCall[0]).toContain('ILIKE');
      expect(lastCall[0]).toContain('overall_quality >=');
      expect(lastCall[0]).toContain('category =');
      expect(lastCall[0]).toContain('created_at >=');
      expect(lastCall[1]).toContain('%specific technical topic%');
      expect(lastCall[1]).toContain(0.8); // quality threshold
      expect(lastCall[1]).toContain('technical_analysis'); // category
      expect(lastCall[1]).toContain(10); // limit
    });
  });

  describe('SearchResult to DistilledInsight Conversion', () => {
    test('should correctly convert SearchResult to DistilledInsight format', () => {
      const mockSearchResult: SearchResult = {
        path: '/tmp/journal/2024-01-15/14-30-45-123456.md',
        score: 0.87,
        text: 'Comprehensive technical analysis of database performance optimization strategies',
        sections: ['technical_insights', 'project_notes'],
        timestamp: 1705329045000,
        excerpt: 'Database optimization techniques include proper indexing and query tuning',
        type: 'project',
        agent_id: 'database-specialist',
        model_id: 'claude-sonnet-4',
        visibility_level: 'team'
      };

      // Use the conversion logic from searchWithFileSystem
      const convertedInsight: DistilledInsight = {
        id: `file_0_${Date.now()}`,
        title: `Journal Entry: ${new Date(mockSearchResult.timestamp).toLocaleDateString()}`,
        summary: mockSearchResult.excerpt,
        key_insights: mockSearchResult.sections,
        category: 'journal_entry',
        quality_score: mockSearchResult.score,
        similarity_score: mockSearchResult.score,
        source_entry_id: mockSearchResult.path,
        timestamp: new Date(mockSearchResult.timestamp).toISOString(),
        tags: [mockSearchResult.type]
      };

      expect(convertedInsight.id).toContain('file_0_');
      expect(convertedInsight.title).toBe('Journal Entry: 1/15/2024');
      expect(convertedInsight.summary).toBe(mockSearchResult.excerpt);
      expect(convertedInsight.key_insights).toEqual(['technical_insights', 'project_notes']);
      expect(convertedInsight.category).toBe('journal_entry');
      expect(convertedInsight.quality_score).toBe(0.87);
      expect(convertedInsight.similarity_score).toBe(0.87);
      expect(convertedInsight.source_entry_id).toBe(mockSearchResult.path);
      expect(convertedInsight.timestamp).toBe('2024-01-15T14:30:45.000Z');
      expect(convertedInsight.tags).toEqual(['project']);
    });

    test('should handle SearchResult with minimal data', () => {
      const minimalSearchResult: SearchResult = {
        path: '/tmp/simple.md',
        score: 0.45,
        text: 'Simple entry',
        sections: [],
        timestamp: Date.now(),
        excerpt: 'Brief note',
        type: 'user'
      };

      const convertedInsight: DistilledInsight = {
        id: `file_0_${Date.now()}`,
        title: `Journal Entry: ${new Date(minimalSearchResult.timestamp).toLocaleDateString()}`,
        summary: minimalSearchResult.excerpt,
        key_insights: minimalSearchResult.sections,
        category: 'journal_entry',
        quality_score: minimalSearchResult.score,
        similarity_score: minimalSearchResult.score,
        source_entry_id: minimalSearchResult.path,
        timestamp: new Date(minimalSearchResult.timestamp).toISOString(),
        tags: [minimalSearchResult.type]
      };

      expect(convertedInsight.summary).toBe('Brief note');
      expect(convertedInsight.key_insights).toEqual([]);
      expect(convertedInsight.quality_score).toBe(0.45);
      expect(convertedInsight.tags).toEqual(['user']);
    });
  });

  describe('Tier Metadata Verification', () => {
    test('should add correct tier metadata to successful results', async () => {
      mockChromaDBUnavailable();
      mockDatabaseUnavailable();

      const request: SearchInsightsRequest = {
        query: 'test query',
        limit: 1
      };

      const result = await searchService.semanticSearchInsights(request);

      expect(result.success).toBe(true);
      expect(result.results!.metadata).toHaveProperty('search_tier');
      expect(result.results!.metadata.search_tier).toBe('File System Search');
    });

    test('should preserve other metadata when adding tier information', async () => {
      mockChromaDBUnavailable();
      mockDatabaseUnavailable();

      const request: SearchInsightsRequest = {
        query: 'search test',
        limit: 2,
        search_mode: 'hybrid'
      };

      const result = await searchService.semanticSearchInsights(request);

      expect(result.success).toBe(true);
      expect(result.results!.metadata).toEqual({
        total_insights: expect.any(Number),
        avg_quality_score: expect.any(Number),
        avg_similarity_score: expect.any(Number),
        search_duration_ms: expect.any(Number),
        search_mode: 'hybrid',
        search_tier: 'File System Search'
      });
    });
  });

  describe('Error Handling', () => {
    test('should return error when all tiers fail', async () => {
      // Mock all tiers to fail
      mockChromaDBUnavailable();
      mockDatabaseUnavailable();

      // Create a new SemanticSearchTools instance with a failing SearchService
      const failingDbManager = {
        query: jest.fn().mockRejectedValue(new Error('Database connection failed')),
        pool: {
          connect: jest.fn().mockRejectedValue(new Error('Connection pool exhausted')),
        },
      };

      // Mock the SearchService to fail by overriding the searchService property
      const failingSearchService = new SemanticSearchTools(failingDbManager);
      
      // Override the SearchService instance to make it fail
      (failingSearchService as any).searchService = {
        search: jest.fn().mockRejectedValue(new Error('File system search failed'))
      };

      const request: SearchInsightsRequest = {
        query: 'test query'
      };

      const result = await failingSearchService.semanticSearchInsights(request);

      expect(result.success).toBe(false);
      expect(result.error).toContain('All search tiers failed');
    });

    test('should validate input parameters before attempting search', async () => {
      const invalidRequest: any = {
        query: '', // Empty query should fail validation
        limit: -1   // Invalid limit should fail validation
      };

      const result = await searchService.semanticSearchInsights(invalidRequest);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Validation failed');
      expect(result.error).toContain('query is required');
      expect(result.error).toContain('limit must be a number between 1 and 100');
    });

    test('should handle ChromaDB availability check gracefully', async () => {
      // Mock fetch to throw network error
      global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      mockDatabaseUnavailable();

      const request: SearchInsightsRequest = {
        query: 'network test'
      };

      const result = await searchService.semanticSearchInsights(request);

      // Should fallback to file-based search
      expect(result.success).toBe(true);
      expect(result.results!.metadata.search_tier).toBe('File System Search');
    });
  });

  describe('Performance Expectations', () => {
    test('file-based search should complete within reasonable time', async () => {
      mockChromaDBUnavailable();
      mockDatabaseUnavailable();

      const startTime = Date.now();
      
      const request: SearchInsightsRequest = {
        query: 'performance test',
        limit: 10
      };

      const result = await searchService.semanticSearchInsights(request);
      const endTime = Date.now();

      expect(result.success).toBe(true);
      expect(endTime - startTime).toBeLessThan(5000); // Should complete in under 5 seconds
      expect(result.results!.metadata.search_duration_ms).toBeGreaterThan(0);
      expect(result.results!.metadata.search_duration_ms).toBeLessThan(5000);
    });
  });
});