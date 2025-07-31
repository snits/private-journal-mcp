#!/usr/bin/env node

// Migration tool to convert legacy journal entries to multi-agent structure
const fs = require('fs/promises');
const path = require('path');

// Default mappings for legacy entries
const AGENT_PREFIX_MAPPING = {
  '[claude-general]': { model_id: 'claude-sonnet-4', agent_id: 'claude-general' },
  '[code-reviewer]': { model_id: 'claude-sonnet-4', agent_id: 'code-reviewer' },
  '[debug-specialist]': { model_id: 'claude-sonnet-4', agent_id: 'debug-specialist' },
  '[systems-architect]': { model_id: 'claude-sonnet-4', agent_id: 'systems-architect' },
  '[security-engineer]': { model_id: 'claude-sonnet-4', agent_id: 'security-engineer' },
  '[senior-engineer]': { model_id: 'claude-sonnet-4', agent_id: 'senior-engineer' },
  '[performance-engineer]': { model_id: 'claude-sonnet-4', agent_id: 'performance-engineer' },
  '[qa-engineer]': { model_id: 'claude-sonnet-4', agent_id: 'qa-engineer' },
  '[test-specialist]': { model_id: 'claude-sonnet-4', agent_id: 'test-specialist' }
};

const DEFAULT_METADATA = {
  model_id: 'claude-sonnet-4',
  agent_id: 'claude-general',
  visibility_level: 'private'
};

class LegacyMigrator {
  constructor(journalPath) {
    this.journalPath = journalPath;
    this.migratedCount = 0;
    this.errors = [];
  }

  async migrate() {
    console.log('🔄 Starting migration of legacy journal entries...\n');
    console.log(`📂 Journal path: ${this.journalPath}`);
    
    try {
      await this.scanAndMigrate(this.journalPath);
      
      console.log(`\n✅ Migration complete!`);
      console.log(`📊 Summary:`);
      console.log(`   - Entries migrated: ${this.migratedCount}`);
      console.log(`   - Errors: ${this.errors.length}`);
      
      if (this.errors.length > 0) {
        console.log(`\n❌ Errors encountered:`);
        this.errors.forEach((error, i) => {
          console.log(`   ${i+1}. ${error}`);
        });
      }
      
    } catch (error) {
      console.error('❌ Migration failed:', error);
    }
  }

