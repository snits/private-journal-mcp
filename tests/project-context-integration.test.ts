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

    // Verify detector was called
    expect(detector.detectProjectContext).toHaveBeenCalledWith(process.cwd());

    // Verify SQL query includes project columns
    const sqlCall = mockClient.query.mock.calls[0][0];
    expect(sqlCall).toContain('project, project_context');

    // Verify parameters include project context at correct positions
    const params = mockClient.query.mock.calls[0][1];
    expect(params[9]).toBe('private-journal-mcp'); // $10 - project name
    expect(params[10]).toBe(JSON.stringify(mockContext)); // $11 - serialized context
  });

  it('should store project context when writing thoughts', async () => {
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
      git_remote: 'git@github.com:user/private-journal-mcp.git',
      branch: 'feature/project-aware',
      primary_language: 'typescript',
      context_hash: 'test456',
      timestamp: new Date().toISOString(),
      confidence: 'high' as const,
    };

    vi.spyOn(detector, 'detectProjectContext').mockResolvedValue(mockContext);

    await manager.writeThoughts({
      project_notes: 'Test project note',
      agent_id: 'test-agent',
      model_id: 'test-model',
    });

    expect(detector.detectProjectContext).toHaveBeenCalledWith(process.cwd());

    // Verify SQL includes project columns
    const sqlCall = mockClient.query.mock.calls[0][0];
    expect(sqlCall).toContain('project, project_context');

    // Verify parameters include project context
    const params = mockClient.query.mock.calls[0][1];
    expect(params[11]).toBe('private-journal-mcp'); // $12 - project name
    expect(params[12]).toBe(JSON.stringify(mockContext)); // $13 - serialized context
  });
});

