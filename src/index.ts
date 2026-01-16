import { App } from '@slack/bolt';
import type { Request, Response } from 'express';
import { config, validateConfig, validateWeeklySyncConfig } from './config';
import { ClaudeHandler } from './claude-handler';
import { SlackHandler } from './slack-handler';
import { McpManager } from './mcp-manager';
import { Logger } from './logger';
import { discoverInstallations, isGitHubAppConfigured, getGitHubAppAuth } from './github-auth.js';
import { WeeklySyncScheduler } from './weekly-sync/scheduler';
import { CollectionManager } from './weekly-sync/collection-manager';
import { SummaryGenerator } from './weekly-sync/summary-generator';
import { WeeklySyncAirtableClient } from './weekly-sync/airtable-client';
import { ThreadTracker } from './weekly-sync/thread-tracker';
import { FirefliesHandler } from './webhooks/fireflies-handler';

const logger = new Logger('Main');

async function start() {
  const startTime = Date.now();
  const timing = (label: string) => {
    const elapsed = Date.now() - startTime;
    logger.info(`[${elapsed}ms] ${label}`);
  };

  try {
    // Validate configuration
    validateConfig();
    timing('Config validated');

    logger.info('Starting Claude Code Slack bot', {
      debug: config.debug,
      useBedrock: config.claude.useBedrock,
      useVertex: config.claude.useVertex,
    });

    // Initialize Slack app
    const app = new App({
      token: config.slack.botToken,
      signingSecret: config.slack.signingSecret,
      socketMode: true,
      appToken: config.slack.appToken,
    });
    timing('Slack App initialized');

    // Initialize MCP manager
    const mcpManager = new McpManager();
    const mcpConfig = mcpManager.loadConfiguration();
    timing(`MCP config loaded (${mcpConfig ? Object.keys(mcpConfig.mcpServers).length : 0} servers)`);

    // Initialize GitHub App authentication and auto-refresh if configured
    if (isGitHubAppConfigured()) {
      await discoverInstallations();
      timing('GitHub installations discovered');

      // Start auto-refresh for GitHub App tokens
      const githubAuth = getGitHubAppAuth();
      if (githubAuth) {
        try {
          await githubAuth.startAutoRefresh();
          timing('GitHub App token auto-refresh started');
          logger.info('GitHub App token auto-refresh initialized');
        } catch (error) {
          logger.error('Failed to start GitHub App token auto-refresh:', error);
        }
      }
    }

    // Initialize handlers
    const claudeHandler = new ClaudeHandler(mcpManager);
    timing('ClaudeHandler initialized');

    const slackHandler = new SlackHandler(app, claudeHandler, mcpManager);
    timing('SlackHandler initialized');

    // Setup event handlers
    slackHandler.setupEventHandlers();
    timing('Event handlers setup');

    // Load saved sessions from previous run
    const loadedSessions = slackHandler.loadSavedSessions();
    timing(`Sessions loaded (${loadedSessions} restored)`);
    if (loadedSessions > 0) {
      logger.info(`Restored ${loadedSessions} sessions from previous run`);
    }

    // Initialize Weekly Sync components (if config is valid)
    let weeklySyncScheduler: WeeklySyncScheduler | null = null;
    const weeklySyncValidation = validateWeeklySyncConfig();
    if (weeklySyncValidation.valid) {
      try {
        // Shared dependencies for weekly sync components
        const weeklySyncAirtableClient = new WeeklySyncAirtableClient();
        const threadTracker = new ThreadTracker(weeklySyncAirtableClient);
        const workingDirectory = config.baseDirectory || process.cwd();

        // Initialize scheduler
        const collectionManager = new CollectionManager({
          airtableClient: weeklySyncAirtableClient,
          threadTracker,
          slackClient: app.client,
          logger,
        });
        const summaryGenerator = new SummaryGenerator({
          airtableClient: weeklySyncAirtableClient,
          threadTracker,
          slackClient: app.client,
          logger,
          workingDirectory,
        });
        weeklySyncScheduler = new WeeklySyncScheduler({
          collectionManager,
          summaryGenerator,
          timezone: config.weeklySync.collection.timezone,
          logger,
          collectionHour: config.weeklySync.collection.hour,
          summaryHour: config.weeklySync.summary.hour,
        });
        weeklySyncScheduler.start();
        timing('Weekly sync scheduler started');

        // Initialize Fireflies webhook handler (shares weekly sync dependencies)
        const firefliesHandler = new FirefliesHandler({
          airtableClient: weeklySyncAirtableClient,
          threadTracker,
          slackClient: app.client,
          logger,
          workingDirectory,
        });

        // ⚠️  DISABLED: Fireflies webhook route
        //
        // This bot currently uses Socket Mode, which does NOT support HTTP webhooks.
        // DO NOT simply uncomment this code - it will not work with the current architecture.
        //
        // TO ENABLE FIREFLIES WEBHOOKS:
        //
        // 1. SWITCH TO EXPRESS RECEIVER:
        //    - Replace Socket Mode initialization (lines 37-42) with ExpressReceiver
        //    - Example:
        //      const receiver = new ExpressReceiver({
        //        signingSecret: config.slack.signingSecret,
        //        endpoints: '/slack/events'
        //      });
        //      const app = new App({ receiver });
        //    - Remove appToken config (not needed for HTTP mode)
        //    - Update deployment to expose HTTP port (3000 by default)
        //
        // 2. ADD ENVIRONMENT VARIABLES:
        //    FIREFLIES_API_KEY=<your-api-key>
        //    FIREFLIES_WEBHOOK_SECRET=<your-webhook-secret>
        //
        // 3. CONFIGURE FIREFLIES:
        //    - Log into Fireflies dashboard
        //    - Go to Integrations > Webhooks
        //    - Add webhook URL: https://your-domain.com/webhooks/fireflies
        //    - Set webhook secret (must match FIREFLIES_WEBHOOK_SECRET)
        //    - Select events: transcript.ready
        //
        // 4. UPDATE CONFIG VALIDATION:
        //    - Add Fireflies config validation in src/config.ts
        //    - Check for required environment variables
        //
        // 5. DEPLOY WITH HTTPS:
        //    - Fireflies requires HTTPS endpoints
        //    - Use reverse proxy (nginx/Caddy) or cloud hosting
        //
        // 6. THEN UNCOMMENT:
        //    app.receiver.app.post('/webhooks/fireflies', (req: Request, res: Response) => {
        //      firefliesHandler.handleWebhook(req, res);
        //    });
        //
        // See: https://docs.fireflies.ai/webhooks for Fireflies webhook documentation
        // See: https://slack.dev/bolt-js/concepts#receiver for Slack Bolt receiver options
        timing('Fireflies handler initialized (webhook disabled)');
      } catch (error) {
        logger.error('Failed to initialize weekly sync scheduler:', error);
        logger.warn('Bot is running without weekly sync functionality');
      }
    } else {
      logger.warn('Weekly sync scheduler not started due to invalid configuration');
      logger.warn('Bot is running without weekly sync functionality');
    }

    // Start the app
    await app.start();
    timing('Slack socket connected');
    logger.info('⚡️ Claude Code Slack bot is running!');

    // Handle graceful shutdown
    let isShuttingDown = false;
    const cleanup = async () => {
      if (isShuttingDown) return;
      isShuttingDown = true;

      logger.info('Shutting down gracefully...');

      try {
        // Notify all active sessions about shutdown
        await slackHandler.notifyShutdown();

        // Save sessions for persistence
        slackHandler.saveSessions();
        logger.info('Sessions saved successfully');
      } catch (error) {
        logger.error('Error during shutdown:', error);
      }

      const githubAuth = getGitHubAppAuth();
      if (githubAuth) {
        githubAuth.stopAutoRefresh();
        logger.info('GitHub App auto-refresh stopped');
      }

      if (weeklySyncScheduler) {
        weeklySyncScheduler.stop();
        logger.info('Weekly sync scheduler stopped');
      }

      process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    logger.info('Configuration:', {
      usingBedrock: config.claude.useBedrock,
      usingVertex: config.claude.useVertex,
      usingAnthropicAPI: !config.claude.useBedrock && !config.claude.useVertex,
      debugMode: config.debug,
      baseDirectory: config.baseDirectory || 'not set',
      mcpServers: mcpConfig ? Object.keys(mcpConfig.mcpServers).length : 0,
      mcpServerNames: mcpConfig ? Object.keys(mcpConfig.mcpServers) : [],
    });
  } catch (error) {
    logger.error('Failed to start the bot', error);
    process.exit(1);
  }
}

start();