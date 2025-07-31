#!/usr/bin/env node

// Create sample legacy entries for testing migration
const fs = require('fs/promises');
const path = require('path');

async function createTestEntries() {
  const testDir = path.join(__dirname, '.test-legacy-journal');
  const dateDir = path.join(testDir, '2025-07-30');
  
  await fs.mkdir(dateDir, { recursive: true });
  
  // Sample 1: Entry with explicit agent prefix
  const prefixEntry = `---
title: "3:15:42 PM - July 30, 2025"
date: 2025-07-30T15:15:42.123Z
timestamp: 1753845342123
---

[code-reviewer] Found several issues in the authentication module:
- Missing input validation on login endpoints
- SQL injection vulnerability in user queries
- Session tokens not properly expired

Recommended fixes:
1. Add parameter sanitization
2. Use prepared statements
3. Implement token rotation`;

  // Sample 2: Entry with no prefix but clear domain content
  const noPrefixDomainEntry = `---
title: "4:22:18 PM - July 30, 2025"
date: 2025-07-30T16:22:18.456Z
timestamp: 1753849338456
---

Security analysis reveals potential vulnerabilities in the OAuth implementation:
- Insufficient CSRF protection
- Missing rate limiting on token endpoints
- Weak state parameter validation

This could lead to authorization code interception attacks.`;

  // Sample 3: Entry with no prefix and generic content
  const noPrefixGenericEntry = `---
title: "5:45:33 PM - July 30, 2025"
date: 2025-07-30T17:45:33.789Z
timestamp: 1753854333789
---

Working on the user dashboard implementation. Made good progress today:
- Completed the main layout component
- Added responsive design breakpoints
- Integrated with the backend API

Still need to add error handling and loading states.`;

  // Sample 4: Entry with architecture content (should infer systems-architect)
  const architectureEntry = `---
title: "6:30:15 PM - July 30, 2025"
date: 2025-07-30T18:30:15.012Z
timestamp: 1753857015012
---

System design considerations for the microservices architecture:
- Event-driven communication between services
- Distributed caching strategy with Redis
- Database sharding approach for user data

The overall architecture should support horizontal scaling.`;

  // Write test entries
  await fs.writeFile(path.join(dateDir, '15-15-42-123456.md'), prefixEntry);
  await fs.writeFile(path.join(dateDir, '16-22-18-456789.md'), noPrefixDomainEntry);
  await fs.writeFile(path.join(dateDir, '17-45-33-789012.md'), noPrefixGenericEntry);
  await fs.writeFile(path.join(dateDir, '18-30-15-012345.md'), architectureEntry);
  
  console.log('✅ Created test legacy entries:');
  console.log('   1. Entry with [code-reviewer] prefix');
  console.log('   2. Entry with security content (no prefix)');
  console.log('   3. Entry with generic content (no prefix)');
  console.log('   4. Entry with architecture content (no prefix)');
  console.log(`\n📂 Test directory: ${testDir}`);
  console.log('\n🔄 Run migration: node migrate-legacy-entries.js .test-legacy-journal');
}

createTestEntries().catch(console.error);