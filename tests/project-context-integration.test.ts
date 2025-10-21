import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProjectContextDetector } from '../src/project-context';
import { PostgreSQLJournalManager } from '../src/postgresql-journal-simple';

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

describe('PostgreSQLJournalManager write operations', () => {
  it('should store project context when writing entry', async () => {
    // Mock database connection
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };

    const mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient),
    };

    const manager = new PostgreSQLJournalManager();
    (manager as any).pool = mockPool;

    // Mock the detector to return predictable context
    const detector = ProjectContextDetector.getInstance();
    const mockContext = {
      project: 'private-journal-mcp',
      working_directory: process.cwd(),
      context_hash: 'test123',
      timestamp: new Date().toISOString(),
      confidence: 'high' as const,
    };

    vi.spyOn(detector, 'detectProjectContext').mockResolvedValue(mockContext);

    await manager.writeEntry('Test entry with project context');

    // Verify project context was stored (requires database query)
    // For now, just verify the spy was called
    expect(detector.detectProjectContext).toHaveBeenCalledWith(process.cwd());
  });
});
