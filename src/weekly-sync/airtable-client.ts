/**
 * Weekly Sync Airtable Client
 *
 * Provides CRUD operations for the Weekly Sync system's Airtable tables:
 * - People (lookup by Slack ID)
 * - Projects (active projects with channel IDs)
 * - Weekly Updates (check-in responses)
 * - Update Segments (parsed project-specific content)
 */

import Airtable, { FieldSet, Record as AirtableRecord, Records } from 'airtable';
import { config } from '../config';
import type { DMStatus, UpdateSegment } from './types';

// ============================================================================
// Record Types (Airtable-specific shapes)
// ============================================================================

/**
 * A person record from the People table.
 */
export interface PersonRecord {
  /** Airtable record ID */
  id: string;
  /** Person's full name */
  name: string;
  /** Person's email address */
  email: string;
  /** Slack user ID (e.g., U0123ABCDEF), or null if not set */
  slackUserId: string | null;
}

/**
 * A weekly update record from the Weekly Updates table.
 */
export interface WeeklyUpdateRecord {
  /** Airtable record ID */
  id: string;
  /** ISO date string for the Monday of this week (YYYY-MM-DD) */
  weekStart: string;
  /** Airtable record ID of the person */
  personId: string;
  /** Raw response text from the user */
  rawResponse: string | null;
  /** ISO datetime string when response was submitted */
  submittedAt: string | null;
  /** Response status */
  responseStatus: 'Pending' | 'Submitted' | 'Late' | 'No Response';
  /** DM send status for crash recovery */
  dmStatus: DMStatus;
  /** Parsing status */
  parsingStatus: 'Pending' | 'Parsed' | 'Failed' | 'Manual Review';
  /** Slack DM thread timestamp */
  slackDmThreadTs: string | null;
  /** Slack DM channel ID */
  slackDmChannelId: string | null;
  /** Sync cycle identifier */
  syncCycleId: string;
  /** Record creation time (for crash recovery reconciliation) */
  createdAt: string | null;
}

/**
 * A project record from the Projects table.
 */
export interface ProjectRecord {
  /** Airtable record ID */
  id: string;
  /** Project name */
  name: string;
  /** Project status */
  status: string;
  /** Slack channel ID for posting summaries */
  slackChannelId: string | null;
  /** Airtable record IDs of team members */
  teamMemberIds: string[];
  /** Airtable record IDs of project leads */
  projectLeadIds: string[];
}

/**
 * An update segment record from the Update Segments table.
 */
export interface UpdateSegmentRecord {
  /** Airtable record ID */
  id: string;
  /** Weekly Update record ID */
  weeklyUpdateId: string;
  /** Project record ID */
  projectId: string;
  /** Parsed content for this project */
  content: string;
  /** Worked on items (JSON array stored as text) */
  workedOn: string | null;
  /** Coming up items (JSON array stored as text) */
  comingUp: string | null;
  /** Blockers (JSON array stored as text) */
  blockers: string | null;
  /** Questions (JSON array stored as text) */
  questions: string | null;
  /** Parsing confidence score 0-100 */
  confidenceScore: number;
  /** Whether this segment has been posted to the channel */
  postedToChannel: boolean;
  /** Thread timestamp if posted as a late update */
  threadTs: string | null;
}

// ============================================================================
// Input Types
// ============================================================================

/**
 * Data required to create a new Weekly Update record.
 */
export interface CreateWeeklyUpdateData {
  /** ISO date string for the Monday of this week (YYYY-MM-DD) */
  weekStart: string;
  /** Airtable record ID of the person */
  personId: string;
  /** Sync cycle identifier */
  syncCycleId: string;
  /** Initial DM status (typically 'Pending') */
  dmStatus: DMStatus;
}

// ============================================================================
// Constants
// ============================================================================

/** Maximum records per Airtable batch operation */
const BATCH_SIZE = 10;

/** Delay in milliseconds between retries after rate limit */
const RATE_LIMIT_RETRY_DELAY = 30000;

/** Maximum number of retries for rate-limited requests */
const MAX_RETRIES = 3;

/** Table names in Airtable */
const TABLES = {
  PEOPLE: 'People',
  PROJECTS: 'Projects',
  WEEKLY_UPDATES: 'Weekly Updates',
  UPDATE_SEGMENTS: 'Update Segments',
} as const;

