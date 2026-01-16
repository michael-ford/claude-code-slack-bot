/**
 * Weekly Sync Scheduler
 *
 * Orchestrates automated scheduling for the weekly sync system:
 * - Friday at noon: Trigger collection DMs
 * - Monday at 10am: Trigger pre-meeting summaries
 */

import cron, { ScheduledTask } from 'node-cron';

import type { Logger } from '../logger';
import type { CollectionManager } from './collection-manager';
import type { SummaryGenerator } from './summary-generator';

/**
 * Options for creating a WeeklySyncScheduler instance.
 */
export interface SchedulerOptions {
  collectionManager: CollectionManager;
  summaryGenerator: SummaryGenerator;
  timezone: string;
  logger: Logger;
  /** Hour for Friday collection (0-23, default 12 = noon) */
  collectionHour?: number;
  /** Hour for Monday summaries (0-23, default 10 = 10am) */
  summaryHour?: number;
}

// Day of week constants (JavaScript Date.getDay() values)
const MONDAY = 1;
const FRIDAY = 5;

// Default schedule time constants
const DEFAULT_COLLECTION_HOUR = 12; // Noon
const DEFAULT_SUMMARY_HOUR = 10;    // 10am

/**
 * Validate that a timezone string is valid.
 */
function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract error message from unknown error type.
 */
