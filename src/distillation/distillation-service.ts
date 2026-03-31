// ABOUTME: Orchestrates LLM-based distillation of journal entries into structured insights
// ABOUTME: Queries undistilled entries, builds prompts, calls LLM, stores results with embeddings

import { Pool } from 'pg';
import { TextGenerationClient } from '../text-generation-client';
import { DistillationOptions, DistillationResult, DistillationSummary } from '../private-journal-types';
import { VALID_CATEGORIES, Category } from './category-extraction';
import { buildDistillationPrompt, stripCodeFences, DistillationEntry } from './prompts';

interface EmbeddingService {
  generateDocumentEmbedding(text: string): Promise<number[]>;
}

export class DistillationService {
  private pool: Pool;
  private textGen: TextGenerationClient;
  private embedding: EmbeddingService;
  private model: string;

  constructor(pool: Pool, textGen: TextGenerationClient, embedding: EmbeddingService) {
    this.pool = pool;
    this.textGen = textGen;
    this.embedding = embedding;
    this.model = process.env.TEXT_GEN_MODEL || 'llama3.1:8b';
  }

  async distillEntries(options: DistillationOptions): Promise<DistillationSummary> {
    const { daysBack, category, limit = 50 } = options;

    const { undistilled, skippedCount } = await this.findUndistilledEntries(daysBack, category, limit);

    const summary: DistillationSummary = {
      entriesFound: undistilled.length + skippedCount,
      entriesSkipped: skippedCount,
      distillationsCreated: 0,
      errors: 0,
      titles: [],
    };

    for (const entry of undistilled) {
      try {
        const result = await this.distillEntry(entry);
        await this.storeDistillation(entry.id, result);
        await this.generateAndStoreEmbedding(entry.id, result);
        summary.distillationsCreated++;
        summary.titles.push(result.title);
        console.error(`Distilled entry ${entry.id}: "${result.title}"`);
      } catch (error) {
        summary.errors++;
        console.error(`Failed to distill entry ${entry.id}:`, error);
      }
    }

    return summary;
  }

  private async findUndistilledEntries(
    daysBack: number,
    category: string | undefined,
    limit: number,
  ): Promise<{
    undistilled: Array<{ id: number; content: string; type: string; agent_id: string | null; date_string: string; sections: string | null }>;
    skippedCount: number;
  }> {
    const client = await this.pool.connect();
    try {
      // Count already-distilled entries in the date range
      const countResult = await client.query(
        `SELECT count(*) AS cnt
         FROM ai_memory.journal_entries je
         INNER JOIN ai_memory.distillation_sources ds ON je.id = ds.entry_id
         WHERE je.timestamp >= now() - make_interval(days => $1)
           AND ($2::varchar IS NULL OR je.category = $2)`,
        [daysBack, category ?? null],
      );
      const skippedCount = parseInt(countResult.rows[0].cnt, 10);

      // Find undistilled entries
      const result = await client.query(
        `SELECT je.id, je.content, je.type, je.agent_id, je.date_string, je.sections
         FROM ai_memory.journal_entries je
         LEFT JOIN ai_memory.distillation_sources ds ON je.id = ds.entry_id
         WHERE ds.entry_id IS NULL
           AND je.timestamp >= now() - make_interval(days => $1)
           AND ($2::varchar IS NULL OR je.category = $2)
         ORDER BY je.timestamp ASC
         LIMIT $3`,
        [daysBack, category ?? null, limit],
      );

      return { undistilled: result.rows, skippedCount };
    } finally {
      client.release();
    }
  }

  private async distillEntry(entry: {
    id: number;
    content: string;
    type: string;
    agent_id: string | null;
    date_string: string;
    sections: string | null;
  }): Promise<DistillationResult> {
    const sections = this.parseSections(entry.sections);

    const promptEntry: DistillationEntry = {
      content: entry.content,
      entryType: entry.type,
      agentId: entry.agent_id ?? undefined,
      dateString: entry.date_string,
      sections,
    };

    const prompt = buildDistillationPrompt(promptEntry);
    const raw = await this.textGen.generate(prompt);
    const cleaned = stripCodeFences(raw.trim());
    const parsed = JSON.parse(cleaned);

    this.validateResult(parsed);

    return {
      title: parsed.title,
      summary: parsed.summary,
      keyInsights: parsed.key_insights,
      category: parsed.category,
    };
  }

  private validateResult(parsed: any): void {
    if (!parsed.title || typeof parsed.title !== 'string') {
      throw new Error('Missing or invalid title');
    }
    if (!parsed.summary || typeof parsed.summary !== 'string') {
      throw new Error('Missing or invalid summary');
    }
    if (!Array.isArray(parsed.key_insights) || parsed.key_insights.length === 0) {
      throw new Error('Missing or empty key_insights');
    }
    if (!VALID_CATEGORIES.includes(parsed.category as Category)) {
      throw new Error(`Invalid category: ${parsed.category}`);
    }
  }

  private async storeDistillation(entryId: number, result: DistillationResult): Promise<string> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const insertResult = await client.query(
        `INSERT INTO ai_memory.distillations (title, summary, key_insights, category, model)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [result.title, result.summary, result.keyInsights, result.category, this.model],
      );

      const distillationId = insertResult.rows[0].id;

      await client.query(
        `INSERT INTO ai_memory.distillation_sources (distillation_id, entry_id)
         VALUES ($1, $2)`,
        [distillationId, entryId],
      );

      await client.query('COMMIT');
      return distillationId;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  private async generateAndStoreEmbedding(entryId: number, result: DistillationResult): Promise<void> {
    try {
      const searchableText = `${result.title} ${result.summary} ${result.keyInsights.join(' ')}`;
      const embedding = await this.embedding.generateDocumentEmbedding(searchableText);

      if (embedding.length === 768) {
        const client = await this.pool.connect();
        try {
          // Find the distillation ID for this entry
          const lookup = await client.query(
            `SELECT distillation_id FROM ai_memory.distillation_sources WHERE entry_id = $1 LIMIT 1`,
            [entryId],
          );
          if (lookup.rows.length > 0) {
            const formatted = `[${embedding.join(',')}]`;
            await client.query(
              `UPDATE ai_memory.distillations SET embedding_768d = $1::vector WHERE id = $2`,
              [formatted, lookup.rows[0].distillation_id],
            );
          }
        } finally {
          client.release();
        }
      }
    } catch (error) {
      console.error(`Failed to generate embedding for distillation of entry ${entryId}:`, error);
      // Accepted degraded behavior: distillation exists but unsearchable
    }
  }

  private parseSections(sectionsJson: string | null): string[] | undefined {
    if (!sectionsJson) return undefined;
    try {
      const parsed = JSON.parse(sectionsJson);
      return Array.isArray(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
}
