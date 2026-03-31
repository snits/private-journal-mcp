// ABOUTME: OpenAI-compatible chat completions client for text generation
// ABOUTME: Used by the distillation service to extract structured insights from journal entries

export interface TextGenerationConfig {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  timeout?: number;
}

export class TextGenerationClient {
  private baseUrl: string;
  private model: string;
  private apiKey: string;
  private timeout: number;

  constructor(config: TextGenerationConfig = {}) {
    this.baseUrl = config.baseUrl || process.env.TEXT_GEN_BASE_URL || 'http://localhost:11434/v1';
    this.model = config.model || process.env.TEXT_GEN_MODEL || 'llama3.1:8b';
    this.apiKey = config.apiKey || process.env.TEXT_GEN_API_KEY || '';
    this.timeout = config.timeout || 60000;
  }

  async generate(prompt: string, options?: {
    temperature?: number;
    maxTokens?: number;
  }): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey && { Authorization: `Bearer ${this.apiKey}` }),
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: prompt }],
          temperature: options?.temperature ?? 0.3,
          max_tokens: options?.maxTokens ?? 1024,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Text generation API error (${response.status}): ${errorText}`);
      }

      const data: any = await response.json();
      const content = data.choices?.[0]?.message?.content;

      if (!content) {
        throw new Error('No response content from text generation API');
      }

      return content;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        method: 'GET',
        ...(this.apiKey && {
          headers: { Authorization: `Bearer ${this.apiKey}` },
        }),
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
