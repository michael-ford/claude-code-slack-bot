import * as fs from 'fs';
import * as path from 'path';

const SLACK_FORMATTING_PATH = path.join(__dirname, 'slack-formatting.md');

let cachedTemplate: string | null = null;

/**
 * Load the Slack formatting guide prompt.
 * Template is cached after first load; current date is injected fresh per call.
 * Content is wrapped in <slack_formatting> tags.
 * Returns empty string if file doesn't exist (graceful degradation).
 */
export function loadSlackFormattingPrompt(): string {
  if (cachedTemplate === null) {
    if (!fs.existsSync(SLACK_FORMATTING_PATH)) {
      cachedTemplate = '';
    } else {
      cachedTemplate = fs.readFileSync(SLACK_FORMATTING_PATH, 'utf-8');
    }
  }

  if (!cachedTemplate) return '';

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return `<slack_formatting>
Current date: ${today}

${cachedTemplate}
</slack_formatting>`;
}
