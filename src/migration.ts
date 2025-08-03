// ABOUTME: Migration service for transferring file-based journal entries to SQLite database
// ABOUTME: Handles discovery, parsing, and batch transfer of existing journal data with progress tracking

import * as fs from 'fs/promises';
import * as path from 'path';
import { DatabaseJournalManager } from './database-journal';
import { EmbeddingService, EmbeddingData } from './embeddings';
import { VisibilityLevel } from './types';

export interface DiscoveredEntry {
  filePath: string;
  embeddingPath: string;
  type: 'project' | 'user';
  metadata: {
    agent_id?: string;
    model_id?: string;
    visibility_level?: VisibilityLevel;
    timestamp?: Date;
    dateString?: string;
  };
}

export interface MigrationResult {
  success: boolean;
  migratedCount: number;
  failedCount: number;
  warningCount: number;
  totalProcessed: number;
  duration: number;
  warnings: string[];
  errors: string[];
}

export interface MigrationOptions {
  batchSize?: number;
  onProgress?: (processed: number, total: number) => void;
  continueOnError?: boolean;
}

export class MigrationService {
  private embeddingService: EmbeddingService;

  constructor(
    private projectPath: string,
    private userPath: string,
    private dbManager: DatabaseJournalManager
  ) {
    this.embeddingService = EmbeddingService.getInstance();
  }

  async discoverEntries(): Promise<DiscoveredEntry[]> {
    const entries: DiscoveredEntry[] = [];
    
    // Discover project entries
    await this.discoverEntriesInPath(this.projectPath, 'project', entries);
    
    // Discover user entries  
    await this.discoverEntriesInPath(this.userPath, 'user', entries);
    
    return entries.sort((a, b) => {
      const aTime = a.metadata.timestamp?.getTime() || 0;
      const bTime = b.metadata.timestamp?.getTime() || 0;
      return aTime - bTime; // Chronological order for migration
    });
  }

  private async discoverEntriesInPath(
    basePath: string,
    type: 'project' | 'user',
    entries: DiscoveredEntry[]
  ): Promise<void> {
    try {
      await this.discoverEntriesRecursive(basePath, type, entries, []);
    } catch (error) {
      if ((error as any)?.code !== 'ENOENT') {
        console.error(`Failed to discover entries in ${basePath}:`, error);
      }
    }
  }

  private async discoverEntriesRecursive(
    currentPath: string,
    type: 'project' | 'user',
    entries: DiscoveredEntry[],
    pathComponents: string[]
  ): Promise<void> {
    try {
      const items = await fs.readdir(currentPath);
      
      for (const item of items) {
        const itemPath = path.join(currentPath, item);
        const stat = await fs.stat(itemPath);
        
        if (stat.isDirectory()) {
          // Check if this is a date directory (final level)
          if (item.match(/^\d{4}-\d{2}-\d{2}$/)) {
            // This is a date directory, discover entries from here
            await this.discoverEntriesFromDateDir(itemPath, type, entries, pathComponents, item);
          } else {
            // This might be model_id, agent_id, or visibility_level directory
            await this.discoverEntriesRecursive(itemPath, type, entries, [...pathComponents, item]);
          }
        }
      }
    } catch (error) {
      // Skip directories that can't be read
      console.warn(`Could not read directory ${currentPath}:`, error);
    }
  }

  private async discoverEntriesFromDateDir(
    dateDirPath: string,
    type: 'project' | 'user',
    entries: DiscoveredEntry[],
    pathComponents: string[],
    dateString: string
  ): Promise<void> {
    try {
      const files = await fs.readdir(dateDirPath);
      const mdFiles = files.filter(file => file.endsWith('.md'));

      for (const mdFile of mdFiles) {
        const filePath = path.join(dateDirPath, mdFile);
        const embeddingPath = filePath.replace(/\.md$/, '.embedding');
        
        // Extract timestamp from filename
        const timestamp = this.extractTimestampFromPath(filePath, dateString);
        
        // Extract agent metadata from path components
        const metadata = this.extractAgentMetadata(pathComponents, timestamp, dateString);
        
        entries.push({
          filePath,
          embeddingPath,
          type,
          metadata
        });
      }
    } catch (error) {
      console.warn(`Failed to read date directory ${dateDirPath}:`, error);
    }
  }