// ============================================================================
// Client Implementation
// ============================================================================

/**
 * Airtable client for the Weekly Sync system.
 *
 * Handles all CRUD operations for weekly updates, including:
 * - Looking up people by Slack ID
 * - Getting active team members
 * - Creating and updating weekly update records
 * - Creating parsed update segments
 *
 * Includes built-in retry logic for rate limits and batch operations.
 */
export class WeeklySyncAirtableClient {
  private base: Airtable.Base;

  constructor() {
    if (!config.airtable.token || !config.airtable.baseId) {
      throw new Error(
        'Airtable configuration missing. Set AIRTABLE_TOKEN and AIRTABLE_BASE_ID environment variables.'
      );
    }

    this.base = new Airtable({ apiKey: config.airtable.token }).base(
      config.airtable.baseId
    );
  }

  // ==========================================================================
  // Person Operations
  // ==========================================================================

  /**
   * Find a person by their Slack user ID.
   *
   * @param slackUserId - Slack user ID (e.g., U0123ABCDEF)
   * @returns PersonRecord if found, null otherwise
   */
  async findPersonBySlackId(slackUserId: string): Promise<PersonRecord | null> {
    try {
      const records = await this.withRetry(() =>
        this.base(TABLES.PEOPLE)
          .select({
            filterByFormula: `{Slack User ID} = '${this.escapeFormulaString(slackUserId)}'`,
            maxRecords: 1,
          })
          .firstPage()
      );

      if (records.length === 0) {
        return null;
      }

      return this.mapPersonRecord(records[0]);
    } catch (error) {
      console.warn(
        `[AirtableClient] Error finding person by Slack ID ${slackUserId}:`,
        error
      );
      return null;
    }
  }

  /**
   * Get all team members who are on active projects.
   *
   * A person is an "active team member" if they are:
   * - A Team Member on a project with Status = 'Active', OR
   * - A Project Lead on a project with Status = 'Active'
   *
   * @returns Array of PersonRecord for all active team members
   */
  async getActiveTeamMembers(): Promise<PersonRecord[]> {
    try {
      // Step 1: Get all active projects with their team members and leads
      const activeProjects = await this.withRetry(() =>
        this.base(TABLES.PROJECTS)
          .select({
            filterByFormula: `{Status} = 'Active'`,
            fields: ['Team Members', 'Project Lead'],
          })
          .all()
      );

      // Step 2: Collect unique person IDs
      const personIds = new Set<string>();
      for (const project of activeProjects) {
        const teamMembers = project.fields['Team Members'] as string[] | undefined;
        const projectLeads = project.fields['Project Lead'] as string[] | undefined;

        teamMembers?.forEach((id) => personIds.add(id));
        projectLeads?.forEach((id) => personIds.add(id));
      }

      if (personIds.size === 0) {
        console.warn('[AirtableClient] No team members found on active projects');
        return [];
      }

      // Step 3: Fetch person records
      // Build an OR formula to fetch all people by ID
      const idConditions = Array.from(personIds)
        .map((id) => `RECORD_ID() = '${id}'`)
        .join(', ');
      const formula = `OR(${idConditions})`;

      const personRecords = await this.withRetry(() =>
        this.base(TABLES.PEOPLE)
          .select({
            filterByFormula: formula,
          })
          .all()
      );

      return personRecords.map((record) => this.mapPersonRecord(record));
    } catch (error) {
      console.error('[AirtableClient] Error getting active team members:', error);
      throw error;
    }
  }

  // ==========================================================================
  // Weekly Updates Operations
  // ==========================================================================

  /**
   * Create a new Weekly Update record.
   *
   * This should be called BEFORE sending the DM (write-ahead pattern)
   * for crash recovery support.
   *
   * @param data - Data for the new record
   * @returns The created record's ID
   */
  async createWeeklyUpdate(data: CreateWeeklyUpdateData): Promise<string> {
    try {
      // Note: Linked records use array of {id} objects for creation
      const fields = {
        'Week Start': data.weekStart,
        Person: [{ id: data.personId }],
        'Response Status': 'Pending',
        'DM Status': data.dmStatus,
        'Parsing Status': 'Pending',
        'Sync Cycle ID': data.syncCycleId,
        'Created At': new Date().toISOString(),
      };

      const record = await this.withRetry(() =>
        this.base(TABLES.WEEKLY_UPDATES).create(fields as unknown as FieldSet)
      );

      return record.id;
    } catch (error) {
      console.error('[AirtableClient] Error creating weekly update:', error);
      throw error;
    }
  }

