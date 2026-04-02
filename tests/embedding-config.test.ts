// ABOUTME: Tests for embedding model configuration resolution
// ABOUTME: Verifies preset lookup, env var fallback, and unknown model handling

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { getModelConfig, MODEL_CONFIGS } from '../src/embedding-config';

describe('getModelConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.OPENAI_EMBEDDING_MODEL;
    delete process.env.OPENAI_EMBEDDING_DIMENSIONS;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test('returns nomic-embed-text preset when requested by name', () => {
    const config = getModelConfig('nomic-embed-text');

    expect(config.model).toBe('nomic-embed-text');
    expect(config.dimensions).toBe(768);
    expect(config.documentPrefix).toBe('search_document: ');
    expect(config.queryPrefix).toBe('search_query: ');
    expect(config.defaultMinRelevance).toBe(0.6);
    expect(config.maxInputChars).toBe(6000);
  });

  test('returns qwen3-embedding:4b preset when requested by name', () => {
    const config = getModelConfig('qwen3-embedding:4b');

    expect(config.model).toBe('qwen3-embedding:4b');
    expect(config.dimensions).toBe(768);
    expect(config.documentPrefix).toBe('');
    expect(config.queryPrefix).toContain('Instruct:');
    expect(config.queryPrefix).toContain('Query: ');
    expect(config.defaultMinRelevance).toBe(0.40);
    expect(config.maxInputChars).toBe(16000);
  });

  test('returns generic fallback for unknown model and logs warning', () => {
    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const config = getModelConfig('totally-unknown-model');

    expect(config.model).toBe('totally-unknown-model');
    expect(config.dimensions).toBe(768);
    expect(config.documentPrefix).toBe('');
    expect(config.queryPrefix).toBe('');
    expect(config.defaultMinRelevance).toBe(0.6);
    expect(config.maxInputChars).toBe(6000);

    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('Unknown embedding model "totally-unknown-model"')
    );

    stderrSpy.mockRestore();
  });

  test('reads model name from OPENAI_EMBEDDING_MODEL env var when no argument given', () => {
    process.env.OPENAI_EMBEDDING_MODEL = 'qwen3-embedding:4b';

    const config = getModelConfig();

    expect(config.model).toBe('qwen3-embedding:4b');
    expect(config.dimensions).toBe(768);
    expect(config.maxInputChars).toBe(16000);
  });

  test('defaults to nomic-embed-text when no argument and no env var', () => {
    const config = getModelConfig();

    expect(config.model).toBe('nomic-embed-text');
    expect(config.dimensions).toBe(768);
  });

  test('unknown model uses OPENAI_EMBEDDING_DIMENSIONS env var for fallback dimensions', () => {
    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    process.env.OPENAI_EMBEDDING_DIMENSIONS = '1024';

    const config = getModelConfig('custom-model');

    expect(config.dimensions).toBe(1024);

    stderrSpy.mockRestore();
  });

  test('unknown model with invalid OPENAI_EMBEDDING_DIMENSIONS falls back to 768', () => {
    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    process.env.OPENAI_EMBEDDING_DIMENSIONS = 'not-a-number';

    const config = getModelConfig('custom-model');

    expect(config.dimensions).toBe(768);

    stderrSpy.mockRestore();
  });

  test('explicit model name argument takes priority over env var', () => {
    process.env.OPENAI_EMBEDDING_MODEL = 'qwen3-embedding:4b';

    const config = getModelConfig('nomic-embed-text');

    expect(config.model).toBe('nomic-embed-text');
  });

  test('strips :latest suffix to match preset', () => {
    const config = getModelConfig('nomic-embed-text:latest');

    expect(config.model).toBe('nomic-embed-text');
    expect(config.dimensions).toBe(768);
    expect(config.documentPrefix).toBe('search_document: ');
  });

  test('does not strip non-latest tags from model name', () => {
    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const config = getModelConfig('nomic-embed-text:v1.5');

    expect(config.model).toBe('nomic-embed-text:v1.5');
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('Unknown embedding model "nomic-embed-text:v1.5"')
    );

    stderrSpy.mockRestore();
  });

  test('MODEL_CONFIGS contains both known presets', () => {
    expect(Object.keys(MODEL_CONFIGS)).toContain('nomic-embed-text');
    expect(Object.keys(MODEL_CONFIGS)).toContain('qwen3-embedding:4b');
  });
});
