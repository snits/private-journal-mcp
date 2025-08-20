// ABOUTME: Project-aware search service that prevents cross-project context contamination
// ABOUTME: Implements intelligent search strategy with project-first fallback to related contexts

import { SearchService, SearchResult } from './search';
import { SearchOptions, ProjectContext } from './private-journal-types';
import { ProjectContextDetector } from './project-context';

export interface ProjectAwareSearchResult extends SearchResult {
  context_match: number;          // Relevance score for current project context
  cross_project_warning: boolean; // True if result is from different project
  project_name?: string;          // Project this result came from
  context_confidence: 'high' | 'medium' | 'low';
}

export interface ProjectSearchStrategy {
  currentProject: ProjectContext;
  relatedProjects: string[];
  fallbackStrategy: 'language' | 'global' | 'none';
}

export class ProjectAwareSearchService {
  private searchService: SearchService;
  private contextDetector: ProjectContextDetector;
  private currentContext: ProjectContext | null = null;

  constructor(projectPath?: string, userPath?: string) {
    this.searchService = new SearchService(projectPath, userPath);
    this.contextDetector = ProjectContextDetector.getInstance();
  }

  /**
   * Main search method with intelligent project-aware fallback strategy
   */
  async search(query: string, options: SearchOptions = {}): Promise<ProjectAwareSearchResult[]> {
    // Get current project context
    const currentProject = options.project_filter === 'current' ? 
      await this.contextDetector.detectProjectContext() : 
      this.currentContext || await this.contextDetector.detectProjectContext();
    
    this.currentContext = currentProject;

    // Handle explicit project filtering
    if (typeof options.project_filter === 'string' && 
        options.project_filter !== 'current' && 
        options.project_filter !== 'all') {
      return await this.searchSpecificProject(query, options.project_filter, options);
    }

    if (Array.isArray(options.project_filter)) {
      return await this.searchMultipleProjects(query, options.project_filter, options);
    }

    // Default: intelligent project-first search with fallback
    return await this.searchWithProjectAwareFallback(query, currentProject, options);
  }

  /**
   * Implements the intelligent search strategy from the design document
   */
  private async searchWithProjectAwareFallback(
    query: string, 
    currentProject: ProjectContext, 
    options: SearchOptions
  ): Promise<ProjectAwareSearchResult[]> {
    const allResults: ProjectAwareSearchResult[] = [];
    const targetLimit = options.limit || 10;

    // Phase 1: Current project search (highest relevance)
    const currentProjectResults = await this.searchCurrentProject(query, currentProject, {
      ...options,
      limit: Math.max(targetLimit, 5) // Get at least 5 for good coverage
    });
    allResults.push(...currentProjectResults);

    // Phase 2: If insufficient results, search related projects
    if (allResults.length < 3) {
      const relatedProjects = this.detectRelatedProjects(currentProject);
      const relatedResults = await this.searchRelatedProjects(
        query, 
        relatedProjects, 
        currentProject, 
        {
          ...options,
          limit: targetLimit - allResults.length
        }
      );
      allResults.push(...relatedResults);
    }

    // Phase 3: If still insufficient, global search with relevance filtering
    if (allResults.length < 3 && !options.exclude_current) {
      const globalResults = await this.searchGlobalWithRelevance(query, currentProject, {
        ...options,
        limit: targetLimit - allResults.length,
        min_relevance: options.min_relevance || 0.6
      });
      allResults.push(...globalResults);
    }

    // Sort by combined relevance score (context match + search score)
    return this.rankAndLimitResults(allResults, currentProject, targetLimit);
  }

  /**
   * Search within current project context
   */
  private async searchCurrentProject(
    query: string, 
    currentProject: ProjectContext, 
    options: SearchOptions
  ): Promise<ProjectAwareSearchResult[]> {
    // This would integrate with the existing search service
    // For now, simulate project-filtered search
    const rawResults = await this.searchService.search(query, options);
    
    return rawResults
      .filter(result => this.matchesProject(result, currentProject.project))
      .map(result => this.enhanceWithProjectContext(result, currentProject, 'current'));
  }

  /**
   * Search related projects (same language, similar patterns)
   */
  private async searchRelatedProjects(
    query: string,
    relatedProjects: string[],
    currentProject: ProjectContext,
    options: SearchOptions
  ): Promise<ProjectAwareSearchResult[]> {
    const results: ProjectAwareSearchResult[] = [];
    
    for (const project of relatedProjects) {
      const projectResults = await this.searchSpecificProject(query, project, {
        ...options,
        limit: Math.ceil((options.limit || 10) / relatedProjects.length)
      });
      results.push(...projectResults);
    }

    return results.map(result => 
      this.enhanceWithProjectContext(result, currentProject, 'related')
    );
  }