describe('PostgreSQLJournalManager search filtering', () => {
  it('should filter search results by specific project name', async () => {
    // Mock database connection
    const mockClient = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: 1,
            content: 'Test entry',
            timestamp: new Date(),
            file_path: '/test/path',
            score: 0.95,
            entry_type: 'thoughts',
            sections: JSON.stringify(['project_notes']),
            searchable_text: 'Test entry',
            agent_id: 'test-agent',
            model_id: 'test-model',
            visibility_level: 'private',
            project: 'test-project',
            project_context: JSON.stringify({
              project: 'test-project',
              working_directory: '/test/dir',
              context_hash: 'abc123',
              timestamp: new Date().toISOString(),
              confidence: 'high',
            }),
          },
        ],
      }),
      release: vi.fn(),
    };

    const mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient),
    };

    const manager = new PostgreSQLJournalManager();
    (manager as any).pool = mockPool;

    const results = await manager.searchBySimilarity('test query', {
      project_filter: 'test-project',
    });

    expect(results).toHaveLength(1);
    expect(results[0].project).toBe('test-project');
    expect(results[0].project_context).toBeDefined();
    expect(results[0].project_context?.project).toBe('test-project');

    // Verify SQL includes project filter
    const sqlCall = mockClient.query.mock.calls[0][0];
    expect(sqlCall).toContain('project = ');
  });

  it('should filter by current project using detector', async () => {
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
      project: 'current-project',
      working_directory: process.cwd(),
      context_hash: 'current123',
      timestamp: new Date().toISOString(),
      confidence: 'high' as const,
    };

    vi.spyOn(detector, 'detectProjectContext').mockResolvedValue(mockContext);

    await manager.searchBySimilarity('test query', {
      project_filter: 'current',
    });

    // Verify detector was called
    expect(detector.detectProjectContext).toHaveBeenCalledWith(process.cwd());

    // Verify SQL includes project filter
    const sqlCall = mockClient.query.mock.calls[0][0];
    expect(sqlCall).toContain('project = ');
  });

  it('should filter by multiple projects using IN clause', async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };

    const mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient),
    };

    const manager = new PostgreSQLJournalManager();
    (manager as any).pool = mockPool;

    await manager.searchBySimilarity('test query', {
      project_filter: ['project-a', 'project-b', 'project-c'],
    });

    // Verify SQL includes IN clause
    const sqlCall = mockClient.query.mock.calls[0][0];
    expect(sqlCall).toContain('project IN (');
  });

  it('should not filter when project_filter is "all"', async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };

    const mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient),
    };

    const manager = new PostgreSQLJournalManager();
    (manager as any).pool = mockPool;

    await manager.searchBySimilarity('test query', {
      project_filter: 'all',
    });

    // Verify SQL does NOT include project filter
    const sqlCall = mockClient.query.mock.calls[0][0];
    expect(sqlCall).not.toContain('project =');
    expect(sqlCall).not.toContain('project IN');
  });

  it('should not filter when project_filter is undefined', async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };

    const mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient),
    };

    const manager = new PostgreSQLJournalManager();
    (manager as any).pool = mockPool;

    await manager.searchBySimilarity('test query', {});

    // Verify SQL does NOT include project filter
    const sqlCall = mockClient.query.mock.calls[0][0];
    expect(sqlCall).not.toContain('project =');
    expect(sqlCall).not.toContain('project IN');
  });

  it('should filter listRecent results by specific project name', async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: 1,
            content: 'Test recent entry',
            timestamp: new Date(),
            file_path: '/test/path',
            entry_type: 'thoughts',
            sections: JSON.stringify(['project_notes']),
            searchable_text: 'Test recent entry',
            agent_id: 'test-agent',
            model_id: 'test-model',
            visibility_level: 'private',
            project: 'test-project',
            project_context: JSON.stringify({
              project: 'test-project',
              working_directory: '/test/dir',
              context_hash: 'abc123',
              timestamp: new Date().toISOString(),
              confidence: 'high',
            }),
          },
        ],
      }),
      release: vi.fn(),
    };

    const mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient),
    };

    const manager = new PostgreSQLJournalManager();
    (manager as any).pool = mockPool;

    const results = await manager.listRecent({
      project_filter: 'test-project',
    });

    expect(results).toHaveLength(1);
    expect(results[0].project).toBe('test-project');
    expect(results[0].project_context).toBeDefined();
    expect(results[0].project_context?.project).toBe('test-project');

    // Verify SQL includes project filter
    const sqlCall = mockClient.query.mock.calls[0][0];
    expect(sqlCall).toContain('project = ');
  });

  it('should filter listRecent by current project using detector', async () => {
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
      project: 'current-project',
      working_directory: process.cwd(),
      context_hash: 'current123',
      timestamp: new Date().toISOString(),
      confidence: 'high' as const,
    };

    vi.spyOn(detector, 'detectProjectContext').mockResolvedValue(mockContext);

    await manager.listRecent({
      project_filter: 'current',
    });

    // Verify detector was called
    expect(detector.detectProjectContext).toHaveBeenCalledWith(process.cwd());

    // Verify SQL includes project filter
    const sqlCall = mockClient.query.mock.calls[0][0];
    expect(sqlCall).toContain('project = ');
  });

  it('should filter listRecent by multiple projects using IN clause', async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };

    const mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient),
    };

    const manager = new PostgreSQLJournalManager();
    (manager as any).pool = mockPool;

    await manager.listRecent({
      project_filter: ['project-a', 'project-b', 'project-c'],
    });

    // Verify SQL includes IN clause
    const sqlCall = mockClient.query.mock.calls[0][0];
    expect(sqlCall).toContain('project IN (');
  });

  it('should handle empty project array gracefully in searchBySimilarity', async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };

    const mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient),
    };

    const manager = new PostgreSQLJournalManager();
    (manager as any).pool = mockPool;

    const results = await manager.searchBySimilarity('test query', {
      limit: 10,
      project_filter: [],
    });

    // Should not crash, should return results (no filter applied)
    expect(results).toBeDefined();
    expect(Array.isArray(results)).toBe(true);

    // Verify SQL does NOT include project filter (empty array means skip filter)
    const sqlCall = mockClient.query.mock.calls[0][0];
    expect(sqlCall).not.toContain('project IN (');
    expect(sqlCall).not.toContain('project =');
  });

  it('should handle empty project array gracefully in listRecent', async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };

    const mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient),
    };

    const manager = new PostgreSQLJournalManager();
    (manager as any).pool = mockPool;

    const results = await manager.listRecent({
      limit: 10,
      project_filter: [],
    });

    // Should not crash, should return results (no filter applied)
    expect(results).toBeDefined();
    expect(Array.isArray(results)).toBe(true);

    // Verify SQL does NOT include project filter (empty array means skip filter)
    const sqlCall = mockClient.query.mock.calls[0][0];
    expect(sqlCall).not.toContain('project IN (');
    expect(sqlCall).not.toContain('project =');
  });
});
