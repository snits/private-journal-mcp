// ABOUTME: Project context detection for automatic journal entry metadata
// ABOUTME: Prevents cross-project contamination by isolating contexts based on working directory and git state

import * as fs from 'fs/promises';
import * as path from 'path';
import { execSync } from 'child_process';

export interface ProjectContext {
  project: string;
  working_directory: string;
  git_root?: string;
  git_remote?: string;
  branch?: string;
  primary_language?: string;
  context_hash: string;
  timestamp: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface LanguageDetectionResult {
  language: string;
  confidence: number;
  indicators: string[];
}

export class ProjectContextDetector {
  private static instance: ProjectContextDetector;
  private contextCache = new Map<string, ProjectContext>();

  static getInstance(): ProjectContextDetector {
    if (!ProjectContextDetector.instance) {
      ProjectContextDetector.instance = new ProjectContextDetector();
    }
    return ProjectContextDetector.instance;
  }

  async detectProjectContext(workingDir?: string): Promise<ProjectContext> {
    const cwd = workingDir || process.cwd();

    // Check cache first
    if (this.contextCache.has(cwd)) {
      return this.contextCache.get(cwd)!;
    }

    const context = await this.analyzeDirectory(cwd);

    // Cache result for session
    this.contextCache.set(cwd, context);

    return context;
  }

  private async analyzeDirectory(cwd: string): Promise<ProjectContext> {
    let confidence: 'high' | 'medium' | 'low' = 'low';
    let project = 'unknown-project';
    let gitRoot: string | undefined;
    let gitRemote: string | undefined;
    let branch: string | undefined;

    // Try git repository detection first
    try {
      gitRoot = this.findGitRoot(cwd);
      if (gitRoot) {
        gitRemote = this.getGitRemote(gitRoot);
        branch = this.getCurrentBranch(gitRoot);

        if (gitRemote) {
          project = this.extractProjectNameFromRemote(gitRemote);
          confidence = 'high';
        } else if (gitRoot) {
          project = path.basename(gitRoot);
          confidence = 'medium';
        }
      }
    } catch (error) {
      // Git operations failed, continue with directory analysis
    }

    // Fallback to directory name if git analysis didn't work
    if (confidence === 'low') {
      const segments = cwd.split(path.sep).filter((s) => s.length > 0);

      // Look for common project directory patterns
      const projectIndicators = ['devel', 'projects', 'src', 'code', 'work'];
      const projectIndex = segments.findIndex((seg) => projectIndicators.includes(seg));

      if (projectIndex >= 0 && projectIndex < segments.length - 1) {
        project = segments[projectIndex + 1];
        confidence = 'medium';
      } else {
        // Use current directory name
        project = segments[segments.length - 1] || 'root';
        confidence = 'low';
      }
    }

    // Detect primary language
    const primaryLanguage = await this.detectPrimaryLanguage(gitRoot || cwd);

    // Generate context hash for quick comparison
    const contextData = `${project}:${gitRoot}:${gitRemote}:${branch}:${primaryLanguage}`;
    const contextHash = this.generateHash(contextData);

    return {
      project,
      working_directory: cwd,
      git_root: gitRoot,
      git_remote: gitRemote,
      branch,
      primary_language: primaryLanguage,
      context_hash: contextHash,
      timestamp: new Date().toISOString(),
      confidence,
    };
  }

  private findGitRoot(startDir: string): string | undefined {
    let currentDir = startDir;

    while (currentDir !== path.dirname(currentDir)) {
      try {
        const gitDir = path.join(currentDir, '.git');
        // Use synchronous check since this is a simple directory existence check
        const fs_sync = require('fs');
        fs_sync.accessSync(gitDir);
        return currentDir;
      } catch (error) {
        // Continue searching up the directory tree
      }
      currentDir = path.dirname(currentDir);
    }

    return undefined;
  }

