/**
 * Fireflies Webhook Handler
 *
 * Processes Fireflies.ai webhook events for meeting transcriptions:
 * 1. Verifies webhook signature using HMAC-SHA256 (if secret configured)
 * 2. Fetches transcript via CLI script
 * 3. Matches meeting title to project in Airtable
 * 4. Generates post-meeting notes via claude -p
 * 5. Posts to Slack (as reply to pre-meeting thread if exists)
 * 6. Registers thread for tracking
 */

import type { Request, Response } from 'express';
import type { WebClient } from '@slack/web-api';
import { exec } from 'child_process';
import { promisify } from 'util';
import { createHmac, timingSafeEqual } from 'crypto';

import type { Logger } from '../logger.js';
import type { WeeklySyncAirtableClient, ProjectRecord } from '../weekly-sync/airtable-client.js';
import type { ThreadTracker } from '../weekly-sync/thread-tracker.js';

const execAsync = promisify(exec);

/** Timeout for CLI execution (2 minutes) */
const CLI_TIMEOUT = 120000;

/** Max buffer size for CLI output (10MB) */
const CLI_MAX_BUFFER = 10 * 1024 * 1024;

/** Log prefix for consistent logging */
const LOG_PREFIX = '[FirefliesHandler]';

/**
 * Extract error message from unknown error type.
 */
function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Calculate the Monday of the week containing a given date.
 * Used for deriving syncCycleId from meeting date.
 */
function getWeekStart(dateStr: string): string {
  const date = new Date(dateStr);
  const day = date.getUTCDay();
  // Adjust to Monday (day 1). If Sunday (0), go back 6 days.
  const diff = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + diff);
  return date.toISOString().split('T')[0];
}

/**
 * Configuration for FirefliesHandler.
 */
export interface FirefliesHandlerConfig {
  airtableClient: WeeklySyncAirtableClient;
  threadTracker: ThreadTracker;
  slackClient: WebClient;
  logger: Logger;
  workingDirectory: string;
  webhookSecret?: string;
}

/**
 * Result of processing a transcription.
 */
export interface TranscriptionResult {
  success: boolean;
  projectId?: string;
  channelId?: string;
  threadTs?: string;
  error?: string;
}

/**
 * Transcript data from Fireflies API.
 */
interface FirefliesTranscript {
  id: string;
  title: string;
  date: string;
  duration: number;
  transcript_url: string;
  participants: string[];
  summary: {
    action_items: string;
    gist: string;
    overview: string;
    topics_discussed: string[];
  };
  sentences: Array<{
    speaker_name: string;
    text: string;
    start_time: number;
    end_time: number;
  }>;
}

/**
 * Handles Fireflies.ai webhook events for meeting transcriptions.
 */
export class FirefliesHandler {
  private airtableClient: WeeklySyncAirtableClient;
  private threadTracker: ThreadTracker;
  private slackClient: WebClient;
  private logger: Logger;
  private workingDirectory: string;
  private webhookSecret?: string;

  constructor(config: FirefliesHandlerConfig) {
    this.airtableClient = config.airtableClient;
    this.threadTracker = config.threadTracker;
    this.slackClient = config.slackClient;
    this.logger = config.logger;
    this.workingDirectory = config.workingDirectory;
    this.webhookSecret = config.webhookSecret;
  }

  /**
   * Handle incoming webhook from Fireflies.
   */
  async handleWebhook(req: Request, res: Response): Promise<void> {
    this.logger.log(`${LOG_PREFIX} Received webhook`);

    // Verify signature if secret configured
    if (this.webhookSecret) {
      const signature = req.headers['x-fireflies-signature'] as string;
      const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);

      if (!this.verifySignature(signature, rawBody)) {
        this.logger.warn(`${LOG_PREFIX} Invalid webhook signature`);
        res.status(401).json({ success: false, error: 'Invalid signature' });
        return;
      }
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { meetingId, eventType } = body;

    // Validate meetingId
    if (!meetingId) {
      this.logger.warn(`${LOG_PREFIX} Missing meetingId in webhook`);
      res.status(400).json({ success: false, error: 'Missing meetingId' });
      return;
    }

    // Skip non-transcription events
    if (eventType !== 'Transcription completed') {
      this.logger.log(`${LOG_PREFIX} Ignoring event type: ${eventType}`);
      res.status(200).json({
        success: true,
        message: `Ignoring event type: ${eventType}`,
      });
      return;
    }

    this.logger.log(`${LOG_PREFIX} Processing transcription for meeting ${meetingId}`);

    // Process transcription
    const result = await this.processTranscription(meetingId);
    res.status(200).json(result);
  }

