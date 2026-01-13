import dotenv from 'dotenv';
import * as fs from 'fs';

dotenv.config();

// Debug: Log loaded config values
console.log(`[Config] DEFAULT_MODEL from env: ${process.env.DEFAULT_MODEL || '(not set, using default)'}`);
console.log(`[Config] FIXED_WORKING_DIRECTORY: ${process.env.FIXED_WORKING_DIRECTORY || '(not set)'}`);

export const config = {
  slack: {
    botToken: process.env.SLACK_BOT_TOKEN!,
    appToken: process.env.SLACK_APP_TOKEN!,
    signingSecret: process.env.SLACK_SIGNING_SECRET!,
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || '', // Optional - only needed if not using Claude subscription
  },
  claude: {
    useBedrock: process.env.CLAUDE_CODE_USE_BEDROCK === '1',
    useVertex: process.env.CLAUDE_CODE_USE_VERTEX === '1',
  },
  credentials: {
    enabled: process.env.ENABLE_LOCAL_FILE_CREDENTIALS_JSON === '1',
    autoRestore: process.env.AUTOMATIC_RESTORE_CREDENTIAL === '1',
    alertChannel: process.env.CREDENTIAL_ALERT_CHANNEL || '#backend-general',
  },
  baseDirectory: process.env.BASE_DIRECTORY || '',
  workingDirectory: {
    fixed: process.env.FIXED_WORKING_DIRECTORY || '',
  },
  github: {
    appId: process.env.GITHUB_APP_ID || '',
    privateKey: process.env.GITHUB_PRIVATE_KEY || '',
    installationId: process.env.GITHUB_INSTALLATION_ID || '',
    token: process.env.GITHUB_TOKEN || '',
  },
  verbosity: {
    default: (process.env.DEFAULT_VERBOSITY as 'minimal' | 'filtered' | 'verbose') || 'minimal',
  },
  model: {
    default: process.env.DEFAULT_MODEL || 'claude-sonnet-4-5-20250929',
  },
  debug: process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development',

  /**
   * Weekly Sync Configuration
   * Settings for the Monday morning weekly update collection system
   */
  weeklySync: {
    /** Slack user IDs authorized to trigger manual syncs */
    admins: (process.env.WEEKLY_SYNC_ADMINS || '').split(',').filter(Boolean),
    /** Schedule for when DMs are sent */
    schedule: {
      hour: parseInt(process.env.WEEKLY_SYNC_SCHEDULE_HOUR || '8', 10),
      minute: parseInt(process.env.WEEKLY_SYNC_SCHEDULE_MINUTE || '0', 10),
      timezone: process.env.WEEKLY_SYNC_TIMEZONE || 'America/Los_Angeles',
    },
    /** Cutoff time for on-time responses */
    cutoff: {
      hour: parseInt(process.env.WEEKLY_SYNC_CUTOFF_HOUR || '11', 10),
      minute: parseInt(process.env.WEEKLY_SYNC_CUTOFF_MINUTE || '0', 10),
      /** Grace period in minutes before marking as "Late" */
      graceMinutes: parseInt(process.env.WEEKLY_SYNC_GRACE_MINUTES || '2', 10),
    },
    /** Parsing configuration */
    parsing: {
      /** Wait time in minutes after first response before parsing (for multi-message responses) */
      bufferMinutes: parseInt(process.env.WEEKLY_SYNC_RESPONSE_BUFFER_MINUTES || '3', 10),
      /** Retry delay in minutes for failed parses */
      retryDelayMinutes: parseInt(process.env.WEEKLY_SYNC_PARSE_RETRY_MINUTES || '30', 10),
    },
  },

  /**
   * Airtable Configuration
   * Required for weekly sync and project data access
   */
  airtable: {
    token: process.env.AIRTABLE_TOKEN || '',
    baseId: process.env.AIRTABLE_BASE_ID || '',
  },
};

export function validateConfig() {
  const required = [
    'SLACK_BOT_TOKEN',
    'SLACK_APP_TOKEN',
    'SLACK_SIGNING_SECRET',
    // ANTHROPIC_API_KEY is optional - only needed if not using Claude subscription
  ];

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  // Validate fixed working directory if set
  if (config.workingDirectory.fixed) {
    const fixedPath = config.workingDirectory.fixed;

    // Check if path exists
    if (!fs.existsSync(fixedPath)) {
      throw new Error(
        `FIXED_WORKING_DIRECTORY path does not exist: ${fixedPath}\n` +
          'Please ensure the path exists and is accessible.'
      );
    }

    // Check if path is a directory (not a file)
    const stats = fs.statSync(fixedPath);
    if (!stats.isDirectory()) {
      throw new Error(
        `FIXED_WORKING_DIRECTORY path is not a directory: ${fixedPath}\n` +
          'Please provide a path to a directory, not a file.'
      );
    }

    console.log(`[Config] Fixed working directory: ${fixedPath}`);
  }

  // Log if using Claude subscription vs API key
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('[Config] Using Claude subscription (no API key provided)');
  } else {
    console.log('[Config] Using Anthropic API key');
  }

  // Validate weekly sync configuration
  validateWeeklySyncConfig();
}

