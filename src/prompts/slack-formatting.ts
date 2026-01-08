import * as fs from 'fs';
import * as path from 'path';

const SLACK_FORMATTING_PATH = path.join(__dirname, 'slack-formatting.md');

let cachedPrompt: string | null = null;

/**
 * Load the Slack formatting guide prompt.
 * Content is wrapped in <slack_formatting> tags and cached after first load.
 * Returns empty string if file doesn't exist (graceful degradation).
 */
export function loadSlackFormattingPrompt(): string {
  if (cachedPrompt !== null) {
    return cachedPrompt;
  }

  if (!fs.existsSync(SLACK_FORMATTING_PATH)) {
    cachedPrompt = '';
    return cachedPrompt;
  }

  const content = fs.readFileSync(SLACK_FORMATTING_PATH, 'utf-8');
  cachedPrompt = `<slack_formatting>\n${content}\n</slack_formatting>`;
  return cachedPrompt;
}
