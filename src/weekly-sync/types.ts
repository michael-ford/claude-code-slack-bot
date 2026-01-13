/**
 * Weekly Sync System Types
 *
 * Type definitions for the automated weekly check-in system that collects
 * and distributes project updates across the team.
 */

/**
 * Lifecycle status of a weekly sync cycle.
 * Tracks the progression from creation through completion.
 */
export type SyncCycleStatus =
  | 'created'       // Initial state
  | 'sending'       // DMs being sent
  | 'collecting'    // Waiting for responses
  | 'parsing'       // Processing responses
  | 'summarizing'   // Generating summaries
  | 'complete';     // All done

/**
 * Status of an individual DM for crash recovery.
 * Used to track whether a DM was successfully sent before
 * the Airtable record was fully committed.
 */
export type DMStatus =
  | 'Pending'       // Record created, DM not yet sent
  | 'Sent'          // DM sent successfully
  | 'Failed';       // DM send failed

/**
 * Represents a weekly sync cycle.
 * Created every Monday at 8am PT to track the full lifecycle
 * of collecting and distributing updates.
 */
export interface SyncCycle {
  /** Airtable record ID */
  id: string;
  /** ISO date string for the Monday of this sync week */
  weekStart: string;
  /** Current lifecycle status */
  status: SyncCycleStatus;
  /** When this cycle was created */
  createdAt: Date;
  /** Number of DMs sent to team members */
  dmsSentCount: number;
  /** Number of responses received */
  responsesReceivedCount: number;
  /** Cutoff time for on-time responses (11am PT) */
  cutoffTime: Date;
  /** Map of project ID to Slack thread timestamp for project summaries */
  projectSummaryThreads: Record<string, string>;
}

/**
 * Tracks an individual DM sent to a team member.
 * Used for response matching and crash recovery.
 */
export interface SentDM {
  /** Weekly Update record ID in Airtable */
  airtableRecordId: string;
  /** Slack user ID of the recipient */
  userId: string;
  /** Airtable People record ID */
  personRecordId: string;
  /** Slack DM channel ID */
  channelId: string;
  /** Slack message timestamp (used for threading responses) */
  threadTs: string;
  /** When the DM was sent */
  sentAt: Date;
  /** ID of the sync cycle this DM belongs to */
  syncCycleId: string;
  /** Status for crash recovery tracking */
  dmStatus: DMStatus;
}

/**
 * A collected response from a team member.
 * Includes timestamp tracking for cutoff enforcement.
 */
export interface CollectedResponse {
  /** Slack user ID of the responder */
  userId: string;
  /** The response text content */
  text: string;
  /** Slack message timestamp (used for cutoff comparison) */
  slackTs: string;
  /** Server time when received (backup for cutoff) */
  receivedAt: Date;
  /** Thread timestamp this response belongs to */
  threadTs: string;
}

/**
 * A parsed segment of an update mapped to a specific project.
 * Multiple segments may be extracted from a single response.
 */
export interface UpdateSegment {
  /** Airtable Project record ID */
  projectId: string;
  /** Project name for display */
  projectName: string;
  /** Raw content of this segment */
  content: string;
  /** Items the person worked on */
  workedOn: string[];
  /** Upcoming items */
  comingUp: string[];
  /** Current blockers */
  blockers: string[];
  /** Questions needing answers */
  questions: string[];
  /** Confidence score for the project match (0-1) */
  confidence: number;
}

/**
 * Result of parsing a team member's response.
 * Contains matched project segments and any unmatched content.
 */
export interface ParseResult {
  /** Successfully parsed and matched project segments */
  segments: UpdateSegment[];
  /** Content that couldn't be matched to a project */
  unmatched: { text: string; reason: string }[];
  /** Updates that apply generally, not to a specific project */
  genericUpdates: string[];
}

/**
 * Status information for the weekly-sync status command.
 * Provides visibility into current cycle state.
 */
export interface SyncStatusInfo {
  /** Current cycle ID, or null if no active cycle */
  cycleId: string | null;
  /** Current status, or 'none' if no active cycle */
  status: SyncCycleStatus | 'none';
  /** ISO date string of the week start */
  weekStart: string;
  /** Number of DMs sent */
  dmsSent: number;
  /** Number of responses received */
  responsesReceived: number;
  /** Total number of expected responses */
  expectedResponses: number;
  /** Team members who haven't responded yet */
  nonResponders: { userId: string; name: string }[];
  /** Count of responses that failed to parse */
  parseFailures: number;
  /** Next scheduled run time, or null if not scheduled */
  nextScheduledRun: Date | null;
}

/**
 * Configuration shape for the weekly sync system.
 * Defines all configurable parameters for scheduling,
 * cutoffs, and retry behavior.
 */
export interface WeeklySyncConfig {
  /** Slack user IDs allowed to trigger manual syncs */
  admins: string[];
  /** Schedule configuration for when to start the sync */
  schedule: {
    /** Hour in configured timezone (0-23) */
    hour: number;
    /** Minute (0-59) */
    minute: number;
    /** Timezone for scheduling (e.g., 'America/Los_Angeles') */
    timezone: string;
  };
  /** Cutoff time configuration for on-time responses */
  cutoff: {
    /** Hour in configured timezone (0-23) */
    hour: number;
    /** Minute (0-59) */
    minute: number;
  };
  /** Grace period in minutes before marking response as "Late" */
  graceMinutes: number;
  /** Minutes to wait for additional responses before parsing */
  responseBufferMinutes: number;
  /** Minutes to wait before retrying failed parses */
  parseRetryMinutes: number;
}
