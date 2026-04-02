// ABOUTME: Tests for OpenAI embedding service prefix and truncation behavior
// ABOUTME: Verifies prefixes and limits are driven by EmbeddingModelConfig

import { vi, describe, test, expect, beforeEach, afterEach } from 'vitest';
import type { OpenAIEmbeddingService } from '../src/openai-embedding-service';

describe('OpenAIEmbeddingService task prefixes (nomic defaults)', () => {
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

  test('generateDocumentEmbedding prepends documentPrefix from config', async () => {
    await service.generateDocumentEmbedding('journal entry about testing');

    expect(mockClientGenerateEmbedding).toHaveBeenCalledWith(
      ['search_document: journal entry about testing'],
      expect.any(String)
    );
  });

  test('generateQueryEmbedding prepends queryPrefix from config', async () => {
    await service.generateQueryEmbedding('find entries about architecture');

    expect(mockClientGenerateEmbedding).toHaveBeenCalledWith(
      ['search_query: find entries about architecture'],
      expect.any(String)
    );
  });

  test('generateDocumentBatch prepends documentPrefix to all texts', async () => {
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

describe('OpenAIEmbeddingService with qwen3 config', () => {
  let service: OpenAIEmbeddingService;
  let mockClientGenerateEmbedding: ReturnType<typeof vi.fn>;
  const savedModel = process.env.OPENAI_EMBEDDING_MODEL;

  beforeEach(async () => {
    vi.resetModules();

    process.env.OPENAI_EMBEDDING_MODEL = 'qwen3-embedding:4b';

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

  afterEach(() => {
    if (savedModel !== undefined) {
      process.env.OPENAI_EMBEDDING_MODEL = savedModel;
    } else {
      delete process.env.OPENAI_EMBEDDING_MODEL;
    }
  });

  test('generateDocumentEmbedding uses empty prefix for qwen3', async () => {
    await service.generateDocumentEmbedding('some document text');

    // qwen3 documentPrefix is '' so the text is passed as-is
    expect(mockClientGenerateEmbedding).toHaveBeenCalledWith(
      ['some document text'],
      expect.any(String)
    );
  });

  test('generateQueryEmbedding uses instruct prefix for qwen3', async () => {
    await service.generateQueryEmbedding('find journal entries');

    const expectedPrefix =
      'Instruct: Given a personal journal search query, retrieve relevant journal entries\nQuery: ';

    expect(mockClientGenerateEmbedding).toHaveBeenCalledWith(
      [expectedPrefix + 'find journal entries'],
      expect.any(String)
    );
  });
});

describe('OpenAIEmbeddingService truncation uses maxInputChars from config', () => {
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

    // Default model (nomic) has maxInputChars=6000
    const mod = await import('../src/openai-embedding-service');
    service = mod.OpenAIEmbeddingService.getInstance();
  });

  test('generateEmbedding truncates at maxInputChars', async () => {
    const longText = 'x'.repeat(7000);
    await service.generateEmbedding(longText);

    const sentText = mockClientGenerateEmbedding.mock.calls[0][0][0];
    // nomic maxInputChars is 6000
    expect(sentText.length).toBe(6000);
  });

  test('generateBatch truncates individual texts at maxInputChars', async () => {
    const longText = 'y'.repeat(7000);
    mockClientGenerateEmbedding.mockResolvedValue([new Array(768).fill(0.1)]);

    await service.generateBatch([longText]);

    const sentText = mockClientGenerateEmbedding.mock.calls[0][0][0];
    expect(sentText.length).toBe(6000);
  });
});

describe('OpenAIEmbeddingService truncation with qwen3 (16000 chars)', () => {
  let service: OpenAIEmbeddingService;
  let mockClientGenerateEmbedding: ReturnType<typeof vi.fn>;
  const savedModel = process.env.OPENAI_EMBEDDING_MODEL;

  beforeEach(async () => {
    vi.resetModules();

    process.env.OPENAI_EMBEDDING_MODEL = 'qwen3-embedding:4b';

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

  afterEach(() => {
    if (savedModel !== undefined) {
      process.env.OPENAI_EMBEDDING_MODEL = savedModel;
    } else {
      delete process.env.OPENAI_EMBEDDING_MODEL;
    }
  });

  test('generateEmbedding allows up to 16000 chars for qwen3', async () => {
    const text = 'z'.repeat(16000);
    await service.generateEmbedding(text);

    const sentText = mockClientGenerateEmbedding.mock.calls[0][0][0];
    expect(sentText.length).toBe(16000);
  });

  test('generateEmbedding truncates at 16000 chars for qwen3', async () => {
    const text = 'z'.repeat(20000);
    await service.generateEmbedding(text);

    const sentText = mockClientGenerateEmbedding.mock.calls[0][0][0];
    expect(sentText.length).toBe(16000);
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
