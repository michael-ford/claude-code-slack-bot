/**
 * Collection Manager
 *
 * Orchestrates the Friday DM collection flow for weekly sync updates.
 * Sends proactive DMs to team members and tracks threads for context injection.
 */

import type { WebClient } from '@slack/bolt';
import type { WeeklySyncAirtableClient, PersonRecord, ProjectRecord } from './airtable-client';
import type { ThreadTracker } from './thread-tracker';
import type { Logger } from '../logger';

/**
 * Options for creating a CollectionManager instance.
 */
export interface CollectionManagerOptions {
  airtableClient: WeeklySyncAirtableClient;
  threadTracker: ThreadTracker;
  slackClient: WebClient;
  logger: Logger;
}

/**
 * Result of sending collection DMs.
 */
export interface StartCollectionResult {
  sent: number;
  failed: number;
  errors: Array<{ userId: string; error: string }>;
}

/**
 * Result of sending a single DM.
 */
export interface SendDMResult {
  success: boolean;
  channelId?: string;
  threadTs?: string;
  error?: string;
}

/**
 * Context data for a collection thread.
 */
export interface CollectionContext {
  skill: string;
  personId: string;
  personName: string;
  weekStart: string;
  projects: Array<{ id: string; name: string }>;
}

/**
 * Delay helper function.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extract first name from full name.
 */
function getFirstName(fullName: string): string {
  const trimmed = fullName.trim();
  if (!trimmed) return 'there'; // Fallback greeting for empty names
  const parts = trimmed.split(/\s+/);
  return parts[0];
}

/**
 * Extract error message from unknown error type.
 */
function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Generate the Friday DM message template.
 */
function generateDMMessage(firstName: string): string {
  return `:wave: *Weekly Sync Check-In*

Hey ${firstName}! It's time for your weekly project update.

Reply to this thread and I'll help you put together your report. You can:
- Tell me what you worked on across your projects
- Ask me to look up your tasks or recent activity
- Just chat naturally and I'll organize it

When we're done, I'll show you the final report for confirmation before submitting.

_Tip: You can say "show my tasks" or "what projects am I on?" if you need a refresher._`;
}

/**
 * CollectionManager orchestrates the Friday DM collection flow.
 *
 * Responsibilities:
 * - Send proactive DMs to team members on Friday
 * - Track threads for context injection when users reply
 * - Provide context data for Claude sessions
 */
export class CollectionManager {
  private airtableClient: WeeklySyncAirtableClient;
  private threadTracker: ThreadTracker;
  private slackClient: WebClient;
  private logger: Logger;

  constructor(options: CollectionManagerOptions) {
    this.airtableClient = options.airtableClient;
    this.threadTracker = options.threadTracker;
    this.slackClient = options.slackClient;
    this.logger = options.logger;
  }

  /**
   * Start the collection process by sending DMs to all active team members.
   * Uses write-ahead pattern: create record -> send DM -> update status.
   *
   * @param weekStart - ISO date string for the Monday of this week (YYYY-MM-DD)
   * @param syncCycleId - Unique identifier for this sync cycle
   */
  async startCollection(
    weekStart: string,
    syncCycleId: string
  ): Promise<StartCollectionResult> {
    const result: StartCollectionResult = {
      sent: 0,
      failed: 0,
      errors: [],
    };

    // Get all active team members
    const teamMembers = await this.airtableClient.getActiveTeamMembers();

    // Filter out team members without Slack user ID
    const membersWithSlack = teamMembers.filter(
      (member) => member.slackUserId != null
    );

    this.logger.log(
      `Starting collection for ${membersWithSlack.length} team members (${teamMembers.length - membersWithSlack.length} skipped - no Slack ID)`
    );

    // Send DMs with rate limiting
    for (let i = 0; i < membersWithSlack.length; i++) {
      const member = membersWithSlack[i];

      // Rate limiting: 1 second delay between sends (except before first)
      if (i > 0) {
        await delay(1000);
      }

      // Write-ahead: Create Weekly Update record BEFORE sending DM
      let updateRecordId: string;
      try {
        updateRecordId = await this.airtableClient.createWeeklyUpdate({
          weekStart,
          personId: member.id,
          syncCycleId,
          dmStatus: 'Pending',
        });
      } catch (error) {
        result.failed++;
        result.errors.push({
          userId: member.slackUserId!,
          error: `Failed to create update record: ${getErrorMessage(error)}`,
        });
        continue;
      }

      // Send the DM
      const sendResult = await this.sendCollectionDM(member, weekStart, syncCycleId);

      if (sendResult.success) {
        result.sent++;

        // Update the Weekly Update record with Slack info
        try {
          await this.airtableClient.updateWeeklyUpdateSlackInfo(
            updateRecordId,
            sendResult.channelId!,
            sendResult.threadTs!
          );
        } catch (error) {
          this.logger.warn(
            `Failed to update Slack info for ${updateRecordId}: ${getErrorMessage(error)}`
          );
          // Thread is still registered below, so this is non-fatal
        }
      } else {
        result.failed++;
        result.errors.push({
          userId: member.slackUserId!,
          error: sendResult.error || 'Unknown error',
        });

        // Mark DM as failed
        try {
          await this.airtableClient.updateWeeklyUpdateDMStatus(updateRecordId, 'Failed');
        } catch (updateError) {
          this.logger.warn(
            `Failed to mark DM as failed for ${updateRecordId}: ${getErrorMessage(updateError)}`
          );
        }
      }
    }

    this.logger.log(
      `Collection complete: ${result.sent} sent, ${result.failed} failed`
    );

    return result;
  }