  /**
   * Global search with relevance filtering
   */
  private async searchGlobalWithRelevance(
    query: string,
    currentProject: ProjectContext,
    options: SearchOptions
  ): Promise<ProjectAwareSearchResult[]> {
    const rawResults = await this.searchService.search(query, {
      ...options,
      type: 'both' // Search both project and user entries
    });

    const minRelevance = options.min_relevance || 0.6;
    
    return rawResults
      .filter(result => result.score >= minRelevance)
      .map(result => this.enhanceWithProjectContext(result, currentProject, 'global'))
      .filter(result => !options.exclude_current || 
              result.project_name !== currentProject.project);
  }

  /**
   * Search specific project by name
   */
  private async searchSpecificProject(
    query: string,
    projectName: string,
    options: SearchOptions
  ): Promise<ProjectAwareSearchResult[]> {
    const rawResults = await this.searchService.search(query, options);
    
    return rawResults
      .filter(result => this.matchesProject(result, projectName))
      .map(result => this.enhanceWithProjectContext(result, null, 'specific'));
  }

  /**
   * Search multiple specific projects
   */
  private async searchMultipleProjects(
    query: string,
    projectNames: string[],
    options: SearchOptions
  ): Promise<ProjectAwareSearchResult[]> {
    const results: ProjectAwareSearchResult[] = [];
    
    for (const project of projectNames) {
      const projectResults = await this.searchSpecificProject(query, project, {
        ...options,
        limit: Math.ceil((options.limit || 10) / projectNames.length)
      });
      results.push(...projectResults);
    }

    return results;
  }

  /**
   * Detect related projects based on language and patterns
   */
  private detectRelatedProjects(currentProject: ProjectContext): string[] {
    // This would analyze journal entries to find projects with:
    // - Same primary language
    // - Similar tech stack indicators
    // - Shared architectural patterns
    // - Same git organization/user
    
    // For now, return empty array - would be implemented with actual project analysis
    return [];
  }

  /**
   * Check if search result matches a specific project
   */
  private matchesProject(result: SearchResult, projectName: string): boolean {
    // This would check the result's project context metadata
    // For now, simulate based on path patterns
    return result.path.includes(projectName) || 
           result.text.toLowerCase().includes(projectName.toLowerCase());
  }

  /**
   * Enhance search result with project context information
   */
  private enhanceWithProjectContext(
    result: SearchResult,
    currentProject: ProjectContext | null,
    searchType: 'current' | 'related' | 'global' | 'specific'
  ): ProjectAwareSearchResult {
    const enhanced: ProjectAwareSearchResult = {
      ...result,
      context_match: this.calculateContextRelevance(result, currentProject, searchType),
      cross_project_warning: searchType !== 'current' && currentProject !== null,
      project_name: this.extractProjectName(result),
      context_confidence: this.determineContextConfidence(result, searchType)
    };

    return enhanced;
  }

  /**
   * Calculate context relevance score
   */
  private calculateContextRelevance(
    result: SearchResult,
    currentProject: ProjectContext | null,
    searchType: string
  ): number {
    let baseScore = result.score;

    // Boost scores based on context match
    switch (searchType) {
      case 'current':
        return baseScore * 1.0; // No penalty for current project
      case 'related':
        return baseScore * 0.8; // Slight penalty for related projects
      case 'global':
        return baseScore * 0.6; // Penalty for global results
      case 'specific':
        return baseScore * 0.9; // Small penalty for explicit project selection
      default:
        return baseScore;
    }
  }

  /**
   * Extract project name from search result
   */
  private extractProjectName(result: SearchResult): string {
    // This would parse the project context from the result metadata
    // For now, extract from path
    const pathParts = result.path.split('/');
    const possibleProject = pathParts.find(part => 
      !part.includes('.') && part.length > 2
    );
    return possibleProject || 'unknown';
  }

  /**
   * Determine context confidence level
   */
  private determineContextConfidence(
    result: SearchResult,
    searchType: string
  ): 'high' | 'medium' | 'low' {
    switch (searchType) {
      case 'current':
        return 'high';
      case 'related':
      case 'specific':
        return 'medium';
      case 'global':
        return 'low';
      default:
        return 'low';
    }
  }

  /**
   * Rank and limit results by combined relevance
   */
  private rankAndLimitResults(
    results: ProjectAwareSearchResult[],
    currentProject: ProjectContext,
    limit: number
  ): ProjectAwareSearchResult[] {
    return results
      .sort((a, b) => {
        // Primary sort: context match score
        const contextDiff = b.context_match - a.context_match;
        if (Math.abs(contextDiff) > 0.1) {
          return contextDiff;
        }
        
        // Secondary sort: original search score
        return b.score - a.score;
      })
      .slice(0, limit);
  }

  /**
   * Update current project context (for session persistence)
   */
  async updateCurrentContext(workingDir?: string): Promise<void> {
    this.currentContext = await this.contextDetector.detectProjectContext(workingDir);
  }

  /**
   * Get current project context
   */
  getCurrentContext(): ProjectContext | null {
    return this.currentContext;
  }
}