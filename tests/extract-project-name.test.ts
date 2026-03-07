// ABOUTME: Unit tests for extractProjectNameFromRemote edge cases
// ABOUTME: Covers trailing slashes, SCP-style URLs, and remote fallback logic

import { describe, it, expect, beforeEach } from 'vitest';
import { ProjectContextDetector } from '../src/project-context';

describe('extractProjectNameFromRemote', () => {
  let detector: ProjectContextDetector;

  beforeEach(() => {
    detector = ProjectContextDetector.getInstance();
    detector.clearCache();
  });

  // Access private method for unit testing
  function extractName(url: string): string {
    return (detector as any).extractProjectNameFromRemote(url);
  }

  it('should handle trailing slash in SCP-style URL', () => {
    // This is the actual bug: mac origin remote has trailing slash
    expect(extractName('jsnitsel@cantor:/home/jsnitsel/claudes-home/')).toBe('claudes-home');
  });

  it('should handle trailing slash in HTTPS URL', () => {
    expect(extractName('https://github.com/snits/private-journal-mcp/')).toBe('private-journal-mcp');
  });

  it('should handle standard HTTPS GitHub URL', () => {
    expect(extractName('https://github.com/snits/private-journal-mcp.git')).toBe('private-journal-mcp');
  });

  it('should handle standard SSH GitHub URL', () => {
    expect(extractName('git@github.com:snits/private-journal-mcp.git')).toBe('private-journal-mcp');
  });

  it('should handle HTTPS URL without .git suffix', () => {
    expect(extractName('https://github.com/snits/private-journal-mcp')).toBe('private-journal-mcp');
  });

  it('should handle SCP-style local network URL without trailing slash', () => {
    expect(extractName('jsnitsel@cantor:/home/jsnitsel/claudes-home')).toBe('claudes-home');
  });

  it('should handle multiple trailing slashes', () => {
    expect(extractName('jsnitsel@cantor:/home/jsnitsel/claudes-home///')).toBe('claudes-home');
  });
});
