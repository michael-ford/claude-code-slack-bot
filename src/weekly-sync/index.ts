/**
 * Weekly Sync System
 *
 * Automated weekly check-in system that collects and distributes
 * project updates across the team.
 */

// Type exports
export type {
  SyncCycleStatus,
  DMStatus,
  SyncCycle,
  SentDM,
  CollectedResponse,
  UpdateSegment,
  ParseResult,
  SyncStatusInfo,
  WeeklySyncConfig,
} from './types';

// Airtable client exports
export {
  WeeklySyncAirtableClient,
  type PersonRecord,
  type WeeklyUpdateRecord,
  type ProjectRecord,
  type UpdateSegmentRecord,
  type CreateWeeklyUpdateData,
  type TrackedThreadRecord,
  type CreateTrackedThreadData,
  type ThreadType,
} from './airtable-client';

// Thread tracker exports
export {
  ThreadTracker,
  type TrackedThread,
  type ThreadType as TrackerThreadType,
} from './thread-tracker';

// Collection manager exports
export {
  CollectionManager,
  type CollectionManagerOptions,
  type StartCollectionResult,
  type SendDMResult,
  type CollectionContext,
} from './collection-manager';

// Admin commands exports
export {
  WeeklySyncCommands,
  type WeeklySyncAction,
} from './admin-commands';

// Summary generator exports
export {
  SummaryGenerator,
  type SummaryGeneratorConfig,
  type ProjectSummaryResult,
  type PreMeetingSummariesResult,
} from './summary-generator';

// Scheduler exports
export {
  WeeklySyncScheduler,
  type SchedulerOptions,
} from './scheduler';
