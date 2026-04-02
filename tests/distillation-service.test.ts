// tests/distillation-service.test.ts
import { DistillationService } from '../src/distillation/distillation-service';

describe('DistillationService', () => {
  let service: DistillationService;
  let mockPool: any;
  let mockClient: any;
  let mockTextGen: any;
  let mockEmbedding: any;

  beforeEach(() => {
    mockClient = {
      query: vi.fn(),
      release: vi.fn(),
    };
    mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient),
    };
    mockTextGen = {
      generate: vi.fn(),
      getModel: vi.fn().mockReturnValue('qwen3.5:32k'),
    };
    mockEmbedding = {
      generateDocumentEmbedding: vi.fn().mockResolvedValue(new Array(768).fill(0.1)),
      getDimensions: vi.fn().mockReturnValue(768),
    };
    service = new DistillationService(mockPool, mockTextGen, mockEmbedding);
  });

  describe('distillEntries', () => {
    test('queries for undistilled entries', async () => {
      // Count query returns 0 skipped
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ cnt: '0' }] })
        .mockResolvedValueOnce({ rows: [] });

      await service.distillEntries({ daysBack: 30 });

      // Second query (undistilled entries) should use LEFT JOIN anti-pattern
      const sql = mockClient.query.mock.calls[1][0];
      expect(sql).toContain('LEFT JOIN ai_memory.distillation_sources');
      expect(sql).toContain('ds.entry_id IS NULL');
    });

    test('skips when no undistilled entries found', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ cnt: '5' }] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await service.distillEntries({ daysBack: 30 });

      expect(result.entriesFound).toBe(5);
      expect(result.entriesSkipped).toBe(5);
      expect(result.distillationsCreated).toBe(0);
      expect(mockTextGen.generate).not.toHaveBeenCalled();
    });

    test('processes undistilled entries and stores results', async () => {
      // Count query: 0 skipped
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ cnt: '0' }] })
        // Undistilled entries query
        .mockResolvedValueOnce({
          rows: [{
            id: 1,
            content: 'Journal entry about debugging postgres',
            type: 'technical',
            agent_id: 'claude-general',
            date_string: '2026-03-15',
            sections: '["project_notes"]',
          }],
        })
        // BEGIN
        .mockResolvedValueOnce({ rows: [] })
        // INSERT distillation
        .mockResolvedValueOnce({ rows: [{ id: 'uuid-123' }] })
        // INSERT distillation_sources
        .mockResolvedValueOnce({ rows: [] })
        // COMMIT
        .mockResolvedValueOnce({ rows: [] })
        // UPDATE embedding
        .mockResolvedValueOnce({ rows: [] });

      mockTextGen.generate.mockResolvedValue(JSON.stringify({
        title: 'PostgreSQL debugging techniques',
        summary: 'Explored connection pooling issues and pg_stat_activity for diagnosing idle connections',
        key_insights: ['Check pg_stat_activity for idle-in-transaction connections'],
        category: 'technical',
      }));

      const result = await service.distillEntries({ daysBack: 30 });

      expect(result.entriesFound).toBe(1);
      expect(result.distillationsCreated).toBe(1);
      expect(result.errors).toBe(0);
      expect(result.titles).toContain('PostgreSQL debugging techniques');
    });

    test('continues on parse failure and increments error count', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ cnt: '0' }] })
        .mockResolvedValueOnce({
        rows: [{
          id: 1,
          content: 'Some entry',
          type: 'general',
          agent_id: null,
          date_string: '2026-03-15',
          sections: null,
        }],
      });

      mockTextGen.generate.mockResolvedValue('not valid json');

      const result = await service.distillEntries({ daysBack: 30 });

      expect(result.entriesFound).toBe(1);
      expect(result.distillationsCreated).toBe(0);
      expect(result.errors).toBe(1);
    });

    test('strips code fences from LLM output', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ cnt: '0' }] })
        .mockResolvedValueOnce({
          rows: [{
            id: 1,
            content: 'Entry content',
            type: 'technical',
            agent_id: null,
            date_string: '2026-03-15',
            sections: null,
          }],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'uuid-456' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      mockTextGen.generate.mockResolvedValue('```json\n{"title":"Test","summary":"A test summary that is long enough","key_insights":["Insight about something specific"],"category":"technical"}\n```');

      const result = await service.distillEntries({ daysBack: 30 });

      expect(result.distillationsCreated).toBe(1);
    });

    test('validates required fields in LLM output', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ cnt: '0' }] })
        .mockResolvedValueOnce({
        rows: [{
          id: 1,
          content: 'Entry',
          type: 'general',
          agent_id: null,
          date_string: '2026-03-15',
          sections: null,
        }],
      });

      // Missing title
      mockTextGen.generate.mockResolvedValue(JSON.stringify({
        summary: 'A summary',
        key_insights: ['An insight'],
        category: 'technical',
      }));

      const result = await service.distillEntries({ daysBack: 30 });

      expect(result.errors).toBe(1);
      expect(result.distillationsCreated).toBe(0);
    });

    test('validates category is in taxonomy', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ cnt: '0' }] })
        .mockResolvedValueOnce({
        rows: [{
          id: 1,
          content: 'Entry',
          type: 'general',
          agent_id: null,
          date_string: '2026-03-15',
          sections: null,
        }],
      });

      mockTextGen.generate.mockResolvedValue(JSON.stringify({
        title: 'Test Title Here',
        summary: 'A summary of the content that is long enough',
        key_insights: ['An actionable insight here'],
        category: 'invalid_category',
      }));

      const result = await service.distillEntries({ daysBack: 30 });

      expect(result.errors).toBe(1);
    });

    test('respects limit option', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ cnt: '0' }] })
        .mockResolvedValueOnce({ rows: [] });

      await service.distillEntries({ daysBack: 30, limit: 5 });

      // Limit appears in the second query (undistilled entries), not the count query
      const params = mockClient.query.mock.calls[1][1];
      expect(params).toContain(5);
    });

    test('respects category filter', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ cnt: '0' }] })
        .mockResolvedValueOnce({ rows: [] });

      await service.distillEntries({ daysBack: 30, category: 'technical' });

      // Category appears in both queries; check the count query
      const params = mockClient.query.mock.calls[0][1];
      expect(params).toContain('technical');
    });

    test('continues processing after embedding failure', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ cnt: '0' }] })
        .mockResolvedValueOnce({
          rows: [{
            id: 1,
            content: 'Entry',
            type: 'technical',
            agent_id: null,
            date_string: '2026-03-15',
            sections: null,
          }],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'uuid-789' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      mockTextGen.generate.mockResolvedValue(JSON.stringify({
        title: 'Valid Title Here',
        summary: 'A valid summary that is long enough for validation',
        key_insights: ['A specific insight about something'],
        category: 'technical',
      }));

      mockEmbedding.generateDocumentEmbedding.mockRejectedValue(new Error('Embedding service down'));

      const result = await service.distillEntries({ daysBack: 30 });

      // Distillation created but embedding failed — accepted degraded behavior
      expect(result.distillationsCreated).toBe(1);
    });
  });
});
