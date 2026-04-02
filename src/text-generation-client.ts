// ABOUTME: OpenAI-compatible chat completions client for text generation
// ABOUTME: Used by the distillation service to extract structured insights from journal entries

export interface TextGenerationConfig {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  timeout?: number;
  thinking?: boolean;
}

export class TextGenerationClient {
  private baseUrl: string;
  private model: string;
  private apiKey: string;
  private timeout: number;
  private thinking: boolean;

  constructor(config: TextGenerationConfig = {}) {
    this.baseUrl = config.baseUrl || process.env.OPENAI_CHAT_BASE_URL || 'http://localhost:11434/v1';
    this.model = config.model || process.env.OPENAI_CHAT_MODEL || 'qwen3.5:32k';
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY || '';
    this.timeout = config.timeout || 120000;
    this.thinking = config.thinking ?? (process.env.OPENAI_CHAT_THINKING !== 'false');
  }

  getModel(): string {
    return this.model;
  }

  async generate(prompt: string, options?: {
    temperature?: number;
    maxTokens?: number;
    responseFormat?: { type: 'text' | 'json_object' | 'json_schema' };
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
          max_tokens: options?.maxTokens ?? 2048,
          ...(options?.responseFormat && { response_format: options.responseFormat }),
          ...(!this.thinking && { reasoning_effort: 'none' as const }),
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
