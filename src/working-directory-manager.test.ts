import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';

// Mock fs module
vi.mock('fs');

// Mock user-settings-store
vi.mock('./user-settings-store', () => ({
  userSettingsStore: {
    setUserDefaultDirectory: vi.fn(),
    getUserDefaultDirectory: vi.fn().mockReturnValue(undefined),
  },
}));

// Mock logger
vi.mock('./logger', () => ({
  Logger: class {
    debug() {}
    info() {}
    warn() {}
    error() {}
  },
}));

// Mock config module - will be configured per test
const mockConfig = {
  workingDirectory: { fixed: '' },
  baseDirectory: '',
};
vi.mock('./config', () => ({
  config: mockConfig,
}));

describe('WorkingDirectoryManager', () => {
  beforeEach(() => {
    vi.resetModules();
    // Reset mock config to defaults
    mockConfig.workingDirectory.fixed = '';
    mockConfig.baseDirectory = '';
    // Default mock implementations
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as fs.Stats);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('fixed mode', () => {
    beforeEach(() => {
      mockConfig.workingDirectory.fixed = '/fixed/path';
    });

    it('isFixedMode() returns true when FIXED_WORKING_DIRECTORY is set', async () => {
      const { WorkingDirectoryManager } = await import('./working-directory-manager');
      const manager = new WorkingDirectoryManager();
      expect(manager.isFixedMode()).toBe(true);
    });

    it('isFixedMode() returns false when FIXED_WORKING_DIRECTORY is not set', async () => {
      mockConfig.workingDirectory.fixed = '';
      const { WorkingDirectoryManager } = await import('./working-directory-manager');
      const manager = new WorkingDirectoryManager();
      expect(manager.isFixedMode()).toBe(false);
    });

    it('getFixedDirectory() returns the fixed path', async () => {
      const { WorkingDirectoryManager } = await import('./working-directory-manager');
      const manager = new WorkingDirectoryManager();
      expect(manager.getFixedDirectory()).toBe('/fixed/path');
    });

    it('getFixedDirectory() returns undefined when not in fixed mode', async () => {
      mockConfig.workingDirectory.fixed = '';
      const { WorkingDirectoryManager } = await import('./working-directory-manager');
      const manager = new WorkingDirectoryManager();
      expect(manager.getFixedDirectory()).toBeUndefined();
    });

    it('getWorkingDirectory() returns fixed path in fixed mode regardless of channel/thread', async () => {
      const { WorkingDirectoryManager } = await import('./working-directory-manager');
      const manager = new WorkingDirectoryManager();

      // Should return fixed path for any channel/thread combination
      expect(manager.getWorkingDirectory('channel1')).toBe('/fixed/path');
      expect(manager.getWorkingDirectory('channel2', 'thread1')).toBe('/fixed/path');
      expect(manager.getWorkingDirectory('channel3', undefined, 'user1')).toBe('/fixed/path');
    });

    it('setWorkingDirectory() returns error in fixed mode', async () => {
      const { WorkingDirectoryManager } = await import('./working-directory-manager');
      const manager = new WorkingDirectoryManager();

      const result = manager.setWorkingDirectory('channel1', '/new/path');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Working directory is fixed by configuration and cannot be changed');
    });

    it('setWorkingDirectory() returns error in fixed mode even for threads', async () => {
      const { WorkingDirectoryManager } = await import('./working-directory-manager');
      const manager = new WorkingDirectoryManager();

      const result = manager.setWorkingDirectory('channel1', '/new/path', 'thread1', 'user1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Working directory is fixed by configuration and cannot be changed');
    });
  });

  describe('normal mode', () => {
    beforeEach(() => {
      mockConfig.workingDirectory.fixed = '';
    });

    it('setWorkingDirectory() works normally', async () => {
      const { WorkingDirectoryManager } = await import('./working-directory-manager');
      const manager = new WorkingDirectoryManager();

      const result = manager.setWorkingDirectory('channel1', '/some/path');

      expect(result.success).toBe(true);
      expect(result.resolvedPath).toBe('/some/path');
    });

    it('getWorkingDirectory() returns undefined when not set', async () => {
      const { WorkingDirectoryManager } = await import('./working-directory-manager');
      const manager = new WorkingDirectoryManager();

      const result = manager.getWorkingDirectory('channel1');

      expect(result).toBeUndefined();
    });

    it('getWorkingDirectory() uses hierarchy (thread > channel)', async () => {
      const { WorkingDirectoryManager } = await import('./working-directory-manager');
      const manager = new WorkingDirectoryManager();

      // Set channel directory
      manager.setWorkingDirectory('channel1', '/channel/path');

      // Without thread, should return channel path
      expect(manager.getWorkingDirectory('channel1')).toBe('/channel/path');

      // Set thread-specific directory
      manager.setWorkingDirectory('channel1', '/thread/path', 'thread1');

      // With thread, should return thread path
      expect(manager.getWorkingDirectory('channel1', 'thread1')).toBe('/thread/path');

      // Without thread, should still return channel path
      expect(manager.getWorkingDirectory('channel1')).toBe('/channel/path');
    });

    it('getWorkingDirectory() falls back to channel when thread not set', async () => {
      const { WorkingDirectoryManager } = await import('./working-directory-manager');
      const manager = new WorkingDirectoryManager();

      // Set only channel directory
      manager.setWorkingDirectory('channel1', '/channel/path');

      // Even with thread specified, should fall back to channel
      expect(manager.getWorkingDirectory('channel1', 'thread-without-dir')).toBe('/channel/path');
    });
  });
});
