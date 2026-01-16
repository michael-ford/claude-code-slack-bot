/**
 * Summary Generator
 *
 * Generates pre-meeting summaries for weekly sync by:
 * 1. Fetching update segments for each active project
 * 2. Building prompts with team member updates
 * 3. Calling claude -p CLI to generate summaries
 * 4. Posting summaries to project Slack channels
 * 5. Registering threads for tracking
 */

import type { WebClient } from '@slack/web-api';
import { exec } from 'child_process';
import { promisify } from 'util';

import type { Logger } from '../logger.js';
import type { WeeklySyncAirtableClient, ProjectRecord, UpdateSegmentRecord } from './airtable-client.js';
import type { ThreadTracker } from './thread-tracker.js';

const execAsync = promisify(exec);

/** Timeout for claude -p CLI execution (2 minutes) */
const CLAUDE_CLI_TIMEOUT = 120000;

/** Max buffer size for CLI output (10MB) */
const CLAUDE_CLI_MAX_BUFFER = 10 * 1024 * 1024;

/**
 * Result of generating a summary for a single project.
 */
export interface ProjectSummaryResult {
  projectId: string;
  projectName?: string;
  success: boolean;
  summary?: string;
  error?: string;
}

/**
 * Result from Claude CLI execution.
 */
interface ClaudeResult {
  success: boolean;
  summary?: string;
  error?: string;
}

/**
 * Result of generating summaries for all projects.
 */
export interface PreMeetingSummariesResult {
  posted: number;
  skipped: number;
  failed: number;
  results: ProjectSummaryResult[];
}

/**
 * Configuration for SummaryGenerator.
 */
export interface SummaryGeneratorConfig {
  airtableClient: WeeklySyncAirtableClient;
  threadTracker: ThreadTracker;
  slackClient: WebClient;
  logger: Logger;
  workingDirectory: string;
}

/**
 * Generates pre-meeting summaries for the weekly sync system.
 */
export class SummaryGenerator {
  private airtableClient: WeeklySyncAirtableClient;
  private threadTracker: ThreadTracker;
  private slackClient: WebClient;
  private logger: Logger;
  private workingDirectory: string;

  constructor(config: SummaryGeneratorConfig) {
    this.airtableClient = config.airtableClient;
    this.threadTracker = config.threadTracker;
    this.slackClient = config.slackClient;
    this.logger = config.logger;
    this.workingDirectory = config.workingDirectory;
  }

  /**
   * Generate pre-meeting summaries for all active projects.
   *
   * @param weekStart - ISO date string (YYYY-MM-DD) for the week start
   * @param syncCycleId - Sync cycle identifier
   * @returns Summary results for all projects
   */
  async generatePreMeetingSummaries(
    weekStart: string,
    syncCycleId: string
  ): Promise<PreMeetingSummariesResult> {
    this.logger.log(`[SummaryGenerator] Starting pre-meeting summary generation for ${weekStart}`);

    const results: ProjectSummaryResult[] = [];
    let posted = 0;
    let skipped = 0;
    let failed = 0;

    const projects = await this.airtableClient.getActiveProjects();
    this.logger.log(`[SummaryGenerator] Found ${projects.length} active projects`);

    for (const project of projects) {
      this.logger.log(`[SummaryGenerator] Processing project: ${project.name} (${project.id})`);
      const result = await this.processProject(project, weekStart, syncCycleId);
      results.push(result);

      if (result.success) {
        posted++;
        this.logger.log(`[SummaryGenerator] ✓ Posted summary for ${project.name}`);
      } else if (this.isSkippableError(result.error)) {
        skipped++;
        this.logger.log(`[SummaryGenerator] ⊘ Skipped ${project.name}: ${result.error}`);
      } else {
        failed++;
        this.logger.error(`[SummaryGenerator] ✗ Failed ${project.name}: ${result.error}`);
      }
    }

    this.logger.log(`[SummaryGenerator] Complete: ${posted} posted, ${skipped} skipped, ${failed} failed`);
    return { posted, skipped, failed, results };
  }

  /**
   * Process a single project for pre-meeting summary generation.
   */
  private async processProject(
    project: ProjectRecord,
    weekStart: string,
    syncCycleId: string
  ): Promise<ProjectSummaryResult> {
    const segments = await this.airtableClient.getUpdateSegmentsByProject(
      project.id,
      weekStart
    );

    if (segments.length === 0) {
      return {
        projectId: project.id,
        projectName: project.name,
        success: false,
        error: 'No updates for this week',
      };
    }

    if (!project.slackChannelId) {
      return {
        projectId: project.id,
        projectName: project.name,
        success: false,
        error: 'No Slack channel configured',
      };
    }

    const claudeResult = await this.executeClaudeCli(project.name, weekStart, segments);

    if (!claudeResult.success || !claudeResult.summary) {
      return {
        projectId: project.id,
        projectName: project.name,
        success: false,
        error: claudeResult.error,
      };
    }

    return this.postSummaryToSlack(
      project,
      claudeResult.summary,
      weekStart,
      syncCycleId
    );
  }

