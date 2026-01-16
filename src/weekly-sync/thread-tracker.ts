/**
 * Thread Tracker
 *
 * Tracks Slack threads for the weekly sync system to enable
 * context injection when users reply to bot-posted messages.
 */

import type { WeeklySyncAirtableClient, TrackedThreadRecord, ThreadType } from './airtable-client';

// Re-export ThreadType so consumers can import from this module
export type { ThreadType };

/**
 * Data for a tracked thread (excluding threadTs which is passed separately).
 */
export interface TrackedThread {
  channelId: string;
  threadType: ThreadType;
  syncCycleId: string;
  projectId?: string;
  personId?: string;
  weekStart: string;
  contextJson?: string;
}

/**
 * Generates a cache key from channelId and threadTs.
 */
function getCacheKey(channelId: string, threadTs: string): string {
  return `${channelId}:${threadTs}`;
}

/**
 * ThreadTracker provides in-memory caching with Airtable persistence
 * for tracking Slack threads in the weekly sync system.
 */
export class ThreadTracker {
  private cache: Map<string, TrackedThreadRecord> = new Map();
  private airtableClient: WeeklySyncAirtableClient;

  constructor(airtableClient: WeeklySyncAirtableClient) {
    this.airtableClient = airtableClient;
  }

  /**
   * Register a new thread for tracking.
   * Stores in both memory cache and Airtable.
   *
   * @param thread - Thread data (without threadTs)
   * @param threadTs - Slack thread timestamp
   */
  async registerThread(
    thread: TrackedThread,
    threadTs: string
  ): Promise<void> {
    // Validate required fields
    if (!thread.channelId || !threadTs) {
      throw new Error('channelId and threadTs are required');
    }

    if (!['collection', 'pre-meeting', 'post-meeting'].includes(thread.threadType)) {
      throw new Error(`Invalid threadType: ${thread.threadType}`);
    }

    // Validate threadType-specific requirements
    if (thread.threadType === 'collection' && !thread.personId) {
      throw new Error('personId is required for collection threads');
    }

    if ((thread.threadType === 'pre-meeting' || thread.threadType === 'post-meeting') && !thread.projectId) {
      throw new Error('projectId is required for pre-meeting and post-meeting threads');
    }

    console.log(`[ThreadTracker] Registering ${thread.threadType} thread: ${thread.channelId}/${threadTs}`);

    // Create in Airtable
    const recordId = await this.airtableClient.createTrackedThread({
      threadTs,
      channelId: thread.channelId,
      threadType: thread.threadType,
      syncCycleId: thread.syncCycleId,
      projectId: thread.projectId ?? null,
      personId: thread.personId ?? null,
      weekStart: thread.weekStart,
      contextJson: thread.contextJson ?? null,
    });

    // Store in cache
    const record: TrackedThreadRecord = {
      id: recordId,
      threadTs,
      channelId: thread.channelId,
      threadType: thread.threadType,
      syncCycleId: thread.syncCycleId,
      projectId: thread.projectId ?? null,
      personId: thread.personId ?? null,
      weekStart: thread.weekStart,
      contextJson: thread.contextJson ?? null,
    };

    const cacheKey = getCacheKey(thread.channelId, threadTs);
    this.cache.set(cacheKey, record);
    console.log(`[ThreadTracker] Registered thread ${recordId} in cache`);
  }

  /**
   * Get the context for a tracked thread.
   * Checks cache first, then falls back to Airtable.
   *
   * @param channelId - Slack channel ID
   * @param threadTs - Slack thread timestamp
   * @returns TrackedThreadRecord if found, null otherwise
   */
  async getThreadContext(
    channelId: string,
    threadTs: string
  ): Promise<TrackedThreadRecord | null> {
    const cacheKey = getCacheKey(channelId, threadTs);

    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached) {
      console.log(`[ThreadTracker] Cache hit: ${channelId}/${threadTs}`);
      return cached;
    }

    // Fallback to Airtable
    console.log(`[ThreadTracker] Cache miss: ${channelId}/${threadTs}, querying Airtable`);
    const record = await this.airtableClient.findTrackedThread(channelId, threadTs);
    if (record) {
      // Populate cache for future lookups
      this.cache.set(cacheKey, record);
      console.log(`[ThreadTracker] Found in Airtable, caching: ${channelId}/${threadTs}`);
    }

    return record;
  }

  /**
   * Find a thread by channel, sync cycle, and type.
   * Useful for finding pre-meeting threads to reply to.
   *
   * @param channelId - Slack channel ID
   * @param syncCycleId - Sync cycle identifier
   * @param threadType - Type of thread to find
   * @returns TrackedThreadRecord if found, null otherwise
   */
  async findThreadBySyncCycle(
    channelId: string,
    syncCycleId: string,
    threadType: ThreadType
  ): Promise<TrackedThreadRecord | null> {
    // First, ensure cache is populated
    await this.loadActiveThreads();

    // Search cache for matching thread
    for (const thread of this.cache.values()) {
      if (
        thread.channelId === channelId &&
        thread.syncCycleId === syncCycleId &&
        thread.threadType === threadType
      ) {
        console.log(`[ThreadTracker] Found ${threadType} thread for ${channelId}/${syncCycleId}`);
        return thread;
      }
    }

    console.log(`[ThreadTracker] No ${threadType} thread found for ${channelId}/${syncCycleId}`);
    return null;
  }

  /**
   * Load active threads from Airtable into the cache.
   * Called on startup to restore thread tracking state.
   *
   * Loads threads from the last 14 days.
   */
  async loadActiveThreads(): Promise<void> {
    // Calculate date 14 days ago
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setUTCDate(fourteenDaysAgo.getUTCDate() - 14);
    fourteenDaysAgo.setUTCHours(0, 0, 0, 0);  // Start of day in UTC
    const sinceDate = fourteenDaysAgo.toISOString().split('T')[0];

    console.log(`[ThreadTracker] Loading active threads since ${sinceDate}`);

    // Fetch from Airtable
    const threads = await this.airtableClient.getActiveTrackedThreads(sinceDate);

    // Populate cache
    for (const thread of threads) {
      const cacheKey = getCacheKey(thread.channelId, thread.threadTs);
      this.cache.set(cacheKey, thread);
    }

    console.log(`[ThreadTracker] Loaded ${threads.length} active threads into cache`);
  }
}
