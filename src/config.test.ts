import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';

// Mock fs module
vi.mock('fs');

// Mock dotenv to prevent loading .env file during tests
vi.mock('dotenv', () => ({
  default: {
    config: vi.fn(),
  },
  config: vi.fn(),
}));

describe('config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset module cache to get fresh config each test
    vi.resetModules();
    // Create a fresh copy of env WITHOUT any values from .env file
    process.env = {
      PATH: originalEnv.PATH,
      HOME: originalEnv.HOME,
      NODE_ENV: originalEnv.NODE_ENV,
    };
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

  describe('model.default', () => {
    it('should fallback to sonnet when DEFAULT_MODEL not set', async () => {
      delete process.env.DEFAULT_MODEL;
      const { config } = await import('./config');
      expect(config.model.default).toBe('claude-sonnet-4-5-20250929');
    });

    it('should use environment variable when DEFAULT_MODEL is set', async () => {
      process.env.DEFAULT_MODEL = 'claude-opus-4-5-20251101';
      const { config } = await import('./config');
      expect(config.model.default).toBe('claude-opus-4-5-20251101');
    });
  });

  describe('validateWeeklySyncConfig', () => {
    beforeEach(() => {
      // Set required Slack env vars so main validateConfig doesn't fail
      process.env.SLACK_BOT_TOKEN = 'xoxb-test';
      process.env.SLACK_APP_TOKEN = 'xapp-test';
      process.env.SLACK_SIGNING_SECRET = 'test-secret';

      // Set valid weekly sync defaults
      process.env.WEEKLY_SYNC_ADMINS = 'U0123ADMIN';
      process.env.AIRTABLE_TOKEN = 'keyTestToken123';
      process.env.AIRTABLE_BASE_ID = 'appTestBase123';
      process.env.WEEKLY_SYNC_TIMEZONE = 'America/Los_Angeles';
    });

    it('returns warnings when WEEKLY_SYNC_ADMINS is empty', async () => {
      delete process.env.WEEKLY_SYNC_ADMINS;

      const { validateWeeklySyncConfig } = await import('./config');
      const result = validateWeeklySyncConfig();

      expect(result.warnings).toContain(
        'WEEKLY_SYNC_ADMINS not configured - no manual trigger access'
      );
    });

    it('returns warnings when AIRTABLE_TOKEN is missing with "will not function" message', async () => {
      delete process.env.AIRTABLE_TOKEN;

      const { validateWeeklySyncConfig } = await import('./config');
      const result = validateWeeklySyncConfig();

      expect(result.warnings.some((w) => w.includes('AIRTABLE_TOKEN'))).toBe(true);
      expect(result.warnings.some((w) => w.includes('will not function'))).toBe(true);
    });

    it('returns warnings when AIRTABLE_BASE_ID is missing', async () => {
      delete process.env.AIRTABLE_BASE_ID;

      const { validateWeeklySyncConfig } = await import('./config');
      const result = validateWeeklySyncConfig();

      expect(result.warnings.some((w) => w.includes('AIRTABLE_BASE_ID'))).toBe(true);
      expect(result.warnings.some((w) => w.includes('will not function'))).toBe(true);
    });

    it('returns warnings for invalid timezone', async () => {
      process.env.WEEKLY_SYNC_TIMEZONE = 'Invalid/Timezone';

      const { validateWeeklySyncConfig } = await import('./config');
      const result = validateWeeklySyncConfig();

      expect(result.warnings.some((w) => w.includes('Invalid timezone'))).toBe(true);
    });

    it('returns valid: true when critical settings are present', async () => {
      // All required settings are set in beforeEach

      const { validateWeeklySyncConfig } = await import('./config');
      const result = validateWeeklySyncConfig();

      expect(result.valid).toBe(true);
    });

    it('returns valid: false when AIRTABLE_TOKEN is missing', async () => {
      delete process.env.AIRTABLE_TOKEN;

      const { validateWeeklySyncConfig } = await import('./config');
      const result = validateWeeklySyncConfig();

      expect(result.valid).toBe(false);
    });
  });
});
