// ABOUTME: OpenAI-compatible embedding service for semantic journal search
// ABOUTME: Supports batching, configurable models, and OpenAI-compatible endpoints

import { OpenAIClient } from './openai-client';
import { getModelConfig, EmbeddingModelConfig } from './embedding-config';

export class OpenAIEmbeddingService {
  private static instance: OpenAIEmbeddingService;
  private client: OpenAIClient;
  private readonly modelName: string;
  private readonly dimensions: number;
  private readonly modelConfig: EmbeddingModelConfig;

  private constructor() {
    // Resolve model config from presets
    this.modelConfig = getModelConfig();
    this.modelName = this.modelConfig.model;

    // OPENAI_EMBEDDING_DIMENSIONS env var overrides the preset if explicitly set
    const dimensionsEnv = process.env.OPENAI_EMBEDDING_DIMENSIONS;
    if (dimensionsEnv !== undefined) {
      const parsed = parseInt(dimensionsEnv, 10);
      if (isNaN(parsed) || parsed <= 0) {
        throw new Error(
          `Invalid OPENAI_EMBEDDING_DIMENSIONS: "${dimensionsEnv}". Must be a positive integer.`
        );
      }
      this.dimensions = parsed;
    } else {
      this.dimensions = this.modelConfig.dimensions;
    }

    // Initialize OpenAI client
    this.client = new OpenAIClient({
      baseUrl: process.env.OPENAI_EMBEDDING_BASE_URL,
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 30000,
      concurrency: 3,
    });

    console.error(
      `Initialized OpenAI embedding service: model=${this.modelName}, dimensions=${this.dimensions}`
    );
  }

  static getInstance(): OpenAIEmbeddingService {
    if (!OpenAIEmbeddingService.instance) {
      OpenAIEmbeddingService.instance = new OpenAIEmbeddingService();
    }
    return OpenAIEmbeddingService.instance;
  }

  extractSearchableText(content: string): { text: string; sections: string[] } {
    // Remove frontmatter
    const contentWithoutFrontmatter = content.replace(/^---[\s\S]*?---\n/, '');

    // Extract sections (markdown headers)
    const sections: string[] = [];
    const headerRegex = /^## (.+)$/gm;
    let match;

    while ((match = headerRegex.exec(contentWithoutFrontmatter)) !== null) {
      sections.push(match[1].trim());
    }

    // Clean text for embedding
    const text = contentWithoutFrontmatter
      .replace(/^#+\s+/gm, '') // Remove markdown headers
      .replace(/\*\*(.*?)\*\*/g, '$1') // Remove bold
      .replace(/\*(.*?)\*/g, '$1') // Remove italic
      .replace(/`(.*?)`/g, '$1') // Remove code
      .replace(/\n+/g, ' ') // Replace newlines with spaces
      .trim();

    return { text, sections };
  }

  async generateEmbedding(text: string): Promise<number[]> {
    if (text.trim().length === 0) {
      return [];
    }

    try {
      // Truncate text to respect model token limit
      const maxChars = this.modelConfig.maxInputChars;
      const truncatedText = text.length > maxChars ? text.substring(0, maxChars) : text;

      const embeddings = await this.client.generateEmbedding([truncatedText], this.modelName, this.dimensions);

      if (!embeddings || embeddings.length === 0) {
        throw new Error('API returned no embeddings');
      }

      return embeddings[0];
    } catch (error) {
      console.error('Failed to generate embedding:', error);
      throw error;
    }
  }

  async generateDocumentEmbedding(text: string): Promise<number[]> {
    return this.generateEmbedding(this.modelConfig.documentPrefix + text);
  }

  async generateQueryEmbedding(text: string): Promise<number[]> {
    return this.generateEmbedding(this.modelConfig.queryPrefix + text);
  }

  async generateDocumentBatch(texts: string[]): Promise<number[][]> {
    return this.generateBatch(texts.map(t => this.modelConfig.documentPrefix + t));
  }

  async generateBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    try {
      // Truncate individual texts to respect model token limit
      const maxTextChars = this.modelConfig.maxInputChars;
      const truncatedTexts = texts.map((text) =>
        text.length > maxTextChars ? text.substring(0, maxTextChars) : text
      );

      // Batch splitting with safety margin (80% of token limit).
      // For models with large maxInputChars (e.g. qwen3 at 16000), this produces
      // single-document sub-batches, which is acceptable at this codebase's scale.
      const maxBatchChars = Math.floor(this.modelConfig.maxInputChars * 0.8);

      // If batch is small enough, send it all at once
      const totalChars = truncatedTexts.reduce((sum, text) => sum + text.length, 0);
      if (totalChars <= maxBatchChars) {
        return await this.client.generateEmbedding(truncatedTexts, this.modelName, this.dimensions);
      }

      // Split into smaller sub-batches
      const subBatches: string[][] = [];
      let currentBatch: string[] = [];
      let currentBatchChars = 0;

      for (const text of truncatedTexts) {
        const textLength = text.length;

        // If adding this text would exceed limit, start a new batch
        if (currentBatchChars + textLength > maxBatchChars && currentBatch.length > 0) {
          subBatches.push(currentBatch);
          currentBatch = [];
          currentBatchChars = 0;
        }

        currentBatch.push(text);
        currentBatchChars += textLength;
      }

      // Add final batch
      if (currentBatch.length > 0) {
        subBatches.push(currentBatch);
      }

      console.error(
        `Processing ${truncatedTexts.length} texts in ${subBatches.length} sub-batches`
      );

      // Process all sub-batches and combine results
      const allEmbeddings: number[][] = [];
      for (let i = 0; i < subBatches.length; i++) {
        const subBatch = subBatches[i];
        console.error(`  Batch ${i + 1}/${subBatches.length}: ${subBatch.length} texts`);
        const embeddings = await this.client.generateEmbedding(subBatch, this.modelName, this.dimensions);
        allEmbeddings.push(...embeddings);
      }

      return allEmbeddings;
    } catch (error) {
      console.error('Failed to generate batch embeddings:', error);
      throw error;
    }
  }

  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) {
      return 0;
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) {
      return 0;
    }

    return dotProduct / denominator;
  }

  getModelInfo(): { name: string; dimensions: number } {
    return {
      name: this.modelName,
      dimensions: this.dimensions,
    };
  }

  getDimensions(): number {
    return this.dimensions;
  }

  async verifyCompatibility(
    testText = 'This is a test document for embedding compatibility.'
  ): Promise<boolean> {
    try {
      const embedding = await this.generateEmbedding(testText);

      if (!embedding || embedding.length !== this.dimensions) {
        console.error(
          `Compatibility check failed: Expected dimensions ${this.dimensions}, but got ${embedding?.length ?? 0}`
        );
        return false;
      }

      console.error(
        `Compatibility check passed: Dimensions ${embedding.length}/${this.dimensions} ✅`
      );
      return true;
    } catch (error) {
      console.error('Compatibility check failed:', error);
      return false;
    }
  }
}
