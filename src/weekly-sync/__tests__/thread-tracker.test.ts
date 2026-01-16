import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { WeeklySyncAirtableClient } from '../airtable-client';
import type { ThreadTracker, TrackedThread, ThreadType } from '../thread-tracker';

// Mock the airtable client
const mockCreateTrackedThread = vi.fn();
const mockFindTrackedThread = vi.fn();
const mockGetActiveTrackedThreads = vi.fn();

const createMockAirtableClient = (): WeeklySyncAirtableClient => {
  return {
    createTrackedThread: mockCreateTrackedThread,
    findTrackedThread: mockFindTrackedThread,
    getActiveTrackedThreads: mockGetActiveTrackedThreads,
  } as unknown as WeeklySyncAirtableClient;
};

describe('ThreadTracker', () => {
  let airtableClient: WeeklySyncAirtableClient;
  let tracker: ThreadTracker;

  beforeEach(async () => {
    vi.clearAllMocks();
    airtableClient = createMockAirtableClient();

    // Default mock responses
    mockCreateTrackedThread.mockResolvedValue('recNewThread123');
    mockFindTrackedThread.mockResolvedValue(null);
    mockGetActiveTrackedThreads.mockResolvedValue([]);

    // Import ThreadTracker dynamically (will fail until implementation exists)
    const { ThreadTracker: TrackerClass } = await import('../thread-tracker');
    tracker = new TrackerClass(airtableClient);
  });

  describe('registerThread', () => {
    it('stores thread in memory and Airtable', async () => {
      const threadData = {
        channelId: 'C0123ABCDEF',
        threadType: 'collection' as ThreadType,
        syncCycleId: 'sync-2026-01-13-001',
        personId: 'recPerson123',
        weekStart: '2026-01-13',
      };
      const threadTs = '1705152000.123456';

      await tracker.registerThread(threadData, threadTs);

      // Should have called Airtable to persist
      expect(mockCreateTrackedThread).toHaveBeenCalledWith(
        expect.objectContaining({
          threadTs,
          channelId: 'C0123ABCDEF',
          threadType: 'collection',
          syncCycleId: 'sync-2026-01-13-001',
          personId: 'recPerson123',
          weekStart: '2026-01-13',
        })
      );

      // Should be retrievable from memory
      const retrieved = await tracker.getThreadContext('C0123ABCDEF', threadTs);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.threadType).toBe('collection');
      expect(retrieved?.personId).toBe('recPerson123');
    });

    it('handles pre-meeting threads with projectId', async () => {
      const threadData = {
        channelId: 'C9876ZYXWVU',
        threadType: 'pre-meeting' as ThreadType,
        syncCycleId: 'sync-2026-01-13-002',
        projectId: 'recProject789',
        weekStart: '2026-01-13',
      };
      const threadTs = '1705152000.789012';

      await tracker.registerThread(threadData, threadTs);

      expect(mockCreateTrackedThread).toHaveBeenCalledWith(
        expect.objectContaining({
          threadType: 'pre-meeting',
          projectId: 'recProject789',
        })
      );

      const retrieved = await tracker.getThreadContext('C9876ZYXWVU', threadTs);
      expect(retrieved?.threadType).toBe('pre-meeting');
      expect(retrieved?.projectId).toBe('recProject789');
    });

    it('handles post-meeting threads with projectId', async () => {
      const threadData = {
        channelId: 'C5555MEETING',
        threadType: 'post-meeting' as ThreadType,
        syncCycleId: 'sync-2026-01-13-003',
        projectId: 'recProjectAlpha',
        weekStart: '2026-01-13',
        contextJson: '{"meetingId": "fireflies-abc123"}',
      };
      const threadTs = '1705152000.555555';

      await tracker.registerThread(threadData, threadTs);

      expect(mockCreateTrackedThread).toHaveBeenCalledWith(
        expect.objectContaining({
          threadType: 'post-meeting',
          projectId: 'recProjectAlpha',
          contextJson: '{"meetingId": "fireflies-abc123"}',
        })
      );

      const retrieved = await tracker.getThreadContext('C5555MEETING', threadTs);
      expect(retrieved?.contextJson).toBe('{"meetingId": "fireflies-abc123"}');
    });
  });

  describe('getThreadContext', () => {
    it('returns cached thread', async () => {
      // Register a thread first
      const threadData = {
        channelId: 'C1111CACHED',
        threadType: 'collection' as ThreadType,
        syncCycleId: 'sync-001',
        personId: 'recPersonCached',
        weekStart: '2026-01-13',
      };
      const threadTs = '1705152000.111111';

      await tracker.registerThread(threadData, threadTs);

      // Clear mock to ensure we're not calling Airtable
      mockFindTrackedThread.mockClear();

      // Retrieve from cache
      const retrieved = await tracker.getThreadContext('C1111CACHED', threadTs);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.threadType).toBe('collection');
      // Should NOT have queried Airtable (cache hit)
      expect(mockFindTrackedThread).not.toHaveBeenCalled();
    });

    it('fetches from Airtable if not cached', async () => {
      const channelId = 'C2222NOTCACHED';
      const threadTs = '1705152000.222222';

      mockFindTrackedThread.mockResolvedValueOnce({
        id: 'recThread222',
        threadTs,
        channelId,
        threadType: 'pre-meeting',
        syncCycleId: 'sync-002',
        projectId: 'recProjectBeta',
        personId: null,
        weekStart: '2026-01-13',
        contextJson: null,
      });

      const retrieved = await tracker.getThreadContext(channelId, threadTs);

      expect(mockFindTrackedThread).toHaveBeenCalledWith(channelId, threadTs);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.threadType).toBe('pre-meeting');
      expect(retrieved?.projectId).toBe('recProjectBeta');

      // Second fetch should come from cache
      mockFindTrackedThread.mockClear();
      const secondRetrieve = await tracker.getThreadContext(channelId, threadTs);
      expect(mockFindTrackedThread).not.toHaveBeenCalled();
      expect(secondRetrieve?.threadType).toBe('pre-meeting');
    });

    it('returns null for unknown thread', async () => {
      mockFindTrackedThread.mockResolvedValueOnce(null);

      const retrieved = await tracker.getThreadContext(
        'C9999UNKNOWN',
        '1705152000.999999'
      );

      expect(retrieved).toBeNull();
    });
  });

  describe('loadActiveThreads', () => {
    it('populates cache from Airtable', async () => {
      const activeThreads = [
        {
          id: 'recThread1',
          threadTs: '1705152000.111111',
          channelId: 'C0001ACTIVE',
          threadType: 'collection' as ThreadType,
          syncCycleId: 'sync-001',
          personId: 'recPerson1',
          projectId: null,
          weekStart: '2026-01-13',
          contextJson: null,
        },
        {
          id: 'recThread2',
          threadTs: '1705152000.222222',
          channelId: 'C0002ACTIVE',
          threadType: 'pre-meeting' as ThreadType,
          syncCycleId: 'sync-001',
          personId: null,
          projectId: 'recProject1',
          weekStart: '2026-01-13',
          contextJson: '{"test": true}',
        },
        {
          id: 'recThread3',
          threadTs: '1705152000.333333',
          channelId: 'C0003ACTIVE',
          threadType: 'post-meeting' as ThreadType,
          syncCycleId: 'sync-001',
          personId: null,
          projectId: 'recProject2',
          weekStart: '2026-01-13',
          contextJson: null,
        },
      ];

      mockGetActiveTrackedThreads.mockResolvedValueOnce(activeThreads);

      await tracker.loadActiveThreads();

      // After loading, should be able to get threads from cache without Airtable query
      mockFindTrackedThread.mockClear();

      const thread1 = await tracker.getThreadContext('C0001ACTIVE', '1705152000.111111');
      expect(thread1?.threadType).toBe('collection');
      expect(thread1?.personId).toBe('recPerson1');

      const thread2 = await tracker.getThreadContext('C0002ACTIVE', '1705152000.222222');
      expect(thread2?.threadType).toBe('pre-meeting');
      expect(thread2?.projectId).toBe('recProject1');
      expect(thread2?.contextJson).toBe('{"test": true}');

      const thread3 = await tracker.getThreadContext('C0003ACTIVE', '1705152000.333333');
      expect(thread3?.threadType).toBe('post-meeting');
      expect(thread3?.projectId).toBe('recProject2');

      // Should NOT have queried Airtable (all from cache)
      expect(mockFindTrackedThread).not.toHaveBeenCalled();
    });

    it('loads threads from last 14 days', async () => {
      mockGetActiveTrackedThreads.mockResolvedValueOnce([
        {
          id: 'recThreadRecent',
          threadTs: '1705152000.111111',
          channelId: 'C0001RECENT',
          threadType: 'collection' as ThreadType,
          syncCycleId: 'sync-recent',
          personId: 'recPersonRecent',
          projectId: null,
          weekStart: '2026-01-13',
          contextJson: null,
        },
      ]);

      await tracker.loadActiveThreads();

      // Should have called getActiveTrackedThreads with a date ~14 days ago
      expect(mockGetActiveTrackedThreads).toHaveBeenCalledWith(
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)
      );
    });
  });

  describe('findThreadBySyncCycle', () => {
    it('finds pre-meeting thread by channel and sync cycle', async () => {
      const activeThreads: TrackedThreadRecord[] = [
        {
          id: 'recThread1',
          threadTs: '1705152000.111111',
          channelId: 'C001PROJECT',
          threadType: 'pre-meeting' as ThreadType,
          syncCycleId: 'sync-2026-01-13-001',
          personId: null,
          projectId: 'recProject1',
          weekStart: '2026-01-13',
          contextJson: null,
        },
        {
          id: 'recThread2',
          threadTs: '1705152000.222222',
          channelId: 'C001PROJECT',
          threadType: 'post-meeting' as ThreadType,
          syncCycleId: 'sync-2026-01-13-001',
          personId: null,
          projectId: 'recProject1',
          weekStart: '2026-01-13',
          contextJson: null,
        },
      ];

      mockGetActiveTrackedThreads.mockResolvedValueOnce(activeThreads);

      const result = await tracker.findThreadBySyncCycle(
        'C001PROJECT',
        'sync-2026-01-13-001',
        'pre-meeting'
      );

      expect(result).not.toBeNull();
      expect(result?.threadTs).toBe('1705152000.111111');
      expect(result?.threadType).toBe('pre-meeting');
    });

    it('returns null when no matching thread exists', async () => {
      mockGetActiveTrackedThreads.mockResolvedValueOnce([]);

      const result = await tracker.findThreadBySyncCycle(
        'C001PROJECT',
        'sync-2026-01-13-001',
        'pre-meeting'
      );

      expect(result).toBeNull();
    });

    it('filters by all three criteria (channel, syncCycle, threadType)', async () => {
      const activeThreads: TrackedThreadRecord[] = [
        {
          id: 'recThread1',
          threadTs: '1705152000.111111',
          channelId: 'C001PROJECT',  // Different channel
          threadType: 'pre-meeting' as ThreadType,
          syncCycleId: 'sync-2026-01-13-001',
          personId: null,
          projectId: 'recProject1',
          weekStart: '2026-01-13',
          contextJson: null,
        },
        {
          id: 'recThread2',
          threadTs: '1705152000.222222',
          channelId: 'C002PROJECT',
          threadType: 'collection' as ThreadType,  // Different type
          syncCycleId: 'sync-2026-01-13-001',
          personId: 'recPerson1',
          projectId: null,
          weekStart: '2026-01-13',
          contextJson: null,
        },
      ];

      mockGetActiveTrackedThreads.mockResolvedValueOnce(activeThreads);

      // Should not find a pre-meeting thread for C002PROJECT
      const result = await tracker.findThreadBySyncCycle(
        'C002PROJECT',
        'sync-2026-01-13-001',
        'pre-meeting'
      );

      expect(result).toBeNull();
    });
  });

  describe('input validation', () => {
    it('throws error if channelId is missing', async () => {
      const threadData = {
        channelId: '',
        threadType: 'collection' as ThreadType,
        syncCycleId: 'sync-001',
        personId: 'recPerson123',
        weekStart: '2026-01-13',
      };

      await expect(tracker.registerThread(threadData, '1705152000.123456')).rejects.toThrow(
        'channelId and threadTs are required'
      );
    });

    it('throws error if threadTs is missing', async () => {
      const threadData = {
        channelId: 'C0123ABCDEF',
        threadType: 'collection' as ThreadType,
        syncCycleId: 'sync-001',
        personId: 'recPerson123',
        weekStart: '2026-01-13',
      };

      await expect(tracker.registerThread(threadData, '')).rejects.toThrow(
        'channelId and threadTs are required'
      );
    });

    it('throws error for invalid threadType', async () => {
      const threadData = {
        channelId: 'C0123ABCDEF',
        threadType: 'invalid-type' as ThreadType,
        syncCycleId: 'sync-001',
        weekStart: '2026-01-13',
      };

      await expect(tracker.registerThread(threadData, '1705152000.123456')).rejects.toThrow(
        'Invalid threadType: invalid-type'
      );
    });

    it('throws error if personId is missing for collection thread', async () => {
      const threadData = {
        channelId: 'C0123ABCDEF',
        threadType: 'collection' as ThreadType,
        syncCycleId: 'sync-001',
        weekStart: '2026-01-13',
      };

      await expect(tracker.registerThread(threadData, '1705152000.123456')).rejects.toThrow(
        'personId is required for collection threads'
      );
    });

    it('throws error if projectId is missing for pre-meeting thread', async () => {
      const threadData = {
        channelId: 'C0123ABCDEF',
        threadType: 'pre-meeting' as ThreadType,
        syncCycleId: 'sync-001',
        weekStart: '2026-01-13',
      };

      await expect(tracker.registerThread(threadData, '1705152000.123456')).rejects.toThrow(
        'projectId is required for pre-meeting and post-meeting threads'
      );
    });

    it('throws error if projectId is missing for post-meeting thread', async () => {
      const threadData = {
        channelId: 'C0123ABCDEF',
        threadType: 'post-meeting' as ThreadType,
        syncCycleId: 'sync-001',
        weekStart: '2026-01-13',
      };

      await expect(tracker.registerThread(threadData, '1705152000.123456')).rejects.toThrow(
        'projectId is required for pre-meeting and post-meeting threads'
      );
    });
  });

  describe('thread type handling', () => {
    it('correctly stores collection threads with personId', async () => {
      const threadData = {
        channelId: 'C_COLLECTION',
        threadType: 'collection' as ThreadType,
        syncCycleId: 'sync-coll',
        personId: 'recPersonCollection',
        weekStart: '2026-01-13',
      };

      await tracker.registerThread(threadData, '1705152000.111111');

      expect(mockCreateTrackedThread).toHaveBeenCalledWith(
        expect.objectContaining({
          threadType: 'collection',
          personId: 'recPersonCollection',
          projectId: null,
        })
      );
    });

    it('correctly stores pre-meeting threads with projectId', async () => {
      const threadData = {
        channelId: 'C_PREMEETING',
        threadType: 'pre-meeting' as ThreadType,
        syncCycleId: 'sync-pre',
        projectId: 'recProjectPre',
        weekStart: '2026-01-13',
      };

      await tracker.registerThread(threadData, '1705152000.222222');

      expect(mockCreateTrackedThread).toHaveBeenCalledWith(
        expect.objectContaining({
          threadType: 'pre-meeting',
          projectId: 'recProjectPre',
          personId: null,
        })
      );
    });

    it('correctly stores post-meeting threads with projectId', async () => {
      const threadData = {
        channelId: 'C_POSTMEETING',
        threadType: 'post-meeting' as ThreadType,
        syncCycleId: 'sync-post',
        projectId: 'recProjectPost',
        weekStart: '2026-01-13',
      };

      await tracker.registerThread(threadData, '1705152000.333333');

      expect(mockCreateTrackedThread).toHaveBeenCalledWith(
        expect.objectContaining({
          threadType: 'post-meeting',
          projectId: 'recProjectPost',
          personId: null,
        })
      );
    });
  });
});