  private extractTimestampFromPath(filePath: string, dateString: string): Date | undefined {
    const filename = path.basename(filePath, '.md');
    const match = filename.match(/^(\d{2})-(\d{2})-(\d{2})-\d{6}$/);
    
    if (!match) return undefined;
    
    const [, hours, minutes, seconds] = match;
    const dateMatch = dateString.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    
    if (!dateMatch) return undefined;
    
    const [, year, month, day] = dateMatch;
    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day), 
                   parseInt(hours), parseInt(minutes), parseInt(seconds));
  }

  private extractAgentMetadata(
    pathComponents: string[],
    timestamp?: Date,
    dateString?: string
  ): {
    agent_id?: string;
    model_id?: string;
    visibility_level?: VisibilityLevel;
    timestamp?: Date;
    dateString?: string;
  } {
    // Try path-based extraction first (for new structure)
    if (pathComponents.length >= 3) {
      return {
        model_id: pathComponents[0],
        agent_id: pathComponents[1],
        visibility_level: pathComponents[2] as VisibilityLevel,
        timestamp,
        dateString
      };
    }
    
    // Check if any path component looks like a known model
    const modelIndex = pathComponents.findIndex(part => 
      part.includes('claude') || part.includes('gpt') || part.includes('gemini')
    );
    
    if (modelIndex >= 0 && modelIndex + 2 < pathComponents.length) {
      return {
        model_id: pathComponents[modelIndex],
        agent_id: pathComponents[modelIndex + 1],
        visibility_level: pathComponents[modelIndex + 2] as VisibilityLevel,
        timestamp,
        dateString
      };
    }
    
    // Default values for legacy entries
    return {
      model_id: 'unknown',
      agent_id: 'unknown',
      visibility_level: 'private',
      timestamp,
      dateString
    };
  }

  async migrateEntries(
    entries: DiscoveredEntry[],
    options: MigrationOptions = {}
  ): Promise<MigrationResult> {
    const {
      batchSize = 50,
      onProgress,
      continueOnError = true
    } = options;

    const startTime = Date.now();
    let migratedCount = 0;
    let failedCount = 0;
    let warningCount = 0;
    const warnings: string[] = [];
    const errors: string[] = [];

    // Process in batches
    for (let i = 0; i < entries.length; i += batchSize) {
      const batch = entries.slice(i, i + batchSize);
      
      for (const entry of batch) {
        try {
          await this.migrateEntry(entry, warnings);
          migratedCount++;
        } catch (error) {
          failedCount++;
          const errorMsg = `Failed to migrate ${entry.filePath}: ${error instanceof Error ? error.message : error}`;
          errors.push(errorMsg);
          console.error(errorMsg);
          
          if (!continueOnError) {
            throw error;
          }
        }
        
        // Report progress
        if (onProgress) {
          onProgress(migratedCount + failedCount, entries.length);
        }
      }
    }

    warningCount = warnings.length;
    const duration = Date.now() - startTime;
    
    return {
      success: failedCount === 0,
      migratedCount,
      failedCount,
      warningCount,
      totalProcessed: migratedCount + failedCount,
      duration,
      warnings,
      errors
    };
  }

  private async migrateEntry(entry: DiscoveredEntry, warnings: string[]): Promise<void> {
    // Read the markdown content
    const content = await fs.readFile(entry.filePath, 'utf8');
    
    // Try to read existing embedding
    let existingEmbedding: EmbeddingData | null = null;
    try {
      const embeddingContent = await fs.readFile(entry.embeddingPath, 'utf8');
      existingEmbedding = JSON.parse(embeddingContent);
    } catch (error) {
      warnings.push(`Missing embedding file for ${entry.filePath}`);
    }

    // Parse frontmatter to extract metadata
    const frontmatterMatch = content.match(/^---\n(.*?)\n---\n/s);
    let parsedMetadata: any = {};
    
    if (frontmatterMatch) {
      try {
        // Simple YAML parsing for our known structure
        const frontmatter = frontmatterMatch[1];
        const lines = frontmatter.split('\n');
        
        for (const line of lines) {
          const colonIndex = line.indexOf(':');
          if (colonIndex > 0) {
            const key = line.substring(0, colonIndex).trim();
            const value = line.substring(colonIndex + 1).trim().replace(/^"(.*)"$/, '$1');
            
            if (key === 'timestamp') {
              parsedMetadata.timestamp = parseInt(value);
            } else if (key === 'agent_id' || key === 'model_id' || key === 'visibility_level') {
              parsedMetadata[key] = value;
            }
          }
        }
      } catch (error) {
        warnings.push(`Failed to parse frontmatter for ${entry.filePath}`);
      }
    }

    // Determine entry type based on content structure
    const entryType = content.includes('## Feelings') || content.includes('## Project Notes') 
      ? 'thoughts' : 'simple';

    // Use database manager to store the entry
    const timestamp = entry.metadata.timestamp || new Date(parsedMetadata.timestamp || Date.now());
    const dateString = entry.metadata.dateString || this.formatDate(timestamp);
    const timeString = this.formatTimestamp(timestamp);
    const filePath = `${entry.type}/${dateString}/${timeString}.md`;

    // Generate embedding if not available
    let embeddingData: EmbeddingData;
    if (existingEmbedding && existingEmbedding.embedding && existingEmbedding.embedding.length > 0) {
      embeddingData = existingEmbedding;
    } else {
      // Generate new embedding
      const { text, sections } = this.embeddingService.extractSearchableText(content);
      if (text.trim().length > 0) {
        const embedding = await this.embeddingService.generateEmbedding(text);
        embeddingData = {
          embedding,
          text,
          sections,
          timestamp: timestamp.getTime(),
          path: filePath
        };
      } else {
        embeddingData = {
          embedding: [],
          text: '',
          sections: [],
          timestamp: timestamp.getTime(),
          path: filePath
        };
      }
    }

    // Insert into database using direct SQL to maintain compatibility
    await (this.dbManager as any).runAsync(`
      INSERT INTO journal_entries (
        content, timestamp, date_string, file_path, entry_type,
        agent_id, model_id, visibility_level,
        embedding, searchable_text, sections
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      content,
      timestamp.getTime(),
      dateString,
      filePath,
      entryType,
      entry.metadata.agent_id || parsedMetadata.agent_id || null,
      entry.metadata.model_id || parsedMetadata.model_id || null,
      entry.metadata.visibility_level || parsedMetadata.visibility_level || 'private',
      embeddingData.embedding.length > 0 ? Buffer.from(new Float32Array(embeddingData.embedding).buffer) : null,
      embeddingData.text,
      JSON.stringify(embeddingData.sections)
    ]);
  }

  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private formatTimestamp(date: Date): string {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    const microseconds = String(date.getMilliseconds() * 1000 + Math.floor(Math.random() * 1000)).padStart(6, '0');
    return `${hours}-${minutes}-${seconds}-${microseconds}`;
  }
}