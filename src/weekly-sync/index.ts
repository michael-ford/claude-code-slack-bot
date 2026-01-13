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
} from './airtable-client';