  private getGitRemote(gitRoot: string): string | undefined {
    try {
      const output = execSync('git remote get-url origin', {
        cwd: gitRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return output.trim();
    } catch (error) {
      return undefined;
    }
  }

  private getCurrentBranch(gitRoot: string): string | undefined {
    try {
      const output = execSync('git branch --show-current', {
        cwd: gitRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return output.trim();
    } catch (error) {
      return undefined;
    }
  }

  private extractProjectNameFromRemote(remoteUrl: string): string {
    // Handle various remote URL formats
    // https://github.com/user/repo.git -> repo
    // git@github.com:user/repo.git -> repo
    // https://github.com/user/repo -> repo
    // jsnitsel@cantor:/home/jsnitsel/claudes-home/ -> claudes-home

    const url = remoteUrl.replace(/\/+$/, '');

    const patterns = [
      /github\.com[:/][\w-]+\/([\w-]+)(?:\.git)?$/,
      /gitlab\.com[:/][\w-]+\/([\w-]+)(?:\.git)?$/,
      /bitbucket\.org[:/][\w-]+\/([\w-]+)(?:\.git)?$/,
      /[:/]([\w-]+)(?:\.git)?$/, // Generic fallback
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        return match[1];
      }
    }

    // Last resort - extract from URL path
    const urlParts = url.split('/');
    const lastPart = urlParts[urlParts.length - 1];
    return lastPart.replace(/\.git$/, '') || 'unknown-repo';
  }

  private async detectPrimaryLanguage(projectRoot: string): Promise<string> {
    const detectionResults: LanguageDetectionResult[] = [];

    try {
      // Check for specific language indicators
      const files = await fs.readdir(projectRoot);

      // Go detection
      if (files.includes('go.mod') || files.includes('go.sum')) {
        detectionResults.push({
          language: 'go',
          confidence: 0.9,
          indicators: ['go.mod', 'go.sum'],
        });
      }

      // TypeScript/JavaScript detection
      if (files.includes('package.json')) {
        const hasTypeScript =
          files.includes('tsconfig.json') || files.some((f) => f.endsWith('.ts'));
        detectionResults.push({
          language: hasTypeScript ? 'typescript' : 'javascript',
          confidence: hasTypeScript ? 0.8 : 0.7,
          indicators: hasTypeScript ? ['tsconfig.json', '*.ts files'] : ['package.json'],
        });
      }

      // Python detection
      if (
        files.includes('requirements.txt') ||
        files.includes('pyproject.toml') ||
        files.includes('setup.py')
      ) {
        detectionResults.push({
          language: 'python',
          confidence: 0.8,
          indicators: ['requirements.txt', 'pyproject.toml', 'setup.py'],
        });
      }

      // Rust detection
      if (files.includes('Cargo.toml')) {
        detectionResults.push({
          language: 'rust',
          confidence: 0.9,
          indicators: ['Cargo.toml'],
        });
      }

      // Java detection
      if (files.includes('pom.xml') || files.includes('build.gradle')) {
        detectionResults.push({
          language: 'java',
          confidence: 0.8,
          indicators: ['pom.xml', 'build.gradle'],
        });
      }
    } catch (error) {
      // Directory reading failed, return unknown
    }

    // Return language with highest confidence, or 'unknown' if none detected
    if (detectionResults.length > 0) {
      detectionResults.sort((a, b) => b.confidence - a.confidence);
      return detectionResults[0].language;
    }

    return 'unknown';
  }

  private generateHash(data: string): string {
    // Simple hash function for context comparison
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16).substring(0, 8);
  }

  // Utility method to check if two contexts are related
  isRelatedProject(context1: ProjectContext, context2: ProjectContext): boolean {
    // Same project
    if (context1.project === context2.project) {
      return true;
    }

    // Same language and similar naming
    if (
      context1.primary_language === context2.primary_language &&
      context1.primary_language !== 'unknown'
    ) {
      return true;
    }

    // Same git remote base (different repos from same organization)
    if (context1.git_remote && context2.git_remote) {
      const base1 = context1.git_remote.split('/').slice(0, -1).join('/');
      const base2 = context2.git_remote.split('/').slice(0, -1).join('/');
      return base1 === base2;
    }

    return false;
  }

  // Clear cache (useful for testing or when context changes)
  clearCache(): void {
    this.contextCache.clear();
  }
}