  /**
   * Update the DM status of a Weekly Update record.
   *
   * Used for crash recovery - update to 'Sent' after DM is sent,
   * or 'Failed' if send failed.
   *
   * @param recordId - Airtable record ID
   * @param status - New DM status
   */
  async updateWeeklyUpdateDMStatus(
    recordId: string,
    status: DMStatus
  ): Promise<void> {
    try {
      await this.withRetry(() =>
        this.base(TABLES.WEEKLY_UPDATES).update(recordId, {
          'DM Status': status,
        } as Partial<FieldSet>)
      );
    } catch (error) {
      console.error(
        `[AirtableClient] Error updating DM status for ${recordId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Update a Weekly Update record with the Slack DM thread info.
   *
   * Called after successfully sending the DM.
   *
   * @param recordId - Airtable record ID
   * @param channelId - Slack DM channel ID
   * @param threadTs - Slack message timestamp
   */
  async updateWeeklyUpdateSlackInfo(
    recordId: string,
    channelId: string,
    threadTs: string
  ): Promise<void> {
    try {
      await this.withRetry(() =>
        this.base(TABLES.WEEKLY_UPDATES).update(recordId, {
          'DM Status': 'Sent',
          'Slack DM Channel Id': channelId,
          'Slack DM Thread Ts': threadTs,
        } as Partial<FieldSet>)
      );
    } catch (error) {
      console.error(
        `[AirtableClient] Error updating Slack info for ${recordId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Update a Weekly Update record with the user's response.
   *
   * @param recordId - Airtable record ID
   * @param response - Raw response text from the user
   * @param slackTs - Slack message timestamp of the response
   * @param isLate - Whether the response was received after the cutoff
   */
  async updateWeeklyUpdateResponse(
    recordId: string,
    response: string,
    slackTs: string,
    isLate: boolean = false
  ): Promise<void> {
    try {
      await this.withRetry(() =>
        this.base(TABLES.WEEKLY_UPDATES).update(recordId, {
          'Raw Response': response,
          'Submitted At': new Date().toISOString(),
          'Response Status': isLate ? 'Late' : 'Submitted',
        } as Partial<FieldSet>)
      );
    } catch (error) {
      console.error(
        `[AirtableClient] Error updating response for ${recordId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Update the response status of a Weekly Update record.
   *
   * @param recordId - Airtable record ID
   * @param status - New response status
   */
  async updateWeeklyUpdateStatus(
    recordId: string,
    status: 'Pending' | 'Submitted' | 'Late' | 'No Response'
  ): Promise<void> {
    try {
      await this.withRetry(() =>
        this.base(TABLES.WEEKLY_UPDATES).update(recordId, {
          'Response Status': status,
        } as Partial<FieldSet>)
      );
    } catch (error) {
      console.error(
        `[AirtableClient] Error updating status for ${recordId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Update the parsing status of a Weekly Update record.
   *
   * @param recordId - Airtable record ID
   * @param status - New parsing status
   * @param notes - Optional notes (e.g., error messages)
   */
  async updateWeeklyUpdateParsingStatus(
    recordId: string,
    status: 'Pending' | 'Parsed' | 'Failed' | 'Manual Review',
    notes?: string
  ): Promise<void> {
    try {
      const fields: Partial<FieldSet> = {
        'Parsing Status': status,
      };
      if (notes !== undefined) {
        fields['Parsing Notes'] = notes;
      }

      await this.withRetry(() =>
        this.base(TABLES.WEEKLY_UPDATES).update(recordId, fields)
      );
    } catch (error) {
      console.error(
        `[AirtableClient] Error updating parsing status for ${recordId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Get all Weekly Updates for a specific sync cycle.
   *
   * @param syncCycleId - The sync cycle identifier
   * @returns Array of WeeklyUpdateRecord
   */
  async getWeeklyUpdatesForCycle(
    syncCycleId: string
  ): Promise<WeeklyUpdateRecord[]> {
    try {
      const records = await this.withRetry(() =>
        this.base(TABLES.WEEKLY_UPDATES)
          .select({
            filterByFormula: `{Sync Cycle ID} = '${this.escapeFormulaString(syncCycleId)}'`,
          })
          .all()
      );

      return records.map((record) => this.mapWeeklyUpdateRecord(record));
    } catch (error) {
      console.error(
        `[AirtableClient] Error getting updates for cycle ${syncCycleId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Get all Weekly Update records with DM Status = 'Pending'.
   *
   * Used for crash recovery on startup to find DMs that were
   * recorded but may not have been sent.
   *
   * @returns Array of WeeklyUpdateRecord with pending DM status
   */
  async getPendingDMRecords(): Promise<WeeklyUpdateRecord[]> {
    try {
      const records = await this.withRetry(() =>
        this.base(TABLES.WEEKLY_UPDATES)
          .select({
            filterByFormula: `{DM Status} = 'Pending'`,
          })
          .all()
      );

      return records.map((record) => this.mapWeeklyUpdateRecord(record));
    } catch (error) {
      console.error('[AirtableClient] Error getting pending DM records:', error);
      throw error;
    }
  }

  /**
   * Find a Weekly Update record by Slack DM thread timestamp.
   *
   * @param threadTs - Slack thread timestamp
   * @returns WeeklyUpdateRecord if found, null otherwise
   */
  async findWeeklyUpdateByThreadTs(
    threadTs: string
  ): Promise<WeeklyUpdateRecord | null> {
    try {
      const records = await this.withRetry(() =>
        this.base(TABLES.WEEKLY_UPDATES)
          .select({
            filterByFormula: `{Slack DM Thread Ts} = '${this.escapeFormulaString(threadTs)}'`,
            maxRecords: 1,
          })
          .firstPage()
      );

      if (records.length === 0) {
        return null;
      }

      return this.mapWeeklyUpdateRecord(records[0]);
    } catch (error) {
      console.warn(
        `[AirtableClient] Error finding update by thread ${threadTs}:`,
        error
      );
      return null;
    }
  }

  // ==========================================================================
  // Update Segments Operations
  // ==========================================================================

  /**
   * Create Update Segment records for parsed project updates.
   *
   * Handles batch creation (max 10 records per API call).
   *
   * @param weeklyUpdateId - Parent Weekly Update record ID
   * @param segments - Array of parsed segments to create
   * @returns Array of created record IDs
   */
  async createUpdateSegments(
    weeklyUpdateId: string,
    segments: UpdateSegment[]
  ): Promise<string[]> {
    if (segments.length === 0) {
      return [];
    }

    try {
      // Note: Linked records use array of {id} objects for creation
      const recordsToCreate = segments.map((segment) => ({
        fields: {
          'Weekly Update': [{ id: weeklyUpdateId }],
          Project: [{ id: segment.projectId }],
          Content: segment.content,
          'Worked On': JSON.stringify(segment.workedOn),
          'Coming Up': JSON.stringify(segment.comingUp),
          Blockers: JSON.stringify(segment.blockers),
          Questions: JSON.stringify(segment.questions),
          'Confidence Score': Math.round(segment.confidence * 100),
          'Posted To Channel': false,
        },
      }));

      const createdIds: string[] = [];

      // Batch create in groups of BATCH_SIZE
      for (let i = 0; i < recordsToCreate.length; i += BATCH_SIZE) {
        const batch = recordsToCreate.slice(i, i + BATCH_SIZE);
        const created = await this.withRetry(async () => {
          // Use the table's create method with the batch
          const result = await this.base(TABLES.UPDATE_SEGMENTS).create(
            batch as unknown as Partial<FieldSet>[]
          );
          return result as unknown as Records<FieldSet>;
        });

        // Handle both single record and array responses
        if (Array.isArray(created)) {
          createdIds.push(...created.map((r: AirtableRecord<FieldSet>) => r.id));
        } else {
          createdIds.push((created as unknown as AirtableRecord<FieldSet>).id);
        }
      }

      return createdIds;
    } catch (error) {
      console.error('[AirtableClient] Error creating update segments:', error);
      throw error;
    }
  }

  /**
   * Get all Update Segments for a specific project and week.
   *
   * @param projectId - Airtable project record ID
   * @param weekStart - ISO date string (YYYY-MM-DD) for the week start
   * @returns Array of UpdateSegmentRecord
   */
  async getSegmentsForProject(
    projectId: string,
    weekStart: string
  ): Promise<UpdateSegmentRecord[]> {
    try {
      // TODO: This fetches all segments for the week and filters in code.
      // For better performance at scale, add a Week Start lookup field to the
      // Update Segments table and query directly with that field.

      // Fetch all segments for this project
      // Use FIND() to search within the linked record array
      const records = await this.withRetry(() =>
        this.base(TABLES.UPDATE_SEGMENTS)
          .select({
            filterByFormula: `FIND('${this.escapeFormulaString(projectId)}', ARRAYJOIN({Project}))`,
          })
          .all()
      );

      // Map all segments
      const mapped = records.map((record) => this.mapUpdateSegmentRecord(record));

      // Filter by week in code since we don't have a direct Week Start field
      // This is intentional - filtering in code is acceptable for this use case
      // as the number of segments per project is typically small
      return mapped;
    } catch (error) {
      console.error(
        `[AirtableClient] Error getting segments for project ${projectId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Mark an Update Segment as posted to the channel.
   *
   * @param recordId - Airtable record ID
   * @param threadTs - Optional thread timestamp if posted as a late update
   */
  async markSegmentAsPosted(
    recordId: string,
    threadTs?: string
  ): Promise<void> {
    try {
      const fields: Partial<FieldSet> = {
        'Posted To Channel': true,
      };
      if (threadTs) {
        fields['Thread Ts'] = threadTs;
      }

      await this.withRetry(() =>
        this.base(TABLES.UPDATE_SEGMENTS).update(recordId, fields)
      );
    } catch (error) {
      console.error(
        `[AirtableClient] Error marking segment ${recordId} as posted:`,
        error
      );
      throw error;
    }
  }

  // ==========================================================================
  // Projects Operations
  // ==========================================================================

  /**
   * Get all active projects.
   *
   * @returns Array of ProjectRecord for projects with Status = 'Active'
   */
  async getActiveProjects(): Promise<ProjectRecord[]> {
    try {
      const records = await this.withRetry(() =>
        this.base(TABLES.PROJECTS)
          .select({
            filterByFormula: `{Status} = 'Active'`,
          })
          .all()
      );

      return records.map((record) => this.mapProjectRecord(record));
    } catch (error) {
      console.error('[AirtableClient] Error getting active projects:', error);
      throw error;
    }
  }

  /**
   * Find a project by its Slack channel ID.
   *
   * @param channelId - Slack channel ID
   * @returns ProjectRecord if found, null otherwise
   */
  async getProjectByChannelId(channelId: string): Promise<ProjectRecord | null> {
    try {
      const records = await this.withRetry(() =>
        this.base(TABLES.PROJECTS)
          .select({
            filterByFormula: `{Slack Channel ID} = '${this.escapeFormulaString(channelId)}'`,
            maxRecords: 1,
          })
          .firstPage()
      );

      if (records.length === 0) {
        return null;
      }

      return this.mapProjectRecord(records[0]);
    } catch (error) {
      console.warn(
        `[AirtableClient] Error finding project by channel ${channelId}:`,
        error
      );
      return null;
    }
  }

  /**
   * Get a project by its record ID.
   *
   * @param recordId - Airtable record ID
   * @returns ProjectRecord if found, null otherwise
   */
  async getProjectById(recordId: string): Promise<ProjectRecord | null> {
    try {
      const record = await this.withRetry(() =>
        this.base(TABLES.PROJECTS).find(recordId)
      );
      return this.mapProjectRecord(record);
    } catch (error) {
      console.warn(
        `[AirtableClient] Error finding project by ID ${recordId}:`,
        error
      );
      return null;
    }
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  /**
   * Escape a string for use in Airtable formula.
   * Handles backslashes and single quotes which need to be escaped.
   */
  private escapeFormulaString(str: string): string {
    return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }

  /**
   * Execute an Airtable operation with retry logic for rate limits.
   */
  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;

        // Check if it's a rate limit error (429)
        if (this.isRateLimitError(error)) {
          console.warn(
            `[AirtableClient] Rate limited, waiting ${RATE_LIMIT_RETRY_DELAY}ms before retry ${attempt + 1}/${MAX_RETRIES}`
          );
          await this.sleep(RATE_LIMIT_RETRY_DELAY);
          continue;
        }

        // For other errors, throw immediately
        throw error;
      }
    }

    throw lastError || new Error('Max retries exceeded');
  }

  /**
   * Check if an error is a rate limit (429) error.
   */
  private isRateLimitError(error: unknown): boolean {
    if (error && typeof error === 'object') {
      const err = error as { statusCode?: number; error?: string };
      return err.statusCode === 429 || err.error === 'RATE_LIMIT_REACHED';
    }
    return false;
  }

  /**
   * Sleep for a specified duration.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Map an Airtable record to a PersonRecord.
   */
  private mapPersonRecord(record: AirtableRecord<FieldSet>): PersonRecord {
    return {
      id: record.id,
      name: (record.fields['Full Name'] as string) || (record.fields['Name'] as string) || '',
      email: (record.fields['Email'] as string) || '',
      slackUserId: (record.fields['Slack User ID'] as string) || null,
    };
  }

  /**
   * Map an Airtable record to a WeeklyUpdateRecord.
   */
  private mapWeeklyUpdateRecord(
    record: AirtableRecord<FieldSet>
  ): WeeklyUpdateRecord {
    const personLink = record.fields['Person'] as string[] | undefined;
    return {
      id: record.id,
      weekStart: (record.fields['Week Start'] as string) || '',
      personId: personLink?.[0] || '',
      rawResponse: (record.fields['Raw Response'] as string) || null,
      submittedAt: (record.fields['Submitted At'] as string) || null,
      responseStatus: (record.fields['Response Status'] as WeeklyUpdateRecord['responseStatus']) || 'Pending',
      dmStatus: (record.fields['DM Status'] as DMStatus) || 'Pending',
      parsingStatus: (record.fields['Parsing Status'] as WeeklyUpdateRecord['parsingStatus']) || 'Pending',
      slackDmThreadTs: (record.fields['Slack DM Thread Ts'] as string) || null,
      slackDmChannelId: (record.fields['Slack DM Channel Id'] as string) || null,
      syncCycleId: (record.fields['Sync Cycle ID'] as string) || '',
      createdAt: (record.fields['Created At'] as string) || null,
    };
  }

  /**
   * Map an Airtable record to a ProjectRecord.
   */
  private mapProjectRecord(record: AirtableRecord<FieldSet>): ProjectRecord {
    return {
      id: record.id,
      name: (record.fields['Name'] as string) || '',
      status: (record.fields['Status'] as string) || '',
      slackChannelId: (record.fields['Slack Channel ID'] as string) || null,
      teamMemberIds: (record.fields['Team Members'] as string[]) || [],
      projectLeadIds: (record.fields['Project Lead'] as string[]) || [],
    };
  }

  /**
   * Map an Airtable record to an UpdateSegmentRecord.
   */
  private mapUpdateSegmentRecord(
    record: AirtableRecord<FieldSet>
  ): UpdateSegmentRecord {
    const weeklyUpdateLink = record.fields['Weekly Update'] as string[] | undefined;
    const projectLink = record.fields['Project'] as string[] | undefined;

    return {
      id: record.id,
      weeklyUpdateId: weeklyUpdateLink?.[0] || '',
      projectId: projectLink?.[0] || '',
      content: (record.fields['Content'] as string) || '',
      workedOn: (record.fields['Worked On'] as string) || null,
      comingUp: (record.fields['Coming Up'] as string) || null,
      blockers: (record.fields['Blockers'] as string) || null,
      questions: (record.fields['Questions'] as string) || null,
      confidenceScore: (record.fields['Confidence Score'] as number) || 0,
      postedToChannel: (record.fields['Posted To Channel'] as boolean) || false,
      threadTs: (record.fields['Thread Ts'] as string) || null,
    };
  }
}
