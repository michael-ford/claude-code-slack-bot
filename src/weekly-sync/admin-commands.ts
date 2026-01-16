/**
 * Admin commands for the Weekly Sync system.
 *
 * Provides command parsing for weekly-sync admin operations.
 *
 * IMPORTANT: This is a parsing layer only. Permission validation
 * (checking if the user is an admin) must be implemented at the
 * integration point in slack-handler.ts before executing actions.
 *
 * @see thoughts/plans/2026-01-12_weekly-sync-system.md Phase 8
 */

/**
 * Pattern matching weekly-sync command variants.
 * Matches: weekly-sync, weekly_sync, weeklysync, wsync (case-insensitive)
 */
const COMMAND_PATTERN = 'weekly[-_]?sync|wsync';

/**
 * Pre-compiled regex to check if text starts with a weekly-sync command.
 * Optional leading slash.
 */
const IS_COMMAND_REGEX = new RegExp(`^\\/?(?:${COMMAND_PATTERN})(?:\\s|$)`, 'i');

/**
 * Pre-compiled regex to match and extract project name from summary subcommand.
 */
const SUMMARY_PATTERN_REGEX = new RegExp(`^\\/?(?:${COMMAND_PATTERN})\\s+summary\\s*`, 'i');

export type WeeklySyncAction =
  | { action: 'status' }
  | { action: 'start'; dryRun: boolean }
  | { action: 'test'; targetUserId: string }
  | { action: 'summary'; projectName?: string }
  | { action: 'help' };

export class WeeklySyncCommands {
  /**
   * Check if text is a weekly-sync command.
   * Optional leading slash.
   */
  static isWeeklySyncCommand(text: string): boolean {
    return IS_COMMAND_REGEX.test(text.trim());
  }

  /**
   * Parse command into action object.
   * Subcommands: status, start, test, summary, help
   */
  static parseWeeklySyncCommand(text: string): WeeklySyncAction {
    // Normalize whitespace: trim and replace multiple whitespace with single space
    const normalized = text.trim().replace(/\s+/g, ' ');

    // Split into parts
    const parts = normalized.split(' ');

    // First part is the command itself (weekly-sync, wsync, etc.)
    // Second part is the subcommand
    const subcommand = parts[1]?.toLowerCase();

    if (!subcommand) {
      return { action: 'help' };
    }

    switch (subcommand) {
      case 'status':
        return { action: 'status' };

      case 'start': {
        // Check for --dry-run or --dryrun flag
        const dryRun = parts.slice(2).some(
          (p) => p.toLowerCase() === '--dry-run' || p.toLowerCase() === '--dryrun'
        );
        return { action: 'start', dryRun };
      }

      case 'test': {
        const targetArg = parts[2];
        if (!targetArg) {
          return { action: 'help' };
        }
        // Parse Slack mention formats: <@U12345> or <@U12345|username>
        const slackMentionMatch = targetArg.match(/^<@([A-Z0-9]+)(?:\|[^>]+)?>$/);
        const userId = slackMentionMatch ? slackMentionMatch[1] : targetArg;

        // Validate user ID format: must start with U followed by alphanumeric characters
        if (!/^U[A-Z0-9]+$/i.test(userId)) {
          return { action: 'help' };
        }

        return { action: 'test', targetUserId: userId };
      }

      case 'summary': {
        // Extract project name from original text to preserve internal whitespace.
        // We use 'text' (not 'normalized') because project names like "Project  Name"
        // should keep their internal whitespace, only trimming leading/trailing.
        const trimmed = text.trim();
        const summaryMatch = trimmed.match(SUMMARY_PATTERN_REGEX);
        if (summaryMatch) {
          const projectNamePart = trimmed.slice(summaryMatch[0].length).trim();
          if (projectNamePart) {
            // Validate project name length to prevent injection attacks
            if (projectNamePart.length > 200) {
              return { action: 'help' };
            }
            return { action: 'summary', projectName: projectNamePart };
          }
        }
        return { action: 'summary' };
      }

      default:
        return { action: 'help' };
    }
  }
}
