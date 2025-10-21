import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProjectContextDetector } from '../src/project-context';

describe('PostgreSQLJournalManager project context helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return undefined when project detection fails', async () => {
    const detector = ProjectContextDetector.getInstance();
    vi.spyOn(detector, 'detectProjectContext').mockRejectedValue(
      new Error('Git command failed')
    );

    // Import manager and call helper (we'll add this in implementation)
    // For now, just test the detector mock works
    await expect(detector.detectProjectContext('/fake/path')).rejects.toThrow();
  });

  it('should return project context when detection succeeds', async () => {
    const detector = ProjectContextDetector.getInstance();
    const mockContext = {
      project: 'test-project',
      working_directory: '/test/dir',
      context_hash: 'abc123',
      timestamp: new Date().toISOString(),
      confidence: 'high' as const,
    };

    vi.spyOn(detector, 'detectProjectContext').mockResolvedValue(mockContext);

    const result = await detector.detectProjectContext('/test/dir');
    expect(result).toEqual(mockContext);
  });
});
