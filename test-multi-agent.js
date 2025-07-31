#!/usr/bin/env node

// Simple test script to demonstrate multi-agent journal functionality
const { JournalManager } = require('./dist/journal');
const path = require('path');

async function testMultiAgentScenario() {
  console.log('🧪 Testing Multi-Agent CMM Scenario...\n');
  
  const projectPath = path.join(__dirname, '.test-journal-project');
  const userPath = path.join(__dirname, '.test-journal-user');
  const manager = new JournalManager(projectPath, userPath);

  // Scenario: Code Review Process with multiple agents
  
  // 1. Senior Engineer implements initial feature
  console.log('1. 👨‍💻 Senior Engineer implements authentication feature...');
  await manager.writeThoughts({
    project_notes: 'Implemented JWT authentication with refresh tokens. Used bcrypt for password hashing and implemented rate limiting for login attempts.',
    technical_insights: 'The token rotation strategy should prevent most session hijacking attempts. Performance impact is minimal.',
    agent_id: 'senior-engineer',
    model_id: 'claude-sonnet-4',
    visibility_level: 'public'
  });

  // 2. Code Reviewer finds issues
  console.log('2. 🔍 Code Reviewer identifies security concerns...');
  await manager.writeThoughts({
    project_notes: 'Authentication implementation has several security issues: token expiry not properly validated, session fixation vulnerability, missing CSRF protection.',
    feelings: 'Frustrated that basic security patterns were missed. This should have been caught earlier.',
    agent_id: 'code-reviewer', 
    model_id: 'claude-sonnet-4',
    visibility_level: 'team'
  });

  // 3. Security Engineer provides expert analysis
  console.log('3. 🛡️ Security Engineer performs threat analysis...');
  await manager.writeThoughts({
    technical_insights: 'OWASP Top 10 analysis reveals: A01 (Broken Access Control), A02 (Cryptographic Failures), A05 (Security Misconfiguration). Recommend immediate remediation.',
    project_notes: 'Created security checklist for authentication flows. All future auth implementations must follow NIST guidelines.',
    agent_id: 'security-engineer',
    model_id: 'gpt-4o',
    visibility_level: 'crb'
  });

  // 4. Debug Specialist investigates
  console.log('4. 🐛 Debug Specialist traces the root cause...');
  await manager.writeThoughts({
    project_notes: 'Root cause: JWT library version 2.1.3 has known vulnerability CVE-2023-XXXX. Upgrading to 3.0.1 fixes most issues.',
    feelings: 'Should have checked dependency vulnerabilities first. Need better tooling for this.',
    technical_insights: 'Always run npm audit and check CVE databases before implementing crypto functionality.',
    agent_id: 'debug-specialist',
    model_id: 'claude-sonnet-4', 
    visibility_level: 'private'
  });

  // 5. Systems Architect provides guidance
  console.log('5. 🏗️ Systems Architect proposes solution...');
  await manager.writeThoughts({
    technical_insights: 'Long-term: implement OAuth 2.1 with PKCE. Short-term: patch existing JWT implementation with proper validation.',
    project_notes: 'Architecture decision: move to centralized identity provider within 6 months. Current patch is technical debt.',
    agent_id: 'systems-architect',
    model_id: 'gemini-2.0-pro',
    visibility_level: 'crb'
  });

  console.log('\n✅ Multi-agent scenario complete!');
  console.log('\n📁 Check the following directories for agent-organized journals:');
  console.log(`   Project: ${projectPath}`);
  console.log(`   User: ${userPath}`);
  console.log('\n🔍 Each agent\'s entries are organized by: model_id/agent_id/visibility_level/date/\n');
}

testMultiAgentScenario().catch(console.error);