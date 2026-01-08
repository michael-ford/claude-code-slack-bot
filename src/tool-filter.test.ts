import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { shouldShowToolResult, loadToolFilter, reloadToolFilter } from './tool-filter';
import fs from 'fs';

// Mock fs module
vi.mock('fs');

describe('shouldShowToolResult', () => {
  beforeEach(() => {
    // Reset the cached config before each test by reloading with mock
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      showResults: ['Edit', 'Write', 'Bash', 'MultiEdit']
    }));
    reloadToolFilter();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('verbose level', () => {
    it('should show all tool results', () => {
      expect(shouldShowToolResult('Read', 'verbose')).toBe(true);
      expect(shouldShowToolResult('Grep', 'verbose')).toBe(true);
      expect(shouldShowToolResult('Edit', 'verbose')).toBe(true);
    });
  });

  describe('minimal level', () => {
    it('should hide all tool results', () => {
      expect(shouldShowToolResult('Read', 'minimal')).toBe(false);
      expect(shouldShowToolResult('Edit', 'minimal')).toBe(false);
      expect(shouldShowToolResult('Bash', 'minimal')).toBe(false);
    });
  });

  describe('filtered level', () => {
    it('should show whitelisted tools', () => {
      expect(shouldShowToolResult('Edit', 'filtered')).toBe(true);
      expect(shouldShowToolResult('Write', 'filtered')).toBe(true);
      expect(shouldShowToolResult('Bash', 'filtered')).toBe(true);
      expect(shouldShowToolResult('MultiEdit', 'filtered')).toBe(true);
    });

    it('should hide non-whitelisted tools', () => {
      expect(shouldShowToolResult('Read', 'filtered')).toBe(false);
      expect(shouldShowToolResult('Glob', 'filtered')).toBe(false);
      expect(shouldShowToolResult('Grep', 'filtered')).toBe(false);
    });
  });
});

describe('loadToolFilter', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should return default config when file missing', () => {
    // Mock file not existing
    vi.mocked(fs.existsSync).mockReturnValue(false);

    // Force reload to pick up the mock
    const config = reloadToolFilter();

    expect(config.showResults).toContain('Edit');
    expect(config.showResults).toContain('Bash');
    expect(config.showResults).toContain('Write');
    expect(config.showResults).toContain('MultiEdit');
  });

  it('should load config from file when it exists', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      showResults: ['CustomTool', 'AnotherTool']
    }));

    const config = reloadToolFilter();

    expect(config.showResults).toContain('CustomTool');
    expect(config.showResults).toContain('AnotherTool');
    expect(config.showResults).not.toContain('Edit');
  });

  it('should return default config when file has invalid JSON', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('{ invalid json }');

    const config = reloadToolFilter();

    expect(config.showResults).toContain('Edit');
    expect(config.showResults).toContain('Bash');
  });
});
