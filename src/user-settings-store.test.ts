import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Create a mutable config object
const mockConfig = {
  model: {
    default: 'claude-sonnet-4-5-20250929',
  },
  verbosity: {
    default: 'minimal' as 'minimal' | 'filtered' | 'verbose',
  },
};

// Mock config module
vi.mock('./config', () => ({
  config: mockConfig,
}));

describe('user-settings-store', () => {
  const originalModelDefault = mockConfig.model.default;
  const originalVerbosityDefault = mockConfig.verbosity.default;

  beforeEach(() => {
    vi.resetModules();
    // Reset to original defaults
    mockConfig.model.default = originalModelDefault;
    mockConfig.verbosity.default = originalVerbosityDefault;
  });

  afterEach(() => {
    // Ensure clean state
    mockConfig.model.default = originalModelDefault;
    mockConfig.verbosity.default = originalVerbosityDefault;
  });

  describe('getDefaultModel', () => {
    it('should return valid full model ID', async () => {
      mockConfig.model.default = 'claude-opus-4-5-20251101';
      const { getDefaultModel } = await import('./user-settings-store');
      expect(getDefaultModel()).toBe('claude-opus-4-5-20251101');
    });

    it('should handle lowercase alias', async () => {
      mockConfig.model.default = 'opus';
      const { getDefaultModel } = await import('./user-settings-store');
      expect(getDefaultModel()).toBe('claude-opus-4-5-20251101');
    });

    it('should handle uppercase alias', async () => {
      mockConfig.model.default = 'OPUS';
      const { getDefaultModel } = await import('./user-settings-store');
      expect(getDefaultModel()).toBe('claude-opus-4-5-20251101');
    });

    it('should handle mixed case alias', async () => {
      mockConfig.model.default = 'Sonnet';
      const { getDefaultModel } = await import('./user-settings-store');
      expect(getDefaultModel()).toBe('claude-sonnet-4-5-20250929');
    });

    it('should handle whitespace around alias', async () => {
      mockConfig.model.default = '  haiku  ';
      const { getDefaultModel } = await import('./user-settings-store');
      expect(getDefaultModel()).toBe('claude-haiku-4-5-20251001');
    });

    it('should fallback to sonnet for invalid value', async () => {
      mockConfig.model.default = 'invalid-model';
      const { getDefaultModel } = await import('./user-settings-store');
      expect(getDefaultModel()).toBe('claude-sonnet-4-5-20250929');
    });

    it('should handle mixed case full model ID', async () => {
      mockConfig.model.default = 'CLAUDE-OPUS-4-5-20251101';
      const { getDefaultModel } = await import('./user-settings-store');
      expect(getDefaultModel()).toBe('claude-opus-4-5-20251101');
    });

    it('should handle whitespace around full model ID', async () => {
      mockConfig.model.default = '  claude-haiku-4-5-20251001  ';
      const { getDefaultModel } = await import('./user-settings-store');
      expect(getDefaultModel()).toBe('claude-haiku-4-5-20251001');
    });
  });

  describe('getDefaultVerbosity', () => {
    it('should return valid verbosity level', async () => {
      mockConfig.verbosity.default = 'verbose';
      const { getDefaultVerbosity } = await import('./user-settings-store');
      expect(getDefaultVerbosity()).toBe('verbose');
    });

    it('should handle uppercase verbosity level', async () => {
      mockConfig.verbosity.default = 'FILTERED' as any;
      const { getDefaultVerbosity } = await import('./user-settings-store');
      expect(getDefaultVerbosity()).toBe('filtered');
    });

    it('should handle mixed case verbosity level', async () => {
      mockConfig.verbosity.default = 'Verbose' as any;
      const { getDefaultVerbosity } = await import('./user-settings-store');
      expect(getDefaultVerbosity()).toBe('verbose');
    });

    it('should handle whitespace around verbosity level', async () => {
      mockConfig.verbosity.default = '  minimal  ' as any;
      const { getDefaultVerbosity } = await import('./user-settings-store');
      expect(getDefaultVerbosity()).toBe('minimal');
    });

    it('should fallback to minimal for invalid value', async () => {
      mockConfig.verbosity.default = 'invalid-verbosity' as any;
      const { getDefaultVerbosity } = await import('./user-settings-store');
      expect(getDefaultVerbosity()).toBe('minimal');
    });

    it('should fallback to minimal for empty string', async () => {
      mockConfig.verbosity.default = '' as any;
      const { getDefaultVerbosity } = await import('./user-settings-store');
      expect(getDefaultVerbosity()).toBe('minimal');
    });
  });
});

