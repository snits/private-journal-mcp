#!/usr/bin/env node

// ABOUTME: Fixed script to regenerate missing embeddings with proper nested directory traversal
// ABOUTME: Handles the model/agent/visibility/date directory structure correctly

const fs = require('fs').promises;
const path = require('path');
const { EmbeddingService } = require('./dist/embeddings');

async function findAllMdFiles(basePath) {
  const mdFiles = [];
  
  async function traverse(currentPath) {
    try {
      const items = await fs.readdir(currentPath);
      
      for (const item of items) {
        const fullPath = path.join(currentPath, item);
        const stat = await fs.stat(fullPath);
        
        if (stat.isDirectory()) {
          await traverse(fullPath);
        } else if (item.endsWith('.md')) {
          mdFiles.push(fullPath);
        }
      }
    } catch (error) {
      // Skip directories we can't read
      console.warn(`Skipping ${currentPath}: ${error.message}`);
    }
  }
  
  await traverse(basePath);
  return mdFiles;
}

async function generateEmbeddingForFile(mdPath, embeddingService) {
  try {
    const embeddingPath = mdPath.replace(/\.md$/, '.embedding');
    
    // Check if embedding already exists
    try {
      await fs.access(embeddingPath);
      return false; // Already exists
    } catch {
      // Doesn't exist, generate it
    }
    
    console.log(`Generating embedding for: ${mdPath}`);
    const content = await fs.readFile(mdPath, 'utf8');
    
    const { text, sections } = embeddingService.extractSearchableText(content);
    
    if (text.trim().length === 0) {
      console.log(`  Skipping empty entry: ${mdPath}`);
      return false;
    }

    const embedding = await embeddingService.generateEmbedding(text);
    
    // Extract timestamp from filename
    const filename = path.basename(mdPath, '.md');
    const timeMatch = filename.match(/^(\d{2})-(\d{2})-(\d{2})-\d{6}$/);
    const dirName = path.basename(path.dirname(mdPath));
    const dateMatch = dirName.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    
    let timestamp = Date.now();
    if (timeMatch && dateMatch) {
      const [, hours, minutes, seconds] = timeMatch;
      const [, year, month, day] = dateMatch;
      timestamp = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), 
                          parseInt(hours), parseInt(minutes), parseInt(seconds)).getTime();
    }

    const embeddingData = {
      embedding,
      text,
      sections,
      timestamp,
      path: mdPath
    };

    await fs.writeFile(embeddingPath, JSON.stringify(embeddingData, null, 2), 'utf8');
    console.log(`  ✅ Generated embedding: ${embeddingPath}`);
    return true;
  } catch (error) {
    console.error(`  ❌ Failed to generate embedding for ${mdPath}:`, error.message);
    return false;
  }
}

async function main() {
  const userJournalPath = path.join(process.env.HOME || '/home/jsnitsel', '.private-journal');
  
  console.log('Initializing embedding service...');
  const embeddingService = EmbeddingService.getInstance();
  await embeddingService.initialize();
  
  console.log('Finding all .md files...');
  const mdFiles = await findAllMdFiles(userJournalPath);
  console.log(`Found ${mdFiles.length} journal entries`);
  
  console.log('Checking for missing embeddings...');
  let generated = 0;
  let existing = 0;
  
  for (const mdFile of mdFiles) {
    const wasGenerated = await generateEmbeddingForFile(mdFile, embeddingService);
    if (wasGenerated) {
      generated++;
    } else {
      existing++;
    }
    
    // Progress indicator
    if ((generated + existing) % 50 === 0) {
      console.log(`Progress: ${generated + existing}/${mdFiles.length} processed (${generated} generated, ${existing} existing)`);
    }
  }
  
  console.log(`\n🎉 Complete! Generated ${generated} new embeddings, ${existing} already existed`);
}

main().catch(error => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});