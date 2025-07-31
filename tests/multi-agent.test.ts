// ABOUTME: Tests for multi-agent, multi-model journal functionality
// ABOUTME: Validates agent identity tracking, visibility levels, and file organization

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { JournalManager } from '../src/journal';

function getFormattedDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

describe('Multi-Agent Journal Functionality', () => {
  let projectTempDir: string;
  let userTempDir: string;
  let journalManager: JournalManager;

  beforeEach(async () => {
    projectTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'multi-agent-test-'));
    userTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'multi-agent-user-test-'));
    journalManager = new JournalManager(projectTempDir, userTempDir);
  });

  afterEach(async () => {
    await fs.rm(projectTempDir, { recursive: true, force: true });
    await fs.rm(userTempDir, { recursive: true, force: true });
  });

  test('writes agent metadata to markdown frontmatter', async () => {
    await journalManager.writeThoughts({
      technical_insights: 'This architectural pattern is working well.',
      agent_id: 'claude-general',
      model_id: 'claude-sonnet-4',
      visibility_level: 'public'
    });

    const dateString = getFormattedDate(new Date());
    const userDayDir = path.join(userTempDir, 'claude-sonnet-4', 'claude-general', 'public', dateString);
    
    // Check that directory structure was created
    expect(await fs.access(userDayDir).then(() => true).catch(() => false)).toBe(true);

    const files = await fs.readdir(userDayDir);
    const mdFiles = files.filter(f => f.endsWith('.md'));
    expect(mdFiles.length).toBe(1);

    const content = await fs.readFile(path.join(userDayDir, mdFiles[0]), 'utf8');
    
    // Check frontmatter contains agent metadata
    expect(content).toContain('agent_id: claude-general');
    expect(content).toContain('model_id: claude-sonnet-4');
    expect(content).toContain('visibility_level: public');
    
    // Check content section
    expect(content).toContain('## Technical Insights');
    expect(content).toContain('This architectural pattern is working well.');
  });

  test('organizes files by agent and model hierarchy', async () => {
    // Write entries from different agents/models
    await journalManager.writeThoughts({
      project_notes: 'Code review findings for authentication module.',
      agent_id: 'code-reviewer',
      model_id: 'claude-sonnet-4',
      visibility_level: 'team'
    });

    await journalManager.writeThoughts({
      project_notes: 'Performance bottleneck identified in database queries.',
      agent_id: 'debug-specialist', 
      model_id: 'gpt-4o',
      visibility_level: 'private'
    });

    const dateString = getFormattedDate(new Date());
    
    // Check Claude code-reviewer files
    const claudeCodeReviewerDir = path.join(projectTempDir, 'claude-sonnet-4', 'code-reviewer', 'team', dateString);
    expect(await fs.access(claudeCodeReviewerDir).then(() => true).catch(() => false)).toBe(true);
    
    const claudeFiles = await fs.readdir(claudeCodeReviewerDir);
    expect(claudeFiles.filter(f => f.endsWith('.md')).length).toBe(1);

    // Check GPT debug-specialist files  
    const gptDebugDir = path.join(projectTempDir, 'gpt-4o', 'debug-specialist', 'private', dateString);
    expect(await fs.access(gptDebugDir).then(() => true).catch(() => false)).toBe(true);
    
    const gptFiles = await fs.readdir(gptDebugDir);
    expect(gptFiles.filter(f => f.endsWith('.md')).length).toBe(1);
  });

  test('maintains backward compatibility when no agent metadata provided', async () => {
    await journalManager.writeThoughts({
      project_notes: 'Legacy journal entry without agent metadata.'
    });

    const dateString = getFormattedDate(new Date());
    // Should use original path structure
    const dayDir = path.join(projectTempDir, dateString);
    
    expect(await fs.access(dayDir).then(() => true).catch(() => false)).toBe(true);
    
    const files = await fs.readdir(dayDir);
    const mdFiles = files.filter(f => f.endsWith('.md'));
    expect(mdFiles.length).toBe(1);

    const content = await fs.readFile(path.join(dayDir, mdFiles[0]), 'utf8');
    expect(content).toContain('agent_id: unknown');
    expect(content).toContain('model_id: unknown');
    expect(content).toContain('visibility_level: private');
  });

  test('defaults to private visibility when not specified', async () => {
    await journalManager.writeThoughts({
      feelings: 'Feeling confused about this implementation approach.',
      agent_id: 'debug-specialist',
      model_id: 'claude-sonnet-4'
      // visibility_level not specified
    });

    const dateString = getFormattedDate(new Date());
    const userDir = path.join(userTempDir, 'claude-sonnet-4', 'debug-specialist', 'private', dateString);
    
    expect(await fs.access(userDir).then(() => true).catch(() => false)).toBe(true);
    
    const files = await fs.readdir(userDir);
    const mdFiles = files.filter(f => f.endsWith('.md'));
    expect(mdFiles.length).toBe(1);

    const content = await fs.readFile(path.join(userDir, mdFiles[0]), 'utf8');
    expect(content).toContain('visibility_level: private');
  });

  test('handles different visibility levels correctly', async () => {
    const testCases = [
      { level: 'private', content: 'Private debugging thoughts' },
      { level: 'public', content: 'Architectural insight worth sharing' }, 
      { level: 'team', content: 'Implementation team coordination' },
      { level: 'crb', content: 'Change Review Board documentation' }
    ];

    for (const testCase of testCases) {
      await journalManager.writeThoughts({
        technical_insights: testCase.content,
        agent_id: 'systems-architect',
        model_id: 'claude-sonnet-4',
        visibility_level: testCase.level as any
      });
    }

    const dateString = getFormattedDate(new Date());
    
    // Verify each visibility level created its own directory
    for (const testCase of testCases) {
      const visibilityDir = path.join(userTempDir, 'claude-sonnet-4', 'systems-architect', testCase.level, dateString);
      expect(await fs.access(visibilityDir).then(() => true).catch(() => false)).toBe(true);
      
      const files = await fs.readdir(visibilityDir);
      const mdFiles = files.filter(f => f.endsWith('.md'));
      expect(mdFiles.length).toBe(1);

      const content = await fs.readFile(path.join(visibilityDir, mdFiles[0]), 'utf8');
      expect(content).toContain(testCase.content);
      expect(content).toContain(`visibility_level: ${testCase.level}`);
    }
  });
});