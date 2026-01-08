import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';

// Mock fs module
vi.mock('fs');

describe('config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset module cache to get fresh config each test
    vi.resetModules();
    // Create a fresh copy of env
    process.env = { ...originalEnv };
    // Reset all mocks
    vi.resetAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('workingDirectory.fixed', () => {
    it('should be empty string when FIXED_WORKING_DIRECTORY not set', async () => {
      delete process.env.FIXED_WORKING_DIRECTORY;
      const { config } = await import('./config');
      expect(config.workingDirectory.fixed).toBe('');
    });

    it('should contain path when FIXED_WORKING_DIRECTORY is set', async () => {
      process.env.FIXED_WORKING_DIRECTORY = '/path/to/fixed/directory';
      const { config } = await import('./config');
      expect(config.workingDirectory.fixed).toBe('/path/to/fixed/directory');
    });

    it('should handle paths with spaces', async () => {
      process.env.FIXED_WORKING_DIRECTORY = '/path/to/fixed directory/with spaces';
      const { config } = await import('./config');
      expect(config.workingDirectory.fixed).toBe('/path/to/fixed directory/with spaces');
    });
  });

  describe('validateConfig', () => {
    beforeEach(() => {
      // Set required env vars for all validateConfig tests
      process.env.SLACK_BOT_TOKEN = 'xoxb-test';
      process.env.SLACK_APP_TOKEN = 'xapp-test';
      process.env.SLACK_SIGNING_SECRET = 'test-secret';
    });

    describe('fixed working directory validation', () => {
      it('should throw error when FIXED_WORKING_DIRECTORY path does not exist', async () => {
        process.env.FIXED_WORKING_DIRECTORY = '/nonexistent/path';
        vi.mocked(fs.existsSync).mockReturnValue(false);

        const { validateConfig } = await import('./config');

        expect(() => validateConfig()).toThrow('FIXED_WORKING_DIRECTORY path does not exist');
        expect(() => validateConfig()).toThrow('/nonexistent/path');
      });

      it('should throw error when FIXED_WORKING_DIRECTORY path is a file, not a directory', async () => {
        process.env.FIXED_WORKING_DIRECTORY = '/path/to/file.txt';
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => false } as fs.Stats);

        const { validateConfig } = await import('./config');

        expect(() => validateConfig()).toThrow('FIXED_WORKING_DIRECTORY path is not a directory');
        expect(() => validateConfig()).toThrow('/path/to/file.txt');
      });

      it('should pass validation when FIXED_WORKING_DIRECTORY is a valid directory', async () => {
        process.env.FIXED_WORKING_DIRECTORY = '/valid/directory';
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as fs.Stats);

        const { validateConfig } = await import('./config');

        expect(() => validateConfig()).not.toThrow();
      });

      it('should skip validation when FIXED_WORKING_DIRECTORY is not set', async () => {
        delete process.env.FIXED_WORKING_DIRECTORY;

        const { validateConfig } = await import('./config');

        expect(() => validateConfig()).not.toThrow();
        // fs.existsSync should not be called for fixed directory validation
        expect(fs.existsSync).not.toHaveBeenCalled();
      });
    });
  });
});
