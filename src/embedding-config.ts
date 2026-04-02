// ABOUTME: Embedding model configuration presets and resolution
// ABOUTME: Bundles model-specific parameters (dimensions, prefixes, thresholds) for each supported model

export interface EmbeddingModelConfig {
  model: string;
  dimensions: number;
  documentPrefix: string;
  queryPrefix: string;
  defaultMinRelevance: number;
  maxInputChars: number;
}

export const MODEL_CONFIGS: Record<string, EmbeddingModelConfig> = {
  'nomic-embed-text': {
    model: 'nomic-embed-text',
    dimensions: 768,
    documentPrefix: 'search_document: ',
    queryPrefix: 'search_query: ',
    defaultMinRelevance: 0.6,
    maxInputChars: 6000,
  },
  'qwen3-embedding:4b': {
    model: 'qwen3-embedding:4b',
    dimensions: 768,
    documentPrefix: '',
    queryPrefix:
      'Instruct: Given a personal journal search query, retrieve relevant journal entries\nQuery: ',
    defaultMinRelevance: 0.55,
    maxInputChars: 16000,
  },
};

/**
 * Resolve embedding model configuration.
 *
 * @param modelName - Explicit model name. Falls back to OPENAI_EMBEDDING_MODEL env var.
 * @returns The preset config for known models, or a generic fallback for unknown models.
 */
export function getModelConfig(modelName?: string): EmbeddingModelConfig {
  const resolvedName = modelName || process.env.OPENAI_EMBEDDING_MODEL || 'nomic-embed-text';

  const preset = MODEL_CONFIGS[resolvedName];
  if (preset) {
    return { ...preset };
  }

  // Ollama appends ':latest' as the default tag — try without it
  if (resolvedName.endsWith(':latest')) {
    const baseName = resolvedName.slice(0, -':latest'.length);
    const basePreset = MODEL_CONFIGS[baseName];
    if (basePreset) {
      return { ...basePreset };
    }
  }

  // Unknown model — warn and return generic fallback
  console.error(
    `Warning: Unknown embedding model "${resolvedName}". Using generic fallback config.`
  );

  const fallbackDimensions = parseInt(
    process.env.OPENAI_EMBEDDING_DIMENSIONS || '768',
    10
  );

  return {
    model: resolvedName,
    dimensions: isNaN(fallbackDimensions) || fallbackDimensions <= 0 ? 768 : fallbackDimensions,
    documentPrefix: '',
    queryPrefix: '',
    defaultMinRelevance: 0.6,
    maxInputChars: 6000,
  };
}