/**
 * Validates weekly sync configuration and logs warnings for incomplete settings.
 * Does not throw errors - only logs warnings to allow graceful degradation.
 */
export function validateWeeklySyncConfig(): { valid: boolean; warnings: string[] } {
  const warnings: string[] = [];
  const { weeklySync, airtable } = config;

  // Check admins configuration
  if (!weeklySync.admins || weeklySync.admins.length === 0) {
    console.warn('[Config] WARNING: WEEKLY_SYNC_ADMINS not configured - no users can trigger manual sync');
    warnings.push('WEEKLY_SYNC_ADMINS not configured - no manual trigger access');
  }

  // Validate schedule hours (0-23)
  if (weeklySync.schedule.hour < 0 || weeklySync.schedule.hour > 23) {
    console.warn(`[Config] WARNING: WEEKLY_SYNC_SCHEDULE_HOUR (${weeklySync.schedule.hour}) is invalid - must be 0-23`);
    warnings.push(`Invalid schedule hour: ${weeklySync.schedule.hour}`);
  }

  if (weeklySync.schedule.minute < 0 || weeklySync.schedule.minute > 59) {
    console.warn(`[Config] WARNING: WEEKLY_SYNC_SCHEDULE_MINUTE (${weeklySync.schedule.minute}) is invalid - must be 0-59`);
    warnings.push(`Invalid schedule minute: ${weeklySync.schedule.minute}`);
  }

  // Validate cutoff hours (0-23)
  if (weeklySync.cutoff.hour < 0 || weeklySync.cutoff.hour > 23) {
    console.warn(`[Config] WARNING: WEEKLY_SYNC_CUTOFF_HOUR (${weeklySync.cutoff.hour}) is invalid - must be 0-23`);
    warnings.push(`Invalid cutoff hour: ${weeklySync.cutoff.hour}`);
  }

  if (weeklySync.cutoff.minute < 0 || weeklySync.cutoff.minute > 59) {
    console.warn(`[Config] WARNING: WEEKLY_SYNC_CUTOFF_MINUTE (${weeklySync.cutoff.minute}) is invalid - must be 0-59`);
    warnings.push(`Invalid cutoff minute: ${weeklySync.cutoff.minute}`);
  }

  // Check if cutoff is before or same as schedule time
  const scheduleMinutes = weeklySync.schedule.hour * 60 + weeklySync.schedule.minute;
  const cutoffMinutes = weeklySync.cutoff.hour * 60 + weeklySync.cutoff.minute;
  if (cutoffMinutes <= scheduleMinutes) {
    console.warn(
      `[Config] WARNING: Cutoff time (${weeklySync.cutoff.hour}:${String(weeklySync.cutoff.minute).padStart(2, '0')}) ` +
        `is not after schedule time (${weeklySync.schedule.hour}:${String(weeklySync.schedule.minute).padStart(2, '0')})`
    );
    warnings.push('Cutoff time must be after schedule time');
  }

  // Validate timezone is valid
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: weeklySync.schedule.timezone });
  } catch {
    console.warn(`[Config] WARNING: Invalid timezone: ${weeklySync.schedule.timezone}`);
    warnings.push(`Invalid timezone: ${weeklySync.schedule.timezone}`);
  }

  // Check Airtable configuration
  if (!airtable.token) {
    console.warn('[Config] WARNING: AIRTABLE_TOKEN not configured - weekly sync will not function');
    warnings.push('AIRTABLE_TOKEN not configured - weekly sync will not function');
  }

  if (!airtable.baseId) {
    console.warn('[Config] WARNING: AIRTABLE_BASE_ID not configured - weekly sync will not function');
    warnings.push('AIRTABLE_BASE_ID not configured - weekly sync will not function');
  }

  const valid = warnings.filter((w) => w.includes('will not function')).length === 0;

  if (warnings.length > 0) {
    console.log(`[Config] Weekly sync validation: ${warnings.length} warning(s)`);
  } else {
    console.log('[Config] Weekly sync configuration validated successfully');
  }

  return { valid, warnings };
}