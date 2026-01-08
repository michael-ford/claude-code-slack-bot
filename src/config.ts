import dotenv from 'dotenv';
import * as fs from 'fs';

dotenv.config();

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
  debug: process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development',
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
}