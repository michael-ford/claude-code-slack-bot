import fs from 'fs';
import path from 'path';
import { Logger } from './logger.js';
import type { VerbosityLevel } from './user-settings-store.js';

const logger = new Logger('ToolFilter');

interface ToolFilterConfig {
  showResults: string[];
}

// Default whitelist if file is missing
const DEFAULT_CONFIG: ToolFilterConfig = {
  showResults: ['Edit', 'Write', 'Bash', 'MultiEdit'],
};

let cachedConfig: ToolFilterConfig | null = null;

/**
 * Load tool filter configuration from JSON file
 */
export function loadToolFilter(): ToolFilterConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  try {
    const configPath = path.join(process.cwd(), 'tool-filter.json');
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8');
      cachedConfig = JSON.parse(data);
      logger.info('Loaded tool filter config', {
        whitelistCount: cachedConfig!.showResults.length
      });
      return cachedConfig!;
    } else {
      logger.info('No tool-filter.json found, using defaults');
      cachedConfig = DEFAULT_CONFIG;
      return cachedConfig;
    }
  } catch (error) {
    logger.error('Failed to load tool filter config, using defaults', error);
    cachedConfig = DEFAULT_CONFIG;
    return cachedConfig;
  }
}

/**
 * Reload tool filter configuration (for runtime updates)
 */
export function reloadToolFilter(): ToolFilterConfig {
  cachedConfig = null;
  return loadToolFilter();
}

/**
 * Determine if a tool result should be shown based on verbosity level
 */
export function shouldShowToolResult(
  toolName: string,
  verbosity: VerbosityLevel
): boolean {
  // Verbose: show all
  if (verbosity === 'verbose') {
    return true;
  }

  // Minimal: show none
  if (verbosity === 'minimal') {
    return false;
  }

  // Filtered: show only whitelisted
  const config = loadToolFilter();
  return config.showResults.includes(toolName);
}