  /**
   * Check if a thread is a collection thread.
   *
   * @param channelId - Slack channel ID
   * @param threadTs - Slack thread timestamp
   */
  async isCollectionThread(
    channelId: string,
    threadTs: string
  ): Promise<boolean> {
    const context = await this.threadTracker.getThreadContext(channelId, threadTs);
    return context?.threadType === 'collection';
  }

  /**
   * Get the context to inject into a Claude session for a collection thread.
   *
   * @param channelId - Slack channel ID
   * @param threadTs - Slack thread timestamp
   */
  async getCollectionContext(
    channelId: string,
    threadTs: string
  ): Promise<CollectionContext | null> {
    const threadContext = await this.threadTracker.getThreadContext(channelId, threadTs);

    if (!threadContext || threadContext.threadType !== 'collection') {
      return null;
    }

    // Parse the stored context JSON
    let contextData: { personName: string; projects: Array<{ id: string; name: string }> };
    try {
      contextData = threadContext.contextJson
        ? JSON.parse(threadContext.contextJson)
        : { personName: '', projects: [] };
    } catch {
      contextData = { personName: '', projects: [] };
    }

    return {
      skill: 'weekly-sync-collection',
      personId: threadContext.personId!,
      personName: contextData.personName,
      weekStart: threadContext.weekStart,
      projects: contextData.projects,
    };
  }

  /**
   * Send a collection DM to a single user.
   *
   * @param personRecord - The person record from Airtable
   * @param weekStart - ISO date string for the Monday of this week
   * @param syncCycleId - Unique identifier for this sync cycle
   */
  async sendCollectionDM(
    personRecord: PersonRecord,
    weekStart: string,
    syncCycleId: string
  ): Promise<SendDMResult> {
    try {
      // Open DM channel
      const openResult = await this.slackClient.conversations.open({
        users: personRecord.slackUserId!,
      });

      if (!openResult.ok || !openResult.channel?.id) {
        return {
          success: false,
          error: 'Failed to open DM channel',
        };
      }

      const channelId = openResult.channel.id;

      // Get the person's active projects for context
      const allProjects = await this.airtableClient.getActiveProjects();
      const personProjects = allProjects.filter(
        (project) =>
          project.teamMemberIds.includes(personRecord.id) ||
          project.projectLeadIds.includes(personRecord.id)
      );

      // Generate and send the message
      const firstName = getFirstName(personRecord.name);
      const messageText = generateDMMessage(firstName);

      const postResult = await this.slackClient.chat.postMessage({
        channel: channelId,
        text: messageText,
      });

      if (!postResult.ok || !postResult.ts) {
        return {
          success: false,
          error: 'Failed to post message',
        };
      }

      const threadTs = postResult.ts;

      // Register the thread for tracking with context
      // Only include contextJson if there are projects to store
      const threadData: {
        channelId: string;
        threadType: 'collection';
        syncCycleId: string;
        personId: string;
        weekStart: string;
        contextJson?: string;
      } = {
        channelId,
        threadType: 'collection',
        syncCycleId,
        personId: personRecord.id,
        weekStart,
      };

      if (personProjects.length > 0) {
        threadData.contextJson = JSON.stringify({
          personName: personRecord.name,
          projects: personProjects.map((p) => ({ id: p.id, name: p.name })),
        });
      }

      await this.threadTracker.registerThread(threadData, threadTs);

      return {
        success: true,
        channelId,
        threadTs,
      };
    } catch (error) {
      return {
        success: false,
        error: getErrorMessage(error),
      };
    }
  }
}
