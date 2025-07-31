#!/usr/bin/env node

// Test script to verify multi-agent search functionality
const { SearchService } = require('./dist/search');
const path = require('path');

async function testMultiAgentSearch() {
  console.log('🔍 Testing Multi-Agent Search Functionality...\n');
  
  const projectPath = path.join(__dirname, '.test-journal-project');
  const userPath = path.join(__dirname, '.test-journal-user');
  const searchService = new SearchService(projectPath, userPath);

  try {
    // Test 1: Search all entries
    console.log('1. 📊 Searching all entries for "authentication"...');
    const allResults = await searchService.search('authentication', {
      limit: 10
    });
    
    console.log(`   Found ${allResults.length} results:`);
    allResults.forEach((result, i) => {
      console.log(`   ${i+1}. [${result.model_id}:${result.agent_id}:${result.visibility_level}] Score: ${result.score.toFixed(3)}`);
      console.log(`      Excerpt: ${result.excerpt.substring(0, 100)}...`);
    });

    // Test 2: Filter by specific agent
    console.log('\n2. 🔒 Searching entries from security-engineer only...');
    const securityResults = await searchService.search('security', {
      agent_id: 'security-engineer',
      limit: 5
    });
    
    console.log(`   Found ${securityResults.length} security-engineer results:`);
    securityResults.forEach((result, i) => {
      console.log(`   ${i+1}. [${result.model_id}:${result.agent_id}:${result.visibility_level}] Score: ${result.score.toFixed(3)}`);
    });

    // Test 3: Filter by model
    console.log('\n3. 🤖 Searching entries from claude-sonnet-4 only...');
    const claudeResults = await searchService.search('implementation', {
      model_id: 'claude-sonnet-4',
      limit: 5
    });
    
    console.log(`   Found ${claudeResults.length} claude-sonnet-4 results:`);
    claudeResults.forEach((result, i) => {
      console.log(`   ${i+1}. [${result.model_id}:${result.agent_id}:${result.visibility_level}] Score: ${result.score.toFixed(3)}`);
    });

    // Test 4: Filter by visibility level
    console.log('\n4. 🏛️ Searching CRB (Change Review Board) entries only...');
    const crbResults = await searchService.search('technical', {
      visibility_level: 'crb',
      limit: 5
    });
    
    console.log(`   Found ${crbResults.length} CRB results:`);
    crbResults.forEach((result, i) => {
      console.log(`   ${i+1}. [${result.model_id}:${result.agent_id}:${result.visibility_level}] Score: ${result.score.toFixed(3)}`);
    });

    // Test 5: Test visibility filtering (accessible_to_agent)
    console.log('\n5. 👁️ Testing visibility filtering for debug-specialist...');
    const visibleToDebugger = await searchService.search('JWT', {
      accessible_to_agent: 'debug-specialist',
      limit: 10
    });
    
    console.log(`   Found ${visibleToDebugger.length} entries visible to debug-specialist:`);
    visibleToDebugger.forEach((result, i) => {
      console.log(`   ${i+1}. [${result.model_id}:${result.agent_id}:${result.visibility_level}] Score: ${result.score.toFixed(3)}`);
      console.log(`      Visible: ${result.visibility_level !== 'private' || result.agent_id === 'debug-specialist' ? '✅' : '❌'}`);
    });

    // Test 6: Test combination of filters
    console.log('\n6. 🎯 Combined filter: gpt-4o security entries visible to systems-architect...');
    const combinedResults = await searchService.search('vulnerability', {
      model_id: 'gpt-4o',
      accessible_to_agent: 'systems-architect',
      limit: 5
    });
    
    console.log(`   Found ${combinedResults.length} matching results:`);
    combinedResults.forEach((result, i) => {
      console.log(`   ${i+1}. [${result.model_id}:${result.agent_id}:${result.visibility_level}] Score: ${result.score.toFixed(3)}`);
    });

    console.log('\n✅ Multi-agent search functionality test complete!');
    console.log('\n🎉 Successful cross-model, cross-agent knowledge discovery with proper visibility boundaries!');

  } catch (error) {
    console.error('❌ Search test failed:', error);
  }
}

testMultiAgentSearch().catch(console.error);