  async scanAndMigrate(basePath) {
    try {
      const items = await fs.readdir(basePath);
      
      for (const item of items) {
        const itemPath = path.join(basePath, item);
        const stat = await fs.stat(itemPath);
        
        if (stat.isDirectory()) {
          // Check if this is a legacy date directory (YYYY-MM-DD)
          if (item.match(/^\d{4}-\d{2}-\d{2}$/)) {
            console.log(`📅 Processing date directory: ${item}`);
            await this.migrateDateDirectory(itemPath, item);
          } else if (!this.isAgentDirectory(item)) {
            // Recurse into subdirectories that aren't agent directories
            await this.scanAndMigrate(itemPath);
          }
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.errors.push(`Failed to scan ${basePath}: ${error.message}`);
      }
    }
  }

  isAgentDirectory(dirName) {
    // Check if this looks like one of our new agent-aware directories
    return dirName.includes('claude') || dirName.includes('gpt') || dirName.includes('gemini') ||
           dirName === 'private' || dirName === 'public' || dirName === 'team' || dirName === 'crb';
  }

  async migrateDateDirectory(dateDirPath, dateString) {
    try {
      const files = await fs.readdir(dateDirPath);
      const mdFiles = files.filter(f => f.endsWith('.md'));
      
      for (const mdFile of mdFiles) {
        await this.migrateEntry(dateDirPath, dateString, mdFile);
      }
    } catch (error) {
      this.errors.push(`Failed to read date directory ${dateDirPath}: ${error.message}`);
    }
  }

  async migrateEntry(dateDirPath, dateString, filename) {
    const sourcePath = path.join(dateDirPath, filename);
    
    try {
      console.log(`   📄 Migrating: ${filename}`);
      
      // Read the legacy entry
      const content = await fs.readFile(sourcePath, 'utf8');
      
      // Extract metadata and clean content
      const { metadata, cleanContent } = this.extractMetadata(content);
      
      // Determine target directory
      const targetDir = path.join(
        path.dirname(dateDirPath), // Base journal path
        metadata.model_id,
        metadata.agent_id,
        metadata.visibility_level,
        dateString
      );
      
      // Create target directory
      await fs.mkdir(targetDir, { recursive: true });
      
      // Write migrated entry
      const targetPath = path.join(targetDir, filename);
      await fs.writeFile(targetPath, cleanContent, 'utf8');
      
      console.log(`      ✅ Moved to: ${metadata.model_id}/${metadata.agent_id}/${metadata.visibility_level}/${dateString}/`);
      
      // Remove old entry and embedding if they exist
      await this.cleanupLegacyFiles(dateDirPath, filename);
      
      this.migratedCount++;
      
    } catch (error) {
      this.errors.push(`Failed to migrate ${sourcePath}: ${error.message}`);
    }
  }

  extractMetadata(content) {
    let metadata = { ...DEFAULT_METADATA };
    let cleanContent = content;
    let foundPrefix = false;

    // Check for agent prefix in content
    for (const [prefix, agentMeta] of Object.entries(AGENT_PREFIX_MAPPING)) {
      if (content.includes(prefix)) {
        metadata.model_id = agentMeta.model_id;
        metadata.agent_id = agentMeta.agent_id;
        foundPrefix = true;
        
        // Remove prefix from content
        cleanContent = content.replace(new RegExp(prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '').trim();
        break;
      }
    }

    // For entries with no prefix, try to infer agent from content patterns
    // Use more specific patterns to avoid false positives
    if (!foundPrefix) {
      const contentLower = content.toLowerCase();
      
      // More specific patterns to reduce false positives
      if (contentLower.includes('code review') || contentLower.includes('reviewing code') || contentLower.includes('linting errors')) {
        metadata.agent_id = 'code-reviewer';
      } else if ((contentLower.includes('debug') && contentLower.includes('trace')) || 
                 contentLower.includes('debugging') || contentLower.includes('stack trace')) {
        metadata.agent_id = 'debug-specialist';
      } else if (contentLower.includes('security') || contentLower.includes('vulnerability') || 
                 contentLower.includes('authentication') || contentLower.includes('csrf') || 
                 contentLower.includes('injection')) {
        metadata.agent_id = 'security-engineer';
      } else if ((contentLower.includes('architecture') && contentLower.includes('system')) ||
                 contentLower.includes('microservices') || contentLower.includes('distributed') ||
                 contentLower.includes('architectural')) {
        metadata.agent_id = 'systems-architect';
      } else if (contentLower.includes('performance') || contentLower.includes('optimization') || 
                 contentLower.includes('bottleneck') || contentLower.includes('profiling')) {
        metadata.agent_id = 'performance-engineer';
      } else if ((contentLower.includes('test') && contentLower.includes('coverage')) ||
                 contentLower.includes('qa process') || contentLower.includes('validation')) {
        metadata.agent_id = 'test-specialist';
      }
      // Otherwise keep default: claude-general (for general development work)
    }

    // Try to infer visibility from content context
    const contentLower = content.toLowerCase();
    if (contentLower.includes('public') || contentLower.includes('sharing') || contentLower.includes('insight')) {
      metadata.visibility_level = 'public';
    } else if (contentLower.includes('team') || contentLower.includes('coordination')) {
      metadata.visibility_level = 'team';
    } else if (contentLower.includes('crb') || contentLower.includes('review board') || contentLower.includes('architecture')) {
      metadata.visibility_level = 'crb';
    }

    // Update frontmatter in clean content
    cleanContent = this.updateFrontmatter(cleanContent, metadata);

    return { metadata, cleanContent };
  }

  updateFrontmatter(content, metadata) {
    // Parse existing frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    
    if (frontmatterMatch) {
      const [, existingFrontmatter, bodyContent] = frontmatterMatch;
      
      // Add agent metadata to existing frontmatter
      const updatedFrontmatter = existingFrontmatter + 
        `\nagent_id: ${metadata.agent_id}` +
        `\nmodel_id: ${metadata.model_id}` +
        `\nvisibility_level: ${metadata.visibility_level}`;
      
      return `---\n${updatedFrontmatter}\n---\n${bodyContent}`;
    }
    
    // No existing frontmatter, return as-is (should be rare)
    return content;
  }

  async cleanupLegacyFiles(dateDirPath, filename) {
    try {
      // Remove original .md file
      const mdPath = path.join(dateDirPath, filename);
      await fs.unlink(mdPath);
      
      // Remove corresponding .embedding file if it exists
      const embeddingPath = path.join(dateDirPath, filename.replace('.md', '.embedding'));
      try {
        await fs.unlink(embeddingPath);
      } catch (error) {
        // Embedding file might not exist, that's OK
      }
      
      // Check if date directory is now empty and remove it
      const remainingFiles = await fs.readdir(dateDirPath);
      if (remainingFiles.length === 0) {
        await fs.rmdir(dateDirPath);
        console.log(`      🗑️ Removed empty date directory: ${path.basename(dateDirPath)}`);
      }
      
    } catch (error) {
      this.errors.push(`Failed to cleanup legacy files: ${error.message}`);
    }
  }
}

// CLI usage
async function main() {
  const journalPath = process.argv[2] || path.join(__dirname, '.private-journal');
  
  console.log('📚 Legacy Journal Migration Tool');
  console.log('================================\n');
  
  const migrator = new LegacyMigrator(journalPath);
  await migrator.migrate();
  
  console.log('\n🔧 Next steps:');
  console.log('1. Run the server to regenerate embeddings: npm run build && node dist/index.js');
  console.log('2. Update agent prompt files to remove prefix instructions');
  console.log('3. Test search functionality with migrated entries\n');
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { LegacyMigrator };