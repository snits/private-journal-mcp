// Global test setup
// Mock the transformers library to avoid loading heavy ML models in tests
import { vi } from 'vitest';

vi.mock('@xenova/transformers', () => ({
  pipeline: vi.fn().mockResolvedValue(
    vi.fn().mockResolvedValue({
      data: new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]) // Mock embedding vector
    })
  ),
}));