function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Get the next occurrence of a specific weekday at a specific hour in the given timezone.
 *
 * @param timezone - IANA timezone string
 * @param targetDay - Day of week (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
 * @param targetHour - Hour of day (0-23)
 */
function getNextWeekdayTime(
  timezone: string,
  targetDay: number,
  targetHour: number
): Date {
  const now = new Date();

  // Get current time in the configured timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const getPart = (type: string): string =>
    parts.find((p) => p.type === type)?.value || '0';

  const localYear = parseInt(getPart('year'), 10);
  const localMonth = parseInt(getPart('month'), 10) - 1;
  const localDay = parseInt(getPart('day'), 10);
  const localHour = parseInt(getPart('hour'), 10);

  // Create a date object representing "now" in the timezone at target hour
  const localDate = new Date(localYear, localMonth, localDay, targetHour, 0, 0, 0);
  const dayOfWeek = localDate.getDay();

  // Calculate days until target day
  let daysUntilTarget = (targetDay - dayOfWeek + 7) % 7;

  // Handle the case when today is already the target day
  if (dayOfWeek === targetDay) {
    // If it's already past target hour, go to next week
    if (localHour >= targetHour) {
      daysUntilTarget = 7;
    } else {
      // Before target hour, stay on same day
      daysUntilTarget = 0;
    }
  }

  localDate.setDate(localDate.getDate() + daysUntilTarget);

  return localDate;
}

/**
 * Generate a unique sync cycle ID based on week start.
 * Uses timestamp-based uniqueness to avoid collisions on process restart.
 * Includes a random component for additional uniqueness within the same millisecond.
 */
function generateSyncCycleId(weekStart: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.floor(Math.random() * 1296).toString(36).padStart(2, '0'); // 36^2 = 1296, gives 2 chars
  return `sync-${weekStart}-${timestamp}${random}`;
}

/**
 * WeeklySyncScheduler manages the automated scheduling for weekly sync.
 */
export class WeeklySyncScheduler {
  private collectionManager: CollectionManager;
  private summaryGenerator: SummaryGenerator;
  private timezone: string;
  private logger: Logger;
  private collectionHour: number;
  private summaryHour: number;

  public collectionJob: ScheduledTask | null = null;
  public summaryJob: ScheduledTask | null = null;

  constructor(options: SchedulerOptions) {
    // Validate required dependencies
    if (!options.collectionManager) {
      throw new Error('collectionManager is required');
    }
    if (!options.summaryGenerator) {
      throw new Error('summaryGenerator is required');
    }
    if (!options.logger) {
      throw new Error('logger is required');
    }

    // Validate timezone
    if (!isValidTimezone(options.timezone)) {
      throw new Error(`Invalid timezone: ${options.timezone}`);
    }

    this.collectionManager = options.collectionManager;
    this.summaryGenerator = options.summaryGenerator;
    this.timezone = options.timezone;
    this.logger = options.logger;
    this.collectionHour = options.collectionHour ?? DEFAULT_COLLECTION_HOUR;
    this.summaryHour = options.summaryHour ?? DEFAULT_SUMMARY_HOUR;
  }

  /**
   * Get the Monday of the week for a given date.
   * Returns ISO format string YYYY-MM-DD.
   * Week starts on Monday (ISO week standard).
   */
  getWeekStart(date: Date): string {
    // Clone the date to avoid mutation - use local time, not UTC
    const d = new Date(date.getTime());

    // Get the day of week (0 = Sunday, 1 = Monday, ... 6 = Saturday)
    const dayOfWeek = d.getDay();

    // Calculate days to subtract to get to Monday
    // Sunday (0) -> 6 days back
    // Monday (1) -> 0 days back
    // Tuesday (2) -> 1 day back
    // etc.
    const daysToSubtract = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

    // Subtract days to get Monday
    d.setDate(d.getDate() - daysToSubtract);

    // Format as YYYY-MM-DD using local date components
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const dayOfMonth = String(d.getDate()).padStart(2, '0');

    return `${year}-${month}-${dayOfMonth}`;
  }

  /**
   * Generate a unique sync cycle ID for a given week start.
   */
  getSyncCycleId(weekStart: string): string {
    return generateSyncCycleId(weekStart);
  }

  /**
   * Trigger the collection process (called by cron or manually).
   */
  async triggerCollection(): Promise<void> {
    const weekStart = this.getWeekStart(new Date());
    const syncCycleId = this.getSyncCycleId(weekStart);

    try {
      const result = await this.collectionManager.startCollection(weekStart, syncCycleId);
      this.logger.log(
        `Collection complete: ${result.sent} sent, ${result.failed} failed`
      );
    } catch (error) {
      this.logger.error('Collection failed', getErrorMessage(error));
    }
  }

  /**
   * Trigger the summary generation process (called by cron or manually).
   * Uses the previous week's Monday for the summaries.
   */
  async triggerSummaries(): Promise<void> {
    // For Monday summary generation, we want the previous week's Monday
    // Step 1: Get current week's Monday
    const currentWeekStart = this.getWeekStart(new Date());

    // Step 2: Parse it and subtract 7 days to get previous week's Monday
    const [year, month, day] = currentWeekStart.split('-').map(Number);
    const previousWeekMonday = new Date(year, month - 1, day);
    previousWeekMonday.setDate(previousWeekMonday.getDate() - 7);

    // Step 3: Use that as the weekStart
    const weekStart = this.getWeekStart(previousWeekMonday);
    const syncCycleId = this.getSyncCycleId(weekStart);

    try {
      const result = await this.summaryGenerator.generatePreMeetingSummaries(
        weekStart,
        syncCycleId
      );
      this.logger.log(
        `Summary generation complete: ${result.posted} posted, ${result.skipped} skipped, ${result.failed} failed`
      );
    } catch (error) {
      this.logger.error('Summary generation failed', getErrorMessage(error));
    }
  }

  /**
   * Get the next Friday collection time in the configured timezone.
   */
  getNextCollectionTime(): Date {
    return getNextWeekdayTime(this.timezone, FRIDAY, this.collectionHour);
  }

  /**
   * Get the next Monday summary time in the configured timezone.
   */
  getNextSummaryTime(): Date {
    return getNextWeekdayTime(this.timezone, MONDAY, this.summaryHour);
  }

  /**
   * Start the scheduler - sets up cron jobs for Friday and Monday.
   */
  start(): void {
    // Prevent double-start
    if (this.collectionJob || this.summaryJob) {
      this.logger.log('Weekly sync scheduler already running');
      return;
    }

    // Friday collection - cron: "0 <hour> * * 5" (5 = Friday)
    const collectionCron = `0 ${this.collectionHour} * * 5`;
    this.collectionJob = cron.schedule(
      collectionCron,
      async () => {
        try {
          await this.triggerCollection();
        } catch (error) {
          this.logger.error(
            'Critical error in scheduled collection:',
            error instanceof Error ? error.message : String(error)
          );
        }
      },
      { timezone: this.timezone }
    );

    // Monday summaries - cron: "0 <hour> * * 1" (1 = Monday)
    const summaryCron = `0 ${this.summaryHour} * * 1`;
    this.summaryJob = cron.schedule(
      summaryCron,
      async () => {
        try {
          await this.triggerSummaries();
        } catch (error) {
          this.logger.error(
            'Critical error in scheduled summary generation:',
            error instanceof Error ? error.message : String(error)
          );
        }
      },
      { timezone: this.timezone }
    );

    this.logger.log(
      `Weekly sync scheduler started (timezone: ${this.timezone}, collection: Friday ${this.collectionHour}:00, summaries: Monday ${this.summaryHour}:00)`
    );
  }

  /**
   * Stop the scheduler - cancels all cron jobs.
   */
  stop(): void {
    let stoppedAny = false;

    if (this.collectionJob) {
      this.collectionJob.stop();
      this.collectionJob = null;
      stoppedAny = true;
    }

    if (this.summaryJob) {
      this.summaryJob.stop();
      this.summaryJob = null;
      stoppedAny = true;
    }

    if (stoppedAny) {
      this.logger.log('Weekly sync scheduler stopped');
    }
  }
}
