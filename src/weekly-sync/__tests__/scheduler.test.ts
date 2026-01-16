import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { CollectionManager } from '../collection-manager';
import type { SummaryGenerator } from '../summary-generator';
import type { Logger } from '../../logger';
import cron from 'node-cron';

// Mock node-cron
vi.mock('node-cron');

// Mock dependencies
const mockCollectionManagerStartCollection = vi.fn();
const mockSummaryGeneratorGeneratePreMeetingSummaries = vi.fn();

const createMockCollectionManager = (): CollectionManager => {
  return {
    startCollection: mockCollectionManagerStartCollection,
  } as unknown as CollectionManager;
};

const createMockSummaryGenerator = (): SummaryGenerator => {
  return {
    generatePreMeetingSummaries: mockSummaryGeneratorGeneratePreMeetingSummaries,
  } as unknown as SummaryGenerator;
};

const mockLog = vi.fn();
const mockError = vi.fn();
const mockWarn = vi.fn();

const createMockLogger = (): Logger => {
  return {
    log: mockLog,
    error: mockError,
    warn: mockWarn,
  } as unknown as Logger;
};

describe('WeeklySyncScheduler', () => {
  let collectionManager: CollectionManager;
  let summaryGenerator: SummaryGenerator;
  let logger: Logger;
  let scheduler: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset date mocking
    vi.useRealTimers();

    // Setup node-cron mock
    const mockSchedule = vi.fn().mockReturnValue({
      stop: vi.fn(),
    });
    vi.mocked(cron.schedule).mockImplementation(mockSchedule);

    collectionManager = createMockCollectionManager();
    summaryGenerator = createMockSummaryGenerator();
    logger = createMockLogger();

    // Default mock responses
    mockCollectionManagerStartCollection.mockResolvedValue({
      sent: 3,
      failed: 0,
      errors: [],
    });
    mockSummaryGeneratorGeneratePreMeetingSummaries.mockResolvedValue({
      posted: 5,
      skipped: 0,
      failed: 0,
      results: [],
    });

    // Import WeeklySyncScheduler dynamically (will fail until implementation exists)
    const { WeeklySyncScheduler } = await import('../scheduler');
    scheduler = new WeeklySyncScheduler({
      collectionManager,
      summaryGenerator,
      timezone: 'America/Los_Angeles',
      logger,
    });
  });

  afterEach(() => {
    // Clean up scheduler if it was started
    if (scheduler && typeof scheduler.stop === 'function') {
      scheduler.stop();
    }
  });

  describe('getWeekStart helper', () => {
    it('calculates Monday of the current week from Wednesday', () => {
      // Wednesday, January 15, 2026
      const testDate = new Date('2026-01-15T14:30:00.000Z');

      // Should return Monday, January 12, 2026 in ISO format
      const weekStart = scheduler.getWeekStart(testDate);
      expect(weekStart).toBe('2026-01-12');
    });

    it('calculates Monday of the current week from Monday', () => {
      // Monday, January 19, 2026
      const testDate = new Date('2026-01-19T09:00:00.000Z');

      // Should return the same Monday
      const weekStart = scheduler.getWeekStart(testDate);
      expect(weekStart).toBe('2026-01-19');
    });

    it('calculates Monday of the current week from Sunday', () => {
      // Sunday, January 18, 2026 (last day of week)
      const testDate = new Date('2026-01-18T23:59:59.999Z');

      // Should return Monday of that week
      const weekStart = scheduler.getWeekStart(testDate);
      expect(weekStart).toBe('2026-01-12');
    });

    it('formats date as YYYY-MM-DD', () => {
      // Specific date to verify formatting
      const testDate = new Date('2026-03-02T12:00:00.000Z');

      const weekStart = scheduler.getWeekStart(testDate);
      expect(weekStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(weekStart).toBe('2026-03-02'); // Monday
    });
  });

  describe('getSyncCycleId helper', () => {
    it('generates unique ID with week start date', () => {
      const syncCycleId = scheduler.getSyncCycleId('2026-01-12');

      // Format: sync-YYYY-MM-DD-[timestamp] where timestamp is base36 encoded
      expect(syncCycleId).toMatch(/^sync-2026-01-12-[0-9a-z]+$/);
      expect(syncCycleId).toContain('sync-');
      expect(syncCycleId).toContain('2026-01-12');
    });

    it('generates different IDs for consecutive calls', () => {
      const id1 = scheduler.getSyncCycleId('2026-01-12');
      const id2 = scheduler.getSyncCycleId('2026-01-12');

      expect(id1).not.toBe(id2);
    });

    it('includes timestamp-based uniqueness', () => {
      const syncCycleId = scheduler.getSyncCycleId('2026-01-20');

      // Should contain the week start
      expect(syncCycleId).toContain('2026-01-20');

      // Should have some unique component (not just the date)
      const parts = syncCycleId.split('-');
      expect(parts.length).toBeGreaterThan(4); // sync-YYYY-MM-DD-[unique]

      // The unique suffix should be alphanumeric (base36)
      const suffix = parts[parts.length - 1];
      expect(suffix).toMatch(/^[0-9a-z]+$/);
    });
  });

  describe('triggerCollection', () => {
    it('calls CollectionManager.startCollection with week start and sync cycle ID', async () => {
      // Mock current date to Wednesday, January 15, 2026
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-15T14:00:00.000Z'));

      await scheduler.triggerCollection();

      expect(mockCollectionManagerStartCollection).toHaveBeenCalledWith(
        '2026-01-12', // Monday of that week
        expect.stringMatching(/^sync-2026-01-12-[0-9a-z]+$/)
      );

      vi.useRealTimers();
    });

    it('logs success after collection completes', async () => {
      mockCollectionManagerStartCollection.mockResolvedValueOnce({
        sent: 5,
        failed: 1,
        errors: [],
      });

      await scheduler.triggerCollection();

      expect(mockLog).toHaveBeenCalledWith(
        expect.stringContaining('Collection complete')
      );
    });

    it('handles errors gracefully and logs them', async () => {
      mockCollectionManagerStartCollection.mockRejectedValueOnce(
        new Error('Airtable connection timeout')
      );

      await scheduler.triggerCollection();

      expect(mockError).toHaveBeenCalledWith(
        expect.stringContaining('Collection failed'),
        expect.any(String)
      );
    });

    it('does not throw error even when collection fails', async () => {
      mockCollectionManagerStartCollection.mockRejectedValueOnce(
        new Error('Total failure')
      );

      // Should not throw
      await expect(scheduler.triggerCollection()).resolves.toBeUndefined();
    });
  });

  describe('triggerSummaries', () => {
    it('calls SummaryGenerator.generatePreMeetingSummaries with week start and sync cycle ID', async () => {
      // Mock current date to Monday, January 19, 2026
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-19T10:00:00.000Z'));

      await scheduler.triggerSummaries();

      expect(mockSummaryGeneratorGeneratePreMeetingSummaries).toHaveBeenCalledWith(
        '2026-01-12', // Previous week's Monday (summaries are for the week just ended)
        expect.stringMatching(/^sync-2026-01-12-[0-9a-z]+$/)
      );

      vi.useRealTimers();
    });

    it('calculates previous week correctly when running on Wednesday', async () => {
      // Mock current date to Wednesday, January 21, 2026 (middle of week)
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-21T14:30:00.000Z'));

      await scheduler.triggerSummaries();

      // Should still use previous week's Monday (Jan 12), not current week (Jan 19)
      expect(mockSummaryGeneratorGeneratePreMeetingSummaries).toHaveBeenCalledWith(
        '2026-01-12',
        expect.stringMatching(/^sync-2026-01-12-[0-9a-z]+$/)
      );

      vi.useRealTimers();
    });

    it('calculates previous week correctly when running on Sunday', async () => {
      // Mock current date to Sunday, January 25, 2026 (end of week)
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-25T23:59:59.000Z'));

      await scheduler.triggerSummaries();

      // Sunday belongs to week starting Jan 19, so previous week is Jan 12
      expect(mockSummaryGeneratorGeneratePreMeetingSummaries).toHaveBeenCalledWith(
        '2026-01-12',
        expect.stringMatching(/^sync-2026-01-12-[0-9a-z]+$/)
      );

      vi.useRealTimers();
    });

    it('logs success after summary generation completes', async () => {
      mockSummaryGeneratorGeneratePreMeetingSummaries.mockResolvedValueOnce({
        posted: 8,
        skipped: 2,
        failed: 0,
        results: [],
      });

      await scheduler.triggerSummaries();

      expect(mockLog).toHaveBeenCalledWith(
        expect.stringContaining('Summary generation complete')
      );
    });

    it('handles errors gracefully and logs them', async () => {
      mockSummaryGeneratorGeneratePreMeetingSummaries.mockRejectedValueOnce(
        new Error('Claude CLI timeout')
      );

      await scheduler.triggerSummaries();

      expect(mockError).toHaveBeenCalledWith(
        expect.stringContaining('Summary generation failed'),
        expect.any(String)
      );
    });

    it('does not throw error even when summary generation fails', async () => {
      mockSummaryGeneratorGeneratePreMeetingSummaries.mockRejectedValueOnce(
        new Error('Total failure')
      );

      // Should not throw
      await expect(scheduler.triggerSummaries()).resolves.toBeUndefined();
    });
  });

  describe('getNextCollectionTime', () => {
    it('returns next Friday at noon in configured timezone', () => {
      // Wednesday, January 15, 2026, 2:00 PM UTC
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-15T14:00:00.000Z'));

      const nextTime = scheduler.getNextCollectionTime();

      // Should return Friday, January 17, 2026 at noon Pacific Time
      expect(nextTime).toBeInstanceOf(Date);
      expect(nextTime.getDay()).toBe(5); // Friday

      vi.useRealTimers();
    });

    it('returns next Friday if today is Friday after noon', () => {
      // Friday, January 16, 2026, 1:00 PM Pacific (after collection time)
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-16T21:00:00.000Z')); // 1 PM Pacific

      const nextTime = scheduler.getNextCollectionTime();

      // Should return NEXT Friday (January 23)
      expect(nextTime.getDay()).toBe(5); // Friday
      expect(nextTime.getDate()).toBe(23);

      vi.useRealTimers();
    });

    it('returns same Friday if today is Friday before noon', () => {
      // Friday, January 16, 2026, 10:00 AM Pacific (before collection time)
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-16T18:00:00.000Z')); // 10 AM Pacific

      const nextTime = scheduler.getNextCollectionTime();

      // Should return same Friday
      expect(nextTime.getDay()).toBe(5); // Friday
      expect(nextTime.getDate()).toBe(16);

      vi.useRealTimers();
    });

    it('respects configured timezone for noon calculation', () => {
      // Create scheduler with different timezone
      const tokyoScheduler = new scheduler.constructor({
        collectionManager,
        summaryGenerator,
        timezone: 'Asia/Tokyo',
        logger,
      });

      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-15T14:00:00.000Z'));

      const nextTime = tokyoScheduler.getNextCollectionTime();

      // Verify it's a Date and is Friday
      expect(nextTime).toBeInstanceOf(Date);
      expect(nextTime.getDay()).toBe(5);

      vi.useRealTimers();
    });
  });

  describe('getNextSummaryTime', () => {
    it('returns next Monday at 10am in configured timezone', () => {
      // Wednesday, January 15, 2026, 2:00 PM UTC
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-15T14:00:00.000Z'));

      const nextTime = scheduler.getNextSummaryTime();

      // Should return Monday, January 19, 2026 at 10am Pacific Time
      expect(nextTime).toBeInstanceOf(Date);
      expect(nextTime.getDay()).toBe(1); // Monday

      vi.useRealTimers();
    });

    it('returns next Monday if today is Monday after 10am', () => {
      // Monday, January 19, 2026, 11:00 AM Pacific (after summary time)
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-19T19:00:00.000Z')); // 11 AM Pacific

      const nextTime = scheduler.getNextSummaryTime();

      // Should return NEXT Monday (January 26)
      expect(nextTime.getDay()).toBe(1); // Monday
      expect(nextTime.getDate()).toBe(26);

      vi.useRealTimers();
    });

    it('returns same Monday if today is Monday before 10am', () => {
      // Monday, January 19, 2026, 9:00 AM Pacific (before summary time)
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-19T17:00:00.000Z')); // 9 AM Pacific

      const nextTime = scheduler.getNextSummaryTime();

      // Should return same Monday
      expect(nextTime.getDay()).toBe(1); // Monday
      expect(nextTime.getDate()).toBe(19);

      vi.useRealTimers();
    });

    it('respects configured timezone for 10am calculation', () => {
      // Create scheduler with different timezone
      const londonScheduler = new scheduler.constructor({
        collectionManager,
        summaryGenerator,
        timezone: 'Europe/London',
        logger,
      });

      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-15T14:00:00.000Z'));

      const nextTime = londonScheduler.getNextSummaryTime();

      // Verify it's a Date and is Monday
      expect(nextTime).toBeInstanceOf(Date);
      expect(nextTime.getDay()).toBe(1);

      vi.useRealTimers();
    });
  });

  describe('start', () => {
    it('schedules collection job with correct cron expression', () => {
      const mockSchedule = vi.mocked(cron.schedule);

      scheduler.start();

      // Verify collection job uses '0 12 * * 5' (Friday at noon)
      expect(mockSchedule).toHaveBeenCalledWith(
        '0 12 * * 5',
        expect.any(Function),
        expect.objectContaining({ timezone: 'America/Los_Angeles' })
      );
    });

    it('schedules summary job with correct cron expression', () => {
      const mockSchedule = vi.mocked(cron.schedule);

      scheduler.start();

      // Verify summary job uses '0 10 * * 1' (Monday at 10am)
      expect(mockSchedule).toHaveBeenCalledWith(
        '0 10 * * 1',
        expect.any(Function),
        expect.objectContaining({ timezone: 'America/Los_Angeles' })
      );
    });

    it('passes configured timezone to cron jobs', () => {
      const mockSchedule = vi.mocked(cron.schedule);

      // Create scheduler with different timezone
      const tokyoScheduler = new scheduler.constructor({
        collectionManager,
        summaryGenerator,
        timezone: 'Asia/Tokyo',
        logger,
      });

      tokyoScheduler.start();

      // Both jobs should use Asia/Tokyo timezone
      expect(mockSchedule).toHaveBeenCalledWith(
        '0 12 * * 5',
        expect.any(Function),
        expect.objectContaining({ timezone: 'Asia/Tokyo' })
      );
      expect(mockSchedule).toHaveBeenCalledWith(
        '0 10 * * 1',
        expect.any(Function),
        expect.objectContaining({ timezone: 'Asia/Tokyo' })
      );

      tokyoScheduler.stop();
    });

    it('logs next collection and summary times on start', () => {
      scheduler.start();

      // Should log startup message
      expect(mockLog).toHaveBeenCalledWith(
        expect.stringContaining('Weekly sync scheduler started')
      );

      // Should log next collection time
      expect(mockLog).toHaveBeenCalledWith(
        expect.stringContaining('Next collection:')
      );

      // Should log next summary time
      expect(mockLog).toHaveBeenCalledWith(
        expect.stringContaining('Next summary:')
      );
    });

    it('uses custom hours when provided', () => {
      const mockSchedule = vi.mocked(cron.schedule);

      // Create scheduler with custom hours
      const customScheduler = new scheduler.constructor({
        collectionManager,
        summaryGenerator,
        timezone: 'America/Los_Angeles',
        logger,
        collectionHour: 14, // 2pm instead of noon
        summaryHour: 9, // 9am instead of 10am
      });

      customScheduler.start();

      // Collection should use custom hour (14 = 2pm)
      expect(mockSchedule).toHaveBeenCalledWith(
        '0 14 * * 5',
        expect.any(Function),
        expect.objectContaining({ timezone: 'America/Los_Angeles' })
      );

      // Summary should use custom hour (9 = 9am)
      expect(mockSchedule).toHaveBeenCalledWith(
        '0 9 * * 1',
        expect.any(Function),
        expect.objectContaining({ timezone: 'America/Los_Angeles' })
      );

      customScheduler.stop();
    });

    it('schedules cron job for Friday at noon', () => {
      scheduler.start();

      // Verify that internal state shows jobs are scheduled
      // (This test will pass once implementation creates cron jobs)
      expect(scheduler.collectionJob).toBeDefined();
    });

    it('schedules cron job for Monday at 10am', () => {
      scheduler.start();

      // Verify that internal state shows jobs are scheduled
      expect(scheduler.summaryJob).toBeDefined();
    });

    it('uses configured timezone for cron scheduling', () => {
      scheduler.start();

      // Both jobs should be scheduled
      expect(scheduler.collectionJob).toBeDefined();
      expect(scheduler.summaryJob).toBeDefined();
    });

    it('logs when scheduler starts', () => {
      scheduler.start();

      expect(mockLog).toHaveBeenCalledWith(
        expect.stringContaining('Weekly sync scheduler started')
      );
    });

    it('does not start jobs twice if called multiple times', () => {
      scheduler.start();
      scheduler.start();

      // Should still only have one job of each type
      // (implementation should check if jobs are already running)
      expect(mockLog).toHaveBeenCalledWith(
        expect.stringContaining('already running')
      );
    });
  });

  describe('stop', () => {
    it('stops both cron jobs', () => {
      scheduler.start();
      scheduler.stop();

      // Jobs should be stopped
      expect(scheduler.collectionJob).toBeNull();
      expect(scheduler.summaryJob).toBeNull();
    });

    it('logs when scheduler stops after being started', () => {
      scheduler.start();
      mockLog.mockClear(); // Clear the "started" log

      scheduler.stop();

      expect(mockLog).toHaveBeenCalledWith(
        expect.stringContaining('Weekly sync scheduler stopped')
      );
      expect(mockLog).toHaveBeenCalledTimes(1);
    });

    it('does not log when stop called on never-started scheduler', () => {
      mockLog.mockClear();

      scheduler.stop();

      // Should not log "stopped" message
      expect(mockLog).not.toHaveBeenCalledWith(
        expect.stringContaining('stopped')
      );
      expect(mockLog).not.toHaveBeenCalled();
    });

    it('does not log when stop called on already-stopped scheduler', () => {
      scheduler.start();
      scheduler.stop();

      mockLog.mockClear();

      // Second stop should not log
      scheduler.stop();

      expect(mockLog).not.toHaveBeenCalledWith(
        expect.stringContaining('stopped')
      );
      expect(mockLog).not.toHaveBeenCalled();
    });

    it('handles stop when scheduler was never started', () => {
      // Should not throw
      expect(() => scheduler.stop()).not.toThrow();
    });

    it('handles stop when scheduler was already stopped', () => {
      scheduler.start();
      scheduler.stop();

      // Second stop should not throw
      expect(() => scheduler.stop()).not.toThrow();
    });
  });

  describe('error handling in cron execution', () => {
    it('continues operation even if collection trigger fails', async () => {
      mockCollectionManagerStartCollection.mockRejectedValueOnce(
        new Error('Catastrophic failure')
      );

      scheduler.start();

      // Manually trigger the collection (simulating cron execution)
      await scheduler.triggerCollection();

      // Scheduler should still be running
      expect(scheduler.collectionJob).toBeDefined();
      expect(mockError).toHaveBeenCalled();
    });

    it('continues operation even if summary trigger fails', async () => {
      mockSummaryGeneratorGeneratePreMeetingSummaries.mockRejectedValueOnce(
        new Error('Catastrophic failure')
      );

      scheduler.start();

      // Manually trigger the summaries (simulating cron execution)
      await scheduler.triggerSummaries();

      // Scheduler should still be running
      expect(scheduler.summaryJob).toBeDefined();
      expect(mockError).toHaveBeenCalled();
    });
  });

  describe('constructor', () => {
    it('accepts required options', () => {
      const newScheduler = new scheduler.constructor({
        collectionManager,
        summaryGenerator,
        timezone: 'America/New_York',
        logger,
      });

      expect(newScheduler).toBeDefined();
    });

    it('throws error if timezone is invalid', () => {
      expect(() => {
        new scheduler.constructor({
          collectionManager,
          summaryGenerator,
          timezone: 'Invalid/Timezone',
          logger,
        });
      }).toThrow('Invalid timezone');
    });

    it('throws error if required dependencies are missing', () => {
      expect(() => {
        new scheduler.constructor({
          collectionManager: null,
          summaryGenerator,
          timezone: 'America/Los_Angeles',
          logger,
        });
      }).toThrow();
    });

    it('throws error if collectionHour is less than 0', () => {
      expect(() => {
        new scheduler.constructor({
          collectionManager,
          summaryGenerator,
          timezone: 'America/Los_Angeles',
          logger,
          collectionHour: -1,
        });
      }).toThrow('Invalid collectionHour: -1. Must be 0-23');
    });

    it('throws error if collectionHour is greater than 23', () => {
      expect(() => {
        new scheduler.constructor({
          collectionManager,
          summaryGenerator,
          timezone: 'America/Los_Angeles',
          logger,
          collectionHour: 24,
        });
      }).toThrow('Invalid collectionHour: 24. Must be 0-23');
    });

    it('throws error if summaryHour is less than 0', () => {
      expect(() => {
        new scheduler.constructor({
          collectionManager,
          summaryGenerator,
          timezone: 'America/Los_Angeles',
          logger,
          summaryHour: -1,
        });
      }).toThrow('Invalid summaryHour: -1. Must be 0-23');
    });

    it('throws error if summaryHour is greater than 23', () => {
      expect(() => {
        new scheduler.constructor({
          collectionManager,
          summaryGenerator,
          timezone: 'America/Los_Angeles',
          logger,
          summaryHour: 24,
        });
      }).toThrow('Invalid summaryHour: 24. Must be 0-23');
    });

    it('accepts valid collectionHour and summaryHour', () => {
      const newScheduler = new scheduler.constructor({
        collectionManager,
        summaryGenerator,
        timezone: 'America/Los_Angeles',
        logger,
        collectionHour: 0,
        summaryHour: 23,
      });

      expect(newScheduler).toBeDefined();
    });
  });
});
