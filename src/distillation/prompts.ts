// ABOUTME: Prompt templates for LLM-based journal entry distillation
// ABOUTME: Produces structured JSON output with title, summary, key_insights, category

import { VALID_CATEGORIES } from './category-extraction';

export interface DistillationEntry {
  content: string;
  entryType?: string;
  agentId?: string;
  dateString?: string;
  sections?: string[];
}

export function buildDistillationPrompt(entry: DistillationEntry): string {
  const sectionsList = entry.sections?.join(', ') || 'none';
  const categories = VALID_CATEGORIES.join(', ');

  return `You are an expert at distilling journal entries into structured insights.
Analyze the following journal entry and extract the key information.

JOURNAL ENTRY:
"""
${entry.content}
"""

ENTRY METADATA:
- Type: ${entry.entryType ?? 'general'}
- Agent: ${entry.agentId ?? 'unknown'}
- Date: ${entry.dateString ?? 'unknown'}
- Sections: ${sectionsList}

Extract structured insights in JSON format:

{
  "title": "Clear, descriptive title capturing the main insight (10+ characters)",
  "summary": "Concise summary of key content and context (50+ characters)",
  "key_insights": ["Specific, actionable insights (at least 1, 20+ characters each)"],
  "category": "One of: ${categories}"
}

REQUIREMENTS:
- Be specific, avoid vague language
- Focus on actionable insights over general observations
- Use precise language and concrete details
- Ensure insights are distinct and non-repetitive
- Choose the most appropriate category based on content

OUTPUT ONLY VALID JSON.`;
}

/**
 * Strips markdown code fences that LLMs frequently wrap around JSON output.
 */
export function stripCodeFences(raw: string): string {
  return raw.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
}
