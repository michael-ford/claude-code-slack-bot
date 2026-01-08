import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';

// Mock fs module
vi.mock('fs');

describe('slack-formatting prompt loader', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
  });

  describe('loadSlackFormattingPrompt', () => {
    it('should return content wrapped in <slack_formatting> tags', async () => {
      const mockContent = '# Test formatting guide';
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(mockContent);

      const { loadSlackFormattingPrompt } = await import('./slack-formatting');
      const result = loadSlackFormattingPrompt();

      expect(result).toContain('<slack_formatting>');
      expect(result).toContain('</slack_formatting>');
      expect(result).toContain(mockContent);
    });

    it('should return empty string if file does not exist', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const { loadSlackFormattingPrompt } = await import('./slack-formatting');
      const result = loadSlackFormattingPrompt();

      expect(result).toBe('');
    });

    it('should cache content after first load', async () => {
      const mockContent = '# Test formatting guide';
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(mockContent);

      const { loadSlackFormattingPrompt } = await import('./slack-formatting');

      // Call twice
      loadSlackFormattingPrompt();
      loadSlackFormattingPrompt();

      // File should only be read once
      expect(fs.readFileSync).toHaveBeenCalledTimes(1);
    });
  });
});
