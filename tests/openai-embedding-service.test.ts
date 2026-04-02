// ABOUTME: Tests for OpenAI embedding service task prefix behavior
// ABOUTME: Verifies search_document and search_query prefixes are applied correctly

import { vi, describe, test, expect, beforeEach, afterEach } from 'vitest';
import type { OpenAIEmbeddingService } from '../src/openai-embedding-service';

describe('OpenAIEmbeddingService task prefixes', () => {
  let service: OpenAIEmbeddingService;
  let mockClientGenerateEmbedding: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();

    mockClientGenerateEmbedding = vi
      .fn()
      .mockResolvedValue([new Array(768).fill(0.1)]);

    vi.doMock('../src/openai-client', () => ({
      OpenAIClient: vi.fn().mockImplementation(() => ({
        generateEmbedding: mockClientGenerateEmbedding,
      })),
    }));

    const mod = await import('../src/openai-embedding-service');
    service = mod.OpenAIEmbeddingService.getInstance();
  });

  test('generateDocumentEmbedding prepends search_document: prefix', async () => {
    await service.generateDocumentEmbedding('journal entry about testing');

    expect(mockClientGenerateEmbedding).toHaveBeenCalledWith(
      ['search_document: journal entry about testing'],
      expect.any(String)
    );
  });

  test('generateQueryEmbedding prepends search_query: prefix', async () => {
    await service.generateQueryEmbedding('find entries about architecture');

    expect(mockClientGenerateEmbedding).toHaveBeenCalledWith(
      ['search_query: find entries about architecture'],
      expect.any(String)
    );
  });

  test('generateDocumentBatch prepends search_document: prefix to all texts', async () => {
    mockClientGenerateEmbedding.mockResolvedValue([
      new Array(768).fill(0.1),
      new Array(768).fill(0.2),
    ]);

    await service.generateDocumentBatch(['first entry', 'second entry']);

    const allTexts = mockClientGenerateEmbedding.mock.calls.flatMap(call => call[0]);
    expect(allTexts).toContain('search_document: first entry');
    expect(allTexts).toContain('search_document: second entry');
  });

  test('generateEmbedding applies no prefix', async () => {
    await service.generateEmbedding('plain text without prefix');

    expect(mockClientGenerateEmbedding).toHaveBeenCalledWith(
      ['plain text without prefix'],
      expect.any(String)
    );
  });
});

describe('OpenAIEmbeddingService dimension override', () => {
  const savedDimensions = process.env.OPENAI_EMBEDDING_DIMENSIONS;

  afterEach(() => {
    // Restore original env
    if (savedDimensions !== undefined) {
      process.env.OPENAI_EMBEDDING_DIMENSIONS = savedDimensions;
    } else {
      delete process.env.OPENAI_EMBEDDING_DIMENSIONS;
    }
  });

  test('OPENAI_EMBEDDING_DIMENSIONS env var overrides preset dimensions', async () => {
    vi.resetModules();

    process.env.OPENAI_EMBEDDING_DIMENSIONS = '1024';

    vi.doMock('../src/openai-client', () => ({
      OpenAIClient: vi.fn().mockImplementation(() => ({
        generateEmbedding: vi.fn().mockResolvedValue([new Array(1024).fill(0.1)]),
      })),
    }));

    const mod = await import('../src/openai-embedding-service');
    const service = mod.OpenAIEmbeddingService.getInstance();

    expect(service.getDimensions()).toBe(1024);
    expect(service.getModelInfo().dimensions).toBe(1024);
  });

  test('uses preset dimensions when OPENAI_EMBEDDING_DIMENSIONS is not set', async () => {
    vi.resetModules();

    delete process.env.OPENAI_EMBEDDING_DIMENSIONS;

    vi.doMock('../src/openai-client', () => ({
      OpenAIClient: vi.fn().mockImplementation(() => ({
        generateEmbedding: vi.fn().mockResolvedValue([new Array(768).fill(0.1)]),
      })),
    }));

    const mod = await import('../src/openai-embedding-service');
    const service = mod.OpenAIEmbeddingService.getInstance();

    expect(service.getDimensions()).toBe(768);
  });
});
