// ABOUTME: Embedding service compatible with private-journal-mcp for semantic search
// ABOUTME: Provides text processing and vector generation using existing AI memory infrastructure

import { EmbeddingData } from './private-journal-types';

export class EmbeddingService {
  private static instance: EmbeddingService;

  private constructor() {}

  static getInstance(): EmbeddingService {
    if (!EmbeddingService.instance) {
      EmbeddingService.instance = new EmbeddingService();
    }
    return EmbeddingService.instance;
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
    // Mock embedding generation for now - in real implementation this would
    // integrate with the ai-memory-distillation embedding pipeline
    if (text.trim().length === 0) {
      return [];
    }
    
    // Generate a deterministic mock embedding based on text content
    const chars = text.toLowerCase();
    const embedding = new Array(384).fill(0); // BGE-large-en-v1.5 dimension
    
    for (let i = 0; i < chars.length && i < embedding.length; i++) {
      embedding[i] = (chars.charCodeAt(i) / 255.0) * 2 - 1; // Normalize to [-1, 1]
    }
    
    // Add some variation based on text length
    const lengthFactor = Math.sin(text.length / 100.0);
    for (let i = 0; i < embedding.length; i++) {
      embedding[i] += lengthFactor * 0.1;
      embedding[i] = Math.max(-1, Math.min(1, embedding[i])); // Clamp to [-1, 1]
    }
    
    return embedding;
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
}