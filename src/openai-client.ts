// ABOUTME: OpenAI-compatible API client for embedding generation
// ABOUTME: Supports configurable base URLs for local models (Ollama, vLLM, etc.)

import PQueue from 'p-queue';

export interface OpenAIClientConfig {
  apiKey?: string;
  baseUrl?: string;
  timeout?: number;
  concurrency?: number;
}

export interface OpenAIEmbeddingRequest {
  input: string | string[];
  model: string;
  encoding_format?: 'float';
  dimensions?: number;
}

export interface OpenAIEmbeddingResponse {
  object: 'list';
  data: Array<{
    object: 'embedding';
    index: number;
    embedding: number[];
  }>;
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

export class OpenAIClient {
  private baseUrl: string;
  private apiKey: string;
  private timeout: number;
  private queue: PQueue;

  constructor(config: OpenAIClientConfig = {}) {
    this.baseUrl = config.baseUrl || process.env.OPENAI_EMBEDDING_BASE_URL || 'http://localhost:11434/v1';
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY || 'not-needed';
    this.timeout = config.timeout || 30000;
    this.queue = new PQueue({
      concurrency: config.concurrency || 3,
      timeout: this.timeout,
    });
  }

  async generateEmbedding(texts: string[], model: string, dimensions?: number): Promise<number[][]> {
    return this.queue.add(async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      try {
        const request: OpenAIEmbeddingRequest = {
          input: texts,
          model,
          encoding_format: 'float',
          ...(dimensions !== undefined && { dimensions }),
        };

        const response = await fetch(`${this.baseUrl}/embeddings`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(request),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`OpenAI API error (${response.status}): ${errorText}`);
        }

        const data = (await response.json()) as OpenAIEmbeddingResponse;

        // Sort by index to ensure correct order
        const sorted = data.data.sort((a, b) => a.index - b.index);
        return sorted.map((item) => item.embedding);
      } finally {
        clearTimeout(timeoutId);
      }
    }) as Promise<number[][]>;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
