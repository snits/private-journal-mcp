// ABOUTME: Response formatting utilities for MCP tool output
// ABOUTME: Handles frontmatter stripping and search result normalization

/**
 * Strips YAML frontmatter from text content.
 * Removes everything between --- markers at the start of the text.
 */
export function stripFrontmatter(text: string): string {
  const frontmatterRegex = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;
  return text.replace(frontmatterRegex, '').trim();
}

/**
 * Normalizes search results into a consistent format for MCP responses.
 * Handles both entry and distillation results (discriminated by result.source).
 */
export function normalizeSearchResponse(results: any[]): any[] {
  return results.map((result) => {
    if (result.source === 'distillation') {
      return {
        score: result.score || 0,
        path: result.source_entry_path || '',
        title: result.title,
        summary: result.summary,
        key_insights: result.key_insights,
        category: result.category,
        timestamp: result.timestamp || new Date(),
        type: 'distillation',
        sections: [],
        source: 'distillation',
        source_entry_id: result.source_entry_id,
      };
    }

    const text = result.text || result.content || result.searchable_text || '';
    const contentWithoutFrontmatter = stripFrontmatter(text);
    const excerpt = result.excerpt || (contentWithoutFrontmatter ? contentWithoutFrontmatter.slice(0, 200) : '');

    return {
      score: result.score || result.similarity_score || 0,
      path: result.path || result.file_path || '',
      excerpt,
      text,
      timestamp: result.timestamp || result.created_at || new Date(),
      type: result.type || result.entry_type || 'unknown',
      sections: result.sections || [],
      source: 'entry',
      ...(result.agent_id && { agent_id: result.agent_id }),
      ...(result.model_id && { model_id: result.model_id }),
      ...(result.visibility_level && { visibility_level: result.visibility_level }),
      ...(result.cross_project_warning && { cross_project_warning: result.cross_project_warning }),
      ...(result.project_name && { project_name: result.project_name }),
      ...(result.context_match && { context_match: result.context_match }),
      ...(result.project && { project: result.project }),
      ...(result.project_context && { project_context: result.project_context }),
    };
  });
}
