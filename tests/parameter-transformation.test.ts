// ABOUTME: Test suite for parameter transformation utilities
// ABOUTME: Verifies stripFrontmatter function handles various input formats correctly

import { stripFrontmatter } from '../src/parameter-transformation';

describe('stripFrontmatter', () => {
  describe('Basic functionality', () => {
    test('removes YAML frontmatter from text', () => {
      const input = `---
title: Test Entry
date: 2024-01-01
---
This is the actual content.`;

      const result = stripFrontmatter(input);

      expect(result).toBe('This is the actual content.');
      expect(result).not.toContain('---');
      expect(result).not.toContain('title:');
    });

    test('returns text unchanged if no frontmatter', () => {
      const input = 'This is plain text without frontmatter.';

      const result = stripFrontmatter(input);

      expect(result).toBe(input);
    });

    test('handles empty string', () => {
      const result = stripFrontmatter('');

      expect(result).toBe('');
    });

    test('preserves text after frontmatter removal', () => {
      const input = `---
metadata: value
---
First paragraph.

Second paragraph with more content.`;

      const result = stripFrontmatter(input);

      expect(result).toContain('First paragraph.');
      expect(result).toContain('Second paragraph with more content.');
    });

    test('handles frontmatter with complex YAML', () => {
      const input = `---
title: Complex Entry
tags:
  - tag1
  - tag2
nested:
  key: value
---
Content here.`;

      const result = stripFrontmatter(input);

      expect(result).toBe('Content here.');
      expect(result).not.toContain('tags:');
      expect(result).not.toContain('nested:');
    });
  });

  describe('Edge cases', () => {
    test('handles text with --- markers not at start', () => {
      const input = `Some text before
---
not frontmatter
---
More text.`;

      const result = stripFrontmatter(input);

      // Should not remove these markers as they're not at the start
      expect(result).toContain('---');
      expect(result).toContain('not frontmatter');
    });

    test('handles single line frontmatter', () => {
      const input = `---
title: Short
---
Content.`;

      const result = stripFrontmatter(input);

      expect(result).toBe('Content.');
    });

    test('trims whitespace after removal', () => {
      const input = `---
metadata: value
---

Content with leading newlines.`;

      const result = stripFrontmatter(input);

      expect(result).toBe('Content with leading newlines.');
      expect(result).not.toMatch(/^\s/); // No leading whitespace
    });
  });

  describe('Line ending handling', () => {
    test('handles Unix line endings (\\n)', () => {
      const input = `---\ntitle: Unix\ndate: 2024\n---\nContent.`;

      const result = stripFrontmatter(input);

      expect(result).toBe('Content.');
    });

    test('handles Windows line endings (\\r\\n)', () => {
      const input = `---\r\ntitle: Windows\r\ndate: 2024\r\n---\r\nContent with Windows endings.`;

      const result = stripFrontmatter(input);

      expect(result).toBe('Content with Windows endings.');
      expect(result).not.toContain('---');
      expect(result).not.toContain('title:');
    });

    test('handles mixed line endings', () => {
      const input = `---\r\ntitle: Mixed\ndate: 2024\r\n---\r\nContent.`;

      const result = stripFrontmatter(input);

      expect(result).toBe('Content.');
    });

    test('handles Windows line endings in content after frontmatter', () => {
      const input = `---\r\ntitle: Test\r\n---\r\nFirst line.\r\nSecond line.`;

      const result = stripFrontmatter(input);

      expect(result).toContain('First line.');
      expect(result).toContain('Second line.');
    });
  });
});