  /**
   * Post a summary to Slack and register the thread.
   */
  private async postSummaryToSlack(
    project: ProjectRecord,
    summary: string,
    weekStart: string,
    syncCycleId: string
  ): Promise<ProjectSummaryResult> {
    // Use const to avoid type assertion issues - checked by caller
    const channelId = project.slackChannelId;
    if (!channelId) {
      return {
        projectId: project.id,
        projectName: project.name,
        success: false,
        error: 'No Slack channel configured',
      };
    }

    try {
      const postResult = await this.slackClient.chat.postMessage({
        channel: channelId,
        text: summary,
      });

      await this.threadTracker.registerThread(
        {
          channelId,
          threadType: 'pre-meeting',
          syncCycleId,
          projectId: project.id,
          weekStart,
        },
        postResult.ts as string
      );

      return {
        projectId: project.id,
        projectName: project.name,
        success: true,
        summary,
      };
    } catch (error) {
      return {
        projectId: project.id,
        projectName: project.name,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Check if an error indicates the project should be skipped rather than failed.
   */
  private isSkippableError(error?: string): boolean {
    if (!error) return false;
    return error.includes('No updates') || error.includes('No Slack channel');
  }

  /**
   * Generate a summary for a single project.
   *
   * @param projectId - Airtable project record ID
   * @param weekStart - ISO date string (YYYY-MM-DD) for the week start
   * @param _syncCycleId - Sync cycle identifier (unused, kept for API compatibility)
   * @returns Summary result
   */
  async generateProjectSummary(
    projectId: string,
    weekStart: string,
    _syncCycleId: string
  ): Promise<ClaudeResult> {
    const segments = await this.airtableClient.getUpdateSegmentsByProject(
      projectId,
      weekStart
    );

    if (segments.length === 0) {
      return {
        success: false,
        error: 'No updates found for this project',
      };
    }

    return this.executeClaudeCli(projectId, weekStart, segments);
  }

  /**
   * Execute claude -p CLI to generate a summary.
   *
   * Uses single-quote shell escaping to prevent injection attacks.
   * Adds timeout and captures stderr for better error handling.
   */
  private async executeClaudeCli(
    projectName: string,
    weekStart: string,
    segments: UpdateSegmentRecord[]
  ): Promise<ClaudeResult> {
    const prompt = this.buildPrompt(projectName, weekStart, segments);

    try {
      const { stdout, stderr } = await execAsync(
        `claude -p ${this.escapeShellArg(prompt)}`,
        {
          cwd: this.workingDirectory,
          timeout: CLAUDE_CLI_TIMEOUT,
          maxBuffer: CLAUDE_CLI_MAX_BUFFER,
        }
      );

      // Log stderr as warning if present
      if (stderr) {
        this.logger.warn('[SummaryGenerator] Claude CLI stderr:', stderr);
      }

      // Handle empty output
      const trimmedOutput = stdout.trim();
      if (!trimmedOutput) {
        return {
          success: false,
          error: stderr || 'Claude CLI returned empty output',
        };
      }

      return {
        success: true,
        summary: trimmedOutput,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error('[SummaryGenerator] Claude CLI execution failed:', errorMsg);
      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  /**
   * Build a prompt for claude -p with all team member updates.
   *
   * @throws Error if inputs are invalid
   */
  private buildPrompt(
    projectIdentifier: string,
    weekStart: string,
    segments: UpdateSegmentRecord[]
  ): string {
    // Validate inputs
    if (!projectIdentifier?.trim()) {
      throw new Error('Project identifier is required');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
      throw new Error(`Invalid week start format: ${weekStart}`);
    }
    if (segments.length === 0) {
      throw new Error('At least one segment is required');
    }

    const teamUpdates = segments
      .map((segment) => this.formatSegment(segment))
      .join('\n\n');

    return `Generate a pre-meeting summary for project "${projectIdentifier}" for week ${weekStart}.

Team Updates:
${teamUpdates}

Please create a concise summary highlighting key accomplishments, blockers, and next steps.`;
  }

  /**
   * Format a single update segment for the prompt.
   */
  private formatSegment(segment: UpdateSegmentRecord): string {
    const personName = segment.personName || segment.personId;
    const lines = [
      `## ${personName}`,
      `Content: ${segment.content}`,
    ];

    if (segment.keyAccomplishments) {
      lines.push(`Key Accomplishments: ${segment.keyAccomplishments}`);
    }
    if (segment.blockers) {
      lines.push(`Blockers: ${segment.blockers}`);
    }
    if (segment.nextSteps) {
      lines.push(`Next Steps: ${segment.nextSteps}`);
    }

    return lines.join('\n');
  }

  /**
   * Escape a string for safe use as a shell argument.
   *
   * Uses single-quote wrapping which prevents ALL shell interpolation.
   * Any embedded single quotes are handled by ending the quoted section,
   * adding an escaped literal single quote, and starting a new quoted section.
   *
   * Example: "it's great" becomes "'it'\''s great'"
   *
   * @param arg - The string to escape
   * @returns A safely quoted shell argument
   */
  private escapeShellArg(arg: string): string {
    // Single quotes prevent all shell interpolation
    // To include a literal single quote, we: end quote, add escaped quote, start new quote
    return `'${arg.replace(/'/g, "'\\''")}'`;
  }
}
