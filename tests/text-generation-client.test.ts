// ABOUTME: Tests for the OpenAI-compatible text generation client
// ABOUTME: Verifies request format, response handling, error cases, and health checks

import { vi, describe, test, expect, afterEach } from 'vitest';
import { TextGenerationClient } from '../src/text-generation-client';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

afterEach(() => {
  vi.clearAllMocks();
});

describe('TextGenerationClient', () => {
  describe('constructor', () => {
    test('uses provided config values', () => {
      const client = new TextGenerationClient({
        baseUrl: 'http://test:1234/v1',
        model: 'test-model',
        apiKey: 'test-key',
        timeout: 5000,
      });
      expect(client).toBeDefined();
    });

    test('uses environment variable defaults', () => {
      const originalEnv = { ...process.env };
      process.env.OPENAI_CHAT_BASE_URL = 'http://env-test:5678/v1';
      process.env.OPENAI_CHAT_MODEL = 'env-model';
      process.env.OPENAI_API_KEY = 'env-key';
      const client = new TextGenerationClient();
      expect(client).toBeDefined();
      process.env = originalEnv;
    });
  });

  describe('generate', () => {
    test('sends correct request format', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"title": "test"}' } }],
        }),
      });
      const client = new TextGenerationClient({
        baseUrl: 'http://test:1234/v1',
        model: 'test-model',
      });
      await client.generate('test prompt');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://test:1234/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        }),
      );
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.model).toBe('test-model');
      expect(body.messages).toEqual([{ role: 'user', content: 'test prompt' }]);
      expect(body.temperature).toBe(0.3);
      expect(body.max_tokens).toBe(2048);
    });

    test('returns generated text content', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'generated text' } }],
        }),
      });
      const client = new TextGenerationClient({
        baseUrl: 'http://test:1234/v1',
        model: 'test-model',
      });
      const result = await client.generate('prompt');
      expect(result).toBe('generated text');
    });

    test('uses custom temperature and maxTokens', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'result' } }],
        }),
      });
      const client = new TextGenerationClient({
        baseUrl: 'http://test:1234/v1',
        model: 'test-model',
      });
      await client.generate('prompt', { temperature: 0.8, maxTokens: 2048 });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.temperature).toBe(0.8);
      expect(body.max_tokens).toBe(2048);
    });

    test('throws on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });
      const client = new TextGenerationClient({
        baseUrl: 'http://test:1234/v1',
        model: 'test-model',
      });
      await expect(client.generate('prompt')).rejects.toThrow('Text generation API error (500)');
    });

    test('throws on empty choices', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [] }),
      });
      const client = new TextGenerationClient({
        baseUrl: 'http://test:1234/v1',
        model: 'test-model',
      });
      await expect(client.generate('prompt')).rejects.toThrow('No response content');
    });

    test('includes response_format when provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"result": true}' } }],
        }),
      });
      const client = new TextGenerationClient({
        baseUrl: 'http://test:1234/v1',
        model: 'test-model',
      });
      await client.generate('prompt', { responseFormat: { type: 'json_object' } });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.response_format).toEqual({ type: 'json_object' });
    });

    test('excludes response_format when not provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'result' } }],
        }),
      });
      const client = new TextGenerationClient({
        baseUrl: 'http://test:1234/v1',
        model: 'test-model',
      });
      await client.generate('prompt');
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.response_format).toBeUndefined();
    });
  });

  describe('getModel', () => {
    test('returns the configured model name', () => {
      const client = new TextGenerationClient({
        model: 'my-custom-model',
      });
      expect(client.getModel()).toBe('my-custom-model');
    });
  });

  describe('healthCheck', () => {
    test('returns true on ok response', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      const client = new TextGenerationClient({
        baseUrl: 'http://test:1234/v1',
        model: 'test-model',
      });
      expect(await client.healthCheck()).toBe(true);
    });

    test('returns false on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const client = new TextGenerationClient({
        baseUrl: 'http://test:1234/v1',
        model: 'test-model',
      });
      expect(await client.healthCheck()).toBe(false);
    });
  });
});