  /**
   * Verify webhook signature using HMAC-SHA256.
   *
   * @param signature - The signature from the request header
   * @param payload - The raw request body
   * @returns true if signature is valid
   */
  private verifySignature(signature: string, payload: string): boolean {
    if (!this.webhookSecret || !signature) {
      return false;
    }

    try {
      const hmac = createHmac('sha256', this.webhookSecret);
      hmac.update(payload);
      const expectedSignature = hmac.digest('hex');

      // Use constant-time comparison to prevent timing attacks
      const signatureBuffer = Buffer.from(signature);
      const expectedBuffer = Buffer.from(expectedSignature);

      if (signatureBuffer.length !== expectedBuffer.length) {
        return false;
      }

      return timingSafeEqual(signatureBuffer, expectedBuffer);
    } catch {
      return false;
    }
  }

  /**
   * Process a meeting transcription.
   */
  async processTranscription(meetingId: string): Promise<TranscriptionResult> {
    // Fetch transcript via CLI
    this.logger.log(`${LOG_PREFIX} Fetching transcript for ${meetingId}...`);
    let transcript: FirefliesTranscript;
    try {
      transcript = await this.fetchTranscript(meetingId);
      this.logger.log(`${LOG_PREFIX} Fetched transcript: "${transcript.title}"`);
    } catch (error) {
      const errorMsg = getErrorMessage(error);
      this.logger.error(`${LOG_PREFIX} Failed to fetch transcript: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }

    // Validate transcript has required fields
    if (!transcript.id || !transcript.title || !transcript.date) {
      const errorMsg = 'Transcript missing required fields (id, title, or date)';
      this.logger.error(`${LOG_PREFIX} ${errorMsg}`);
      return { success: false, error: errorMsg };
    }

    // Match meeting to project
    this.logger.log(`${LOG_PREFIX} Matching meeting to project...`);
    const project = await this.matchMeetingToProject(transcript.title);
    if (!project) {
      this.logger.warn(`${LOG_PREFIX} No project match for "${transcript.title}"`);
      return { success: false, error: 'Could not match meeting to project' };
    }
    this.logger.log(`${LOG_PREFIX} Matched to project: ${project.name} (${project.id})`);

    // Check project has Slack channel
    if (!project.slackChannelId) {
      this.logger.warn(`${LOG_PREFIX} Project ${project.name} has no Slack channel`);
      return { success: false, error: 'Project has no Slack channel configured' };
    }

    // Generate post-meeting notes via claude -p
    this.logger.log(`${LOG_PREFIX} Generating post-meeting notes...`);
    let notes: string;
    try {
      notes = await this.generateNotes(transcript);
      this.logger.log(`${LOG_PREFIX} Generated notes (${notes.length} chars)`);
    } catch (error) {
      const errorMsg = getErrorMessage(error);
      this.logger.error(`${LOG_PREFIX} Failed to generate notes: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }

    // Post to Slack (as reply to pre-meeting thread if exists)
    return this.postNotesToSlack(project, notes, transcript.date);
  }

  /**
   * Post notes to Slack and register thread for tracking.
   */
  private async postNotesToSlack(
    project: ProjectRecord,
    notes: string,
    meetingDate: string
  ): Promise<TranscriptionResult> {
    const channelId = project.slackChannelId!;
    const weekStart = getWeekStart(meetingDate);
    const syncCycleId = `sync-${weekStart}-001`;

    this.logger.log(`${LOG_PREFIX} Looking for pre-meeting thread (${syncCycleId})...`);

    // Find pre-meeting thread to reply to
    const existingThread = await this.threadTracker.findThreadBySyncCycle(
      channelId,
      syncCycleId,
      'pre-meeting'
    );

    const threadTs = existingThread?.threadTs;
    if (threadTs) {
      this.logger.log(`${LOG_PREFIX} Found pre-meeting thread: ${threadTs}`);
    } else {
      this.logger.log(`${LOG_PREFIX} No pre-meeting thread found, posting as new message`);
    }

    try {
      const postResult = await this.slackClient.chat.postMessage({
        channel: channelId,
        text: notes,
        thread_ts: threadTs,
      });

      const newThreadTs = postResult.ts as string;
      this.logger.log(`${LOG_PREFIX} Posted to Slack: ${channelId}/${newThreadTs}`);

      // Register thread for tracking (non-blocking - don't fail if this fails)
      try {
        await this.threadTracker.registerThread(
          {
            channelId,
            threadType: 'post-meeting',
            syncCycleId,
            projectId: project.id,
            weekStart,
          },
          newThreadTs
        );
        this.logger.log(`${LOG_PREFIX} Registered post-meeting thread`);
      } catch (trackingError) {
        // Log but don't fail - message was already posted
        this.logger.error(
          `${LOG_PREFIX} Failed to register thread: ${getErrorMessage(trackingError)}`
        );
      }

      return {
        success: true,
        projectId: project.id,
        channelId,
        threadTs: newThreadTs,
      };
    } catch (error) {
      const errorMsg = getErrorMessage(error);
      this.logger.error(`${LOG_PREFIX} Failed to post to Slack: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Fetch transcript from Fireflies via CLI.
   */
  private async fetchTranscript(meetingId: string): Promise<FirefliesTranscript> {
    // Validate meetingId to prevent command injection
    if (!/^[\w-]+$/.test(meetingId)) {
      throw new Error(`Invalid meetingId format: ${meetingId}`);
    }

    const command = `npm run get-transcript -- ${meetingId}`;

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: this.workingDirectory,
        timeout: CLI_TIMEOUT,
        maxBuffer: CLI_MAX_BUFFER,
      });

      if (stderr) {
        this.logger.warn(`${LOG_PREFIX} get-transcript stderr: ${stderr}`);
      }

      let result;
      try {
        result = JSON.parse(stdout);
      } catch (parseError) {
        throw new Error(`Failed to parse transcript JSON: ${stdout.substring(0, 200)}`);
      }

      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch transcript');
      }

      return result.transcript;
    } catch (error) {
      const errorMsg = getErrorMessage(error);
      this.logger.error(`${LOG_PREFIX} get-transcript failed: ${errorMsg}`);
      throw error;
    }
  }

  /**
   * Generate post-meeting notes via claude -p CLI.
   */
  private async generateNotes(transcript: FirefliesTranscript): Promise<string> {
    const prompt = this.buildNotesPrompt(transcript);

    try {
      const { stdout, stderr } = await execAsync(
        `claude -p ${this.escapeShellArg(prompt)}`,
        {
          cwd: this.workingDirectory,
          timeout: CLI_TIMEOUT,
          maxBuffer: CLI_MAX_BUFFER,
        }
      );

      if (stderr) {
        this.logger.warn(`${LOG_PREFIX} claude stderr: ${stderr}`);
      }

      const trimmed = stdout.trim();
      if (!trimmed) {
        throw new Error('Claude returned empty output');
      }

      return trimmed;
    } catch (error) {
      const errorMsg = getErrorMessage(error);
      this.logger.error(`${LOG_PREFIX} claude -p failed: ${errorMsg}`);
      throw error;
    }
  }

  /**
   * Build prompt for generating post-meeting notes.
   */
  private buildNotesPrompt(transcript: FirefliesTranscript): string {
    // Safely extract values with fallbacks
    const title = transcript.title || 'Unknown Meeting';
    const date = transcript.date || 'Unknown Date';
    const participants = transcript.participants?.join(', ') || 'Unknown';
    const overview = transcript.summary?.overview || 'No overview available';
    const actionItems = transcript.summary?.action_items || 'No action items';
    const topics = transcript.summary?.topics_discussed?.join(', ') || 'No topics listed';

    return `Generate post-meeting notes for "${title}".

Meeting Date: ${date}
Participants: ${participants}

Summary:
${overview}

Action Items:
${actionItems}

Topics Discussed:
${topics}

Please create concise meeting notes highlighting key decisions, action items, and next steps.`;
  }

  /**
   * Match a meeting title to a project in Airtable.
   *
   * Supports patterns:
   * - [Project Name] Weekly Sync
   * - Project Name - Weekly Sync
   * - Project Name: Weekly Sync
   */
  async matchMeetingToProject(title: string): Promise<ProjectRecord | null> {
    const projectName = this.extractProjectName(title);
    if (!projectName) {
      return null;
    }

    const projects = await this.airtableClient.getActiveProjects();
    const normalizedSearch = projectName.toLowerCase();

    return projects.find(
      (project) => project.name.toLowerCase() === normalizedSearch
    ) ?? null;
  }

  /**
   * Extract project name from meeting title.
   */
  private extractProjectName(title: string): string | null {
    // Pattern: [Project Name] ...
    const bracketMatch = title.match(/^\[([^\]]+)\]/);
    if (bracketMatch) {
      return bracketMatch[1];
    }

    // Pattern: Project Name - ...
    const dashMatch = title.match(/^(.+?)\s*-\s/);
    if (dashMatch) {
      return dashMatch[1].trim();
    }

    // Pattern: Project Name: ...
    const colonMatch = title.match(/^(.+?)\s*:\s/);
    if (colonMatch) {
      return colonMatch[1].trim();
    }

    return null;
  }

  /**
   * Escape a string for safe use as a shell argument.
   *
   * Uses single-quote wrapping which prevents ALL shell interpolation.
   */
  private escapeShellArg(arg: string): string {
    return `'${arg.replace(/'/g, "'\\''")}'`;
  }
}
