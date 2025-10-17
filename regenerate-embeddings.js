#!/usr/bin/env node

// ABOUTME: Standalone script to regenerate missing embeddings for historical journal entries
// ABOUTME: Uses the existing JournalManager infrastructure to batch process missing embeddings

const { JournalManager } = require('./dist/journal');
const path = require('path');

async function main() {
  const userJournalPath = path.join(process.env.HOME || '/home/jsnitsel', '.private-journal');
  
  console.log('Initializing journal manager...');
  const journalManager = new JournalManager('', userJournalPath);
  
  console.log('Starting embedding regeneration for missing entries...');
  console.log('This may take several minutes as it processes ~736 entries...');
  
  try {
    const count = await journalManager.generateMissingEmbeddings();
    console.log(`✅ Successfully generated embeddings for ${count} journal entries`);
    
    if (count === 0) {
      console.log('🎉 All journal entries already have embeddings!');
    }
  } catch (error) {
    console.error('❌ Failed to regenerate embeddings:', error);
    process.exit(1);
  }
}

main().catch(error => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});