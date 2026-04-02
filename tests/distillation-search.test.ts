// ABOUTME: Tests for enhanced search that queries both entries and distillations
// ABOUTME: Validates merge, dedup, and sort behavior for MergedSearchResult[]

import { PostgreSQLJournalManager } from '../src/postgresql-journal-simple';

describe('Enhanced search with distillations', () => {
  let manager: PostgreSQLJournalManager;
  let mockClient: any;
  let mockPool: any;

  beforeEach(async () => {
    vi.resetModules();

    const mockGenerateQueryEmbedding = vi.fn().mockResolvedValue(new Array(768).fill(0.1));

    vi.doMock('../src/openai-embedding-service', () => ({
      OpenAIEmbeddingService: {
        getInstance: vi.fn().mockReturnValue({
          generateQueryEmbedding: mockGenerateQueryEmbedding,
          generateDocumentEmbedding: vi.fn().mockResolvedValue(new Array(768).fill(0.1)),
          extractSearchableText: vi.fn().mockReturnValue({ text: 'text', sections: [] }),
          getDimensions: vi.fn().mockReturnValue(768),
          getDefaultMinRelevance: vi.fn().mockReturnValue(0.6),
        }),
      },
    }));

    const mod = await import('../src/postgresql-journal-simple');
    manager = new mod.PostgreSQLJournalManager();

    mockClient = {
      query: vi.fn(),
      release: vi.fn(),
    };
    mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient),
    };
    (manager as any).pool = mockPool;
  });

  test('searchBySimilarity queries both entries and distillations', async () => {
    // Entry query returns one result
    mockClient.query
      .mockResolvedValueOnce({
        rows: [{
          id: 1,
          content: 'Original entry',
          timestamp: new Date('2026-03-15'),
          file_path: '2026-03-15/14-30-45-123456.md',
          score: 0.85,
          entry_type: 'thoughts',
          sections: '["project_notes"]',
          agent_id: null,
          model_id: null,
          visibility_level: 'private',
          project: 'mnemosyne',
          project_context: null,
          searchable_text: null,
        }],
      })
      // Distillation query returns one result
      .mockResolvedValueOnce({
        rows: [{
          id: 'uuid-dist-1',
          title: 'Distilled insight',
          summary: 'A summary of the insight',
          key_insights: ['insight one'],
          category: 'technical',
          timestamp: new Date('2026-03-15'),
          source_entry_id: 2,
          source_entry_path: '2026-03-15/15-00-00-000000.md',
          score: 0.90,
        }],
      });

    const results = await manager.searchBySimilarity('test query');

    // Should have called connect twice (two queries in parallel)
    // or once with two queries — depends on implementation
    expect(mockClient.query).toHaveBeenCalledTimes(2);

    // First call should be entry query
    const entrySql = mockClient.query.mock.calls[0][0];
    expect(entrySql).toContain('ai_memory.journal_entries');

    // Second call should be distillation query
    const distSql = mockClient.query.mock.calls[1][0];
    expect(distSql).toContain('ai_memory.distillations');
  });

  test('deduplicates when entry and its distillation both match', async () => {
    const entryId = 42;

    // Entry result
    mockClient.query
      .mockResolvedValueOnce({
        rows: [{
          id: entryId,
          content: 'Original',
          timestamp: new Date('2026-03-15'),
          file_path: 'path.md',
          score: 0.80,
          entry_type: 'thoughts',
          sections: '[]',
          agent_id: null,
          model_id: null,
          visibility_level: 'private',
          project: null,
          project_context: null,
          searchable_text: null,
        }],
      })
      // Distillation result for same entry, higher score
      .mockResolvedValueOnce({
        rows: [{
          id: 'uuid-1',
          title: 'Better match',
          summary: 'Summary',
          key_insights: ['insight'],
          category: 'technical',
          timestamp: new Date('2026-03-15'),
          source_entry_id: entryId,
          source_entry_path: 'path.md',
          score: 0.92,
        }],
      });

    const results = await manager.searchBySimilarity('test');

    // Should keep the higher-scoring distillation, drop the entry
    expect(results.length).toBe(1);
    expect((results[0] as any).source).toBe('distillation');
  });

  test('keeps entry when it scores higher than its distillation', async () => {
    const entryId = 42;

    mockClient.query
      .mockResolvedValueOnce({
        rows: [{
          id: entryId,
          content: 'Original',
          timestamp: new Date('2026-03-15'),
          file_path: 'path.md',
          score: 0.95,
          entry_type: 'thoughts',
          sections: '[]',
          agent_id: null,
          model_id: null,
          visibility_level: 'private',
          project: null,
          project_context: null,
          searchable_text: null,
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 'uuid-1',
          title: 'Lower match',
          summary: 'Summary',
          key_insights: ['insight'],
          category: 'technical',
          timestamp: new Date('2026-03-15'),
          source_entry_id: entryId,
          source_entry_path: 'path.md',
          score: 0.70,
        }],
      });

    const results = await manager.searchBySimilarity('test');

    expect(results.length).toBe(1);
    expect((results[0] as any).source).toBe('entry');
  });

  test('merges and sorts by score descending', async () => {
    mockClient.query
      .mockResolvedValueOnce({
        rows: [{
          id: 1,
          content: 'Entry',
          timestamp: new Date('2026-03-15'),
          file_path: 'a.md',
          score: 0.80,
          entry_type: 'thoughts',
          sections: '[]',
          agent_id: null,
          model_id: null,
          visibility_level: 'private',
          project: null,
          project_context: null,
          searchable_text: null,
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 'uuid-1',
          title: 'High scoring',
          summary: 'Summary',
          key_insights: ['insight'],
          category: 'technical',
          timestamp: new Date('2026-03-14'),
          source_entry_id: 99,
          source_entry_path: 'b.md',
          score: 0.95,
        }],
      });

    const results = await manager.searchBySimilarity('test');

    expect(results.length).toBe(2);
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });
});
