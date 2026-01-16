import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { WebClient } from '@slack/bolt';
import type { WeeklySyncAirtableClient, PersonRecord, ProjectRecord } from '../airtable-client';
import type { ThreadTracker } from '../thread-tracker';
import type { Logger } from '../../logger';

// Mock the Slack WebClient
const mockChatPostMessage = vi.fn();
const mockConversationsOpen = vi.fn();

const createMockSlackClient = (): WebClient => {
  return {
    chat: {
      postMessage: mockChatPostMessage,
    },
    conversations: {
      open: mockConversationsOpen,
    },
  } as unknown as WebClient;
};

// Mock the Airtable client
const mockGetActiveTeamMembers = vi.fn();
const mockCreateWeeklyUpdate = vi.fn();
const mockUpdateWeeklyUpdateDMStatus = vi.fn();
const mockUpdateWeeklyUpdateSlackInfo = vi.fn();
const mockGetActiveProjects = vi.fn();
const mockGetProjectById = vi.fn();

const createMockAirtableClient = (): WeeklySyncAirtableClient => {
  return {
    getActiveTeamMembers: mockGetActiveTeamMembers,
    createWeeklyUpdate: mockCreateWeeklyUpdate,
    updateWeeklyUpdateDMStatus: mockUpdateWeeklyUpdateDMStatus,
    updateWeeklyUpdateSlackInfo: mockUpdateWeeklyUpdateSlackInfo,
    getActiveProjects: mockGetActiveProjects,
    getProjectById: mockGetProjectById,
  } as unknown as WeeklySyncAirtableClient;
};

// Mock the ThreadTracker
const mockRegisterThread = vi.fn();
const mockGetThreadContext = vi.fn();

const createMockThreadTracker = (): ThreadTracker => {
  return {
    registerThread: mockRegisterThread,
    getThreadContext: mockGetThreadContext,
  } as unknown as ThreadTracker;
};

// Mock Logger
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

describe('CollectionManager', () => {
  let airtableClient: WeeklySyncAirtableClient;
  let threadTracker: ThreadTracker;
  let slackClient: WebClient;
  let logger: Logger;
  let collectionManager: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    airtableClient = createMockAirtableClient();
    threadTracker = createMockThreadTracker();
    slackClient = createMockSlackClient();
    logger = createMockLogger();

    // Default mock responses
    mockGetActiveTeamMembers.mockResolvedValue([]);
    mockCreateWeeklyUpdate.mockResolvedValue('recNewUpdate123');
    mockConversationsOpen.mockResolvedValue({
      ok: true,
      channel: { id: 'D0123DMCHAN' },
    });
    mockChatPostMessage.mockResolvedValue({
      ok: true,
      ts: '1705152000.123456',
    });
    mockGetActiveProjects.mockResolvedValue([]);
    mockGetProjectById.mockResolvedValue(null);

    // Import CollectionManager dynamically (will fail until implementation exists)
    const { CollectionManager } = await import('../collection-manager');
    collectionManager = new CollectionManager({
      airtableClient,
      threadTracker,
      slackClient,
      logger,
    });
  });

  describe('startCollection', () => {
    it('sends DMs to all active team members', async () => {
      const teamMembers: PersonRecord[] = [
        {
          id: 'recPerson1',
          name: 'Alice Johnson',
          email: 'alice@example.com',
          slackUserId: 'U001ALICE',
        },
        {
          id: 'recPerson2',
          name: 'Bob Martinez',
          email: 'bob@example.com',
          slackUserId: 'U002BOB',
        },
        {
          id: 'recPerson3',
          name: 'Carol Kim',
          email: 'carol@example.com',
          slackUserId: 'U003CAROL',
        },
      ];

      mockGetActiveTeamMembers.mockResolvedValueOnce(teamMembers);

      const result = await collectionManager.startCollection(
        '2026-01-13',
        'sync-2026-01-13-001'
      );

      expect(result.sent).toBe(3);
      expect(result.failed).toBe(0);
      expect(mockConversationsOpen).toHaveBeenCalledTimes(3);
      expect(mockChatPostMessage).toHaveBeenCalledTimes(3);
    });

    it('creates Weekly Update records before sending DMs', async () => {
      const teamMembers: PersonRecord[] = [
        {
          id: 'recPerson1',
          name: 'Alice Johnson',
          email: 'alice@example.com',
          slackUserId: 'U001ALICE',
        },
      ];

      mockGetActiveTeamMembers.mockResolvedValueOnce(teamMembers);

      await collectionManager.startCollection('2026-01-13', 'sync-2026-01-13-001');

      // Should create record before opening DM
      const createCallOrder = mockCreateWeeklyUpdate.mock.invocationCallOrder[0];
      const openDmCallOrder = mockConversationsOpen.mock.invocationCallOrder[0];
      expect(createCallOrder).toBeLessThan(openDmCallOrder);

      expect(mockCreateWeeklyUpdate).toHaveBeenCalledWith({
        weekStart: '2026-01-13',
        personId: 'recPerson1',
        syncCycleId: 'sync-2026-01-13-001',
        dmStatus: 'Pending',
      });
    });

    it('updates DM status to Sent after successful send', async () => {
      const teamMembers: PersonRecord[] = [
        {
          id: 'recPerson1',
          name: 'Alice Johnson',
          email: 'alice@example.com',
          slackUserId: 'U001ALICE',
        },
      ];

      mockGetActiveTeamMembers.mockResolvedValueOnce(teamMembers);
      mockCreateWeeklyUpdate.mockResolvedValueOnce('recUpdate123');

      await collectionManager.startCollection('2026-01-13', 'sync-2026-01-13-001');

      expect(mockUpdateWeeklyUpdateSlackInfo).toHaveBeenCalledWith(
        'recUpdate123',
        'D0123DMCHAN',
        '1705152000.123456'
      );
    });

    it('updates DM status to Failed on error', async () => {
      const teamMembers: PersonRecord[] = [
        {
          id: 'recPerson1',
          name: 'Alice Johnson',
          email: 'alice@example.com',
          slackUserId: 'U001ALICE',
        },
      ];

      mockGetActiveTeamMembers.mockResolvedValueOnce(teamMembers);
      mockCreateWeeklyUpdate.mockResolvedValueOnce('recUpdate123');
      mockConversationsOpen.mockRejectedValueOnce(new Error('Slack API error'));

      const result = await collectionManager.startCollection(
        '2026-01-13',
        'sync-2026-01-13-001'
      );

      expect(result.sent).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].userId).toBe('U001ALICE');

      expect(mockUpdateWeeklyUpdateDMStatus).toHaveBeenCalledWith(
        'recUpdate123',
        'Failed'
      );
    });

    it('registers threads for tracking after successful send', async () => {
      const teamMembers: PersonRecord[] = [
        {
          id: 'recPerson1',
          name: 'Alice Johnson',
          email: 'alice@example.com',
          slackUserId: 'U001ALICE',
        },
      ];

      mockGetActiveTeamMembers.mockResolvedValueOnce(teamMembers);
      mockCreateWeeklyUpdate.mockResolvedValueOnce('recUpdate123');

      await collectionManager.startCollection('2026-01-13', 'sync-2026-01-13-001');

      expect(mockRegisterThread).toHaveBeenCalledWith(
        {
          channelId: 'D0123DMCHAN',
          threadType: 'collection',
          syncCycleId: 'sync-2026-01-13-001',
          personId: 'recPerson1',
          weekStart: '2026-01-13',
        },
        '1705152000.123456'
      );
    });

    it('handles rate limiting with 1 second delay between sends', async () => {
      const teamMembers: PersonRecord[] = [
        {
          id: 'recPerson1',
          name: 'Alice Johnson',
          email: 'alice@example.com',
          slackUserId: 'U001ALICE',
        },
        {
          id: 'recPerson2',
          name: 'Bob Martinez',
          email: 'bob@example.com',
          slackUserId: 'U002BOB',
        },
      ];

      mockGetActiveTeamMembers.mockResolvedValueOnce(teamMembers);

      const startTime = Date.now();
      await collectionManager.startCollection('2026-01-13', 'sync-2026-01-13-001');
      const elapsedTime = Date.now() - startTime;

      // Should have at least 1 second delay between the 2 sends
      expect(elapsedTime).toBeGreaterThanOrEqual(1000);
    });

    it('skips user and records error when Weekly Update creation fails', async () => {
      const teamMembers: PersonRecord[] = [
        {
          id: 'recPerson1',
          name: 'Alice Johnson',
          email: 'alice@example.com',
          slackUserId: 'U001ALICE',
        },
        {
          id: 'recPerson2',
          name: 'Bob Martinez',
          email: 'bob@example.com',
          slackUserId: 'U002BOB',
        },
      ];

      mockGetActiveTeamMembers.mockResolvedValueOnce(teamMembers);
      mockCreateWeeklyUpdate.mockRejectedValueOnce(new Error('Airtable error'));
      // Second call succeeds
      mockCreateWeeklyUpdate.mockResolvedValueOnce('recUpdate456');

      const result = await collectionManager.startCollection(
        '2026-01-13',
        'sync-2026-01-13-001'
      );

      expect(result.sent).toBe(1); // Only Bob succeeds
      expect(result.failed).toBe(1); // Alice fails
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].userId).toBe('U001ALICE');
      expect(result.errors[0].error).toContain('Airtable');

      // Verify DM was NOT attempted for Alice
      expect(mockConversationsOpen).toHaveBeenCalledTimes(1);
      expect(mockConversationsOpen).toHaveBeenCalledWith({ users: 'U002BOB' });
    });

    it('skips team members without Slack user ID', async () => {
      const teamMembers: PersonRecord[] = [
        {
          id: 'recPerson1',
          name: 'Alice Johnson',
          email: 'alice@example.com',
          slackUserId: 'U001ALICE',
        },
        {
          id: 'recPerson2',
          name: 'Bob Martinez (no Slack)',
          email: 'bob@example.com',
          slackUserId: null,
        },
      ];

      mockGetActiveTeamMembers.mockResolvedValueOnce(teamMembers);

      const result = await collectionManager.startCollection(
        '2026-01-13',
        'sync-2026-01-13-001'
      );

      expect(result.sent).toBe(1);
      expect(mockConversationsOpen).toHaveBeenCalledTimes(1);
      expect(mockConversationsOpen).toHaveBeenCalledWith({
        users: 'U001ALICE',
      });
    });
  });

  describe('isCollectionThread', () => {
    it('returns true for registered collection threads', async () => {
      mockGetThreadContext.mockResolvedValueOnce({
        id: 'recThread123',
        threadTs: '1705152000.123456',
        channelId: 'D0123DMCHAN',
        threadType: 'collection',
        syncCycleId: 'sync-2026-01-13-001',
        personId: 'recPerson1',
        projectId: null,
        weekStart: '2026-01-13',
        contextJson: null,
      });

      const isCollection = await collectionManager.isCollectionThread(
        'D0123DMCHAN',
        '1705152000.123456'
      );

      expect(isCollection).toBe(true);
      expect(mockGetThreadContext).toHaveBeenCalledWith(
        'D0123DMCHAN',
        '1705152000.123456'
      );
    });

    it('returns false for unknown threads', async () => {
      mockGetThreadContext.mockResolvedValueOnce(null);

      const isCollection = await collectionManager.isCollectionThread(
        'D9999UNKNOWN',
        '1705152000.999999'
      );

      expect(isCollection).toBe(false);
    });

    it('returns false for non-collection thread types', async () => {
      mockGetThreadContext.mockResolvedValueOnce({
        id: 'recThread456',
        threadTs: '1705152000.456789',
        channelId: 'C0123CHANNEL',
        threadType: 'pre-meeting',
        syncCycleId: 'sync-2026-01-13-001',
        personId: null,
        projectId: 'recProject1',
        weekStart: '2026-01-13',
        contextJson: null,
      });

      const isCollection = await collectionManager.isCollectionThread(
        'C0123CHANNEL',
        '1705152000.456789'
      );

      expect(isCollection).toBe(false);
    });
  });

  describe('getCollectionContext', () => {
    it('returns skill and context data for collection threads', async () => {
      mockGetThreadContext.mockResolvedValueOnce({
        id: 'recThread123',
        threadTs: '1705152000.123456',
        channelId: 'D0123DMCHAN',
        threadType: 'collection',
        syncCycleId: 'sync-2026-01-13-001',
        personId: 'recPerson1',
        projectId: null,
        weekStart: '2026-01-13',
        contextJson: JSON.stringify({
          personName: 'Alice Johnson',
          projects: [
            { id: 'recProject1', name: 'Long Beach Airport' },
            { id: 'recProject2', name: 'Marina Development' },
          ],
        }),
      });

      const context = await collectionManager.getCollectionContext(
        'D0123DMCHAN',
        '1705152000.123456'
      );

      expect(context).toEqual({
        skill: 'weekly-sync-collection',
        personId: 'recPerson1',
        personName: 'Alice Johnson',
        weekStart: '2026-01-13',
        projects: [
          { id: 'recProject1', name: 'Long Beach Airport' },
          { id: 'recProject2', name: 'Marina Development' },
        ],
      });
    });

    it('returns null for unknown threads', async () => {
      mockGetThreadContext.mockResolvedValueOnce(null);

      const context = await collectionManager.getCollectionContext(
        'D9999UNKNOWN',
        '1705152000.999999'
      );

      expect(context).toBeNull();
    });

    it('returns null for non-collection threads', async () => {
      mockGetThreadContext.mockResolvedValueOnce({
        id: 'recThread456',
        threadTs: '1705152000.456789',
        channelId: 'C0123CHANNEL',
        threadType: 'pre-meeting',
        syncCycleId: 'sync-2026-01-13-001',
        personId: null,
        projectId: 'recProject1',
        weekStart: '2026-01-13',
        contextJson: null,
      });

      const context = await collectionManager.getCollectionContext(
        'C0123CHANNEL',
        '1705152000.456789'
      );

      expect(context).toBeNull();
    });

    it('returns context with empty projects when contextJson is missing', async () => {
      mockGetThreadContext.mockResolvedValueOnce({
        id: 'recThread999',
        threadTs: '1705152000.999999',
        channelId: 'D0999DMCHAN',
        threadType: 'collection',
        syncCycleId: 'sync-2026-01-13-001',
        personId: 'recPerson99',
        projectId: null,
        weekStart: '2026-01-13',
        contextJson: null,
      });

      const context = await collectionManager.getCollectionContext(
        'D0999DMCHAN',
        '1705152000.999999'
      );

      expect(context).not.toBeNull();
      expect(context!.skill).toBe('weekly-sync-collection');
      expect(context!.personId).toBe('recPerson99');
      expect(context!.personName).toBe('');
      expect(context!.projects).toEqual([]);
      expect(context!.weekStart).toBe('2026-01-13');
    });
  });

  describe('sendCollectionDM', () => {
    it('opens DM channel via Slack API', async () => {
      const personRecord: PersonRecord = {
        id: 'recPerson1',
        name: 'Alice Johnson',
        email: 'alice@example.com',
        slackUserId: 'U001ALICE',
      };

      await collectionManager.sendCollectionDM(
        personRecord,
        '2026-01-13',
        'sync-2026-01-13-001'
      );

      expect(mockConversationsOpen).toHaveBeenCalledWith({
        users: 'U001ALICE',
      });
    });

    it('posts message to DM channel with correct format', async () => {
      const personRecord: PersonRecord = {
        id: 'recPerson1',
        name: 'Alice Johnson',
        email: 'alice@example.com',
        slackUserId: 'U001ALICE',
      };

      mockGetActiveProjects.mockResolvedValueOnce([
        {
          id: 'recProject1',
          name: 'Long Beach Airport',
          status: 'Active',
          slackChannelId: 'C001PROJECT',
          teamMemberIds: ['recPerson1'],
          projectLeadIds: [],
        },
        {
          id: 'recProject2',
          name: 'Marina Development',
          status: 'Active',
          slackChannelId: 'C002PROJECT',
          teamMemberIds: ['recPerson1'],
          projectLeadIds: [],
        },
      ]);

      await collectionManager.sendCollectionDM(
        personRecord,
        '2026-01-13',
        'sync-2026-01-13-001'
      );

      expect(mockChatPostMessage).toHaveBeenCalledWith({
        channel: 'D0123DMCHAN',
        text: expect.stringContaining('Weekly Sync Check-In'),
      });

      const messageText = mockChatPostMessage.mock.calls[0][0].text;
      expect(messageText).toContain('Alice');
      expect(messageText).toContain('weekly project update');
      expect(messageText).toContain('Reply to this thread');
    });

    it('returns success with channel ID and thread timestamp', async () => {
      const personRecord: PersonRecord = {
        id: 'recPerson1',
        name: 'Alice Johnson',
        email: 'alice@example.com',
        slackUserId: 'U001ALICE',
      };

      const result = await collectionManager.sendCollectionDM(
        personRecord,
        '2026-01-13',
        'sync-2026-01-13-001'
      );

      expect(result).toEqual({
        success: true,
        channelId: 'D0123DMCHAN',
        threadTs: '1705152000.123456',
      });
    });

    it('returns error when Slack API fails', async () => {
      const personRecord: PersonRecord = {
        id: 'recPerson1',
        name: 'Alice Johnson',
        email: 'alice@example.com',
        slackUserId: 'U001ALICE',
      };

      mockConversationsOpen.mockRejectedValueOnce(new Error('API timeout'));

      const result = await collectionManager.sendCollectionDM(
        personRecord,
        '2026-01-13',
        'sync-2026-01-13-001'
      );

      expect(result).toEqual({
        success: false,
        error: expect.stringContaining('API timeout'),
      });
    });

    it('stores person projects in context JSON', async () => {
      const personRecord: PersonRecord = {
        id: 'recPerson1',
        name: 'Alice Johnson',
        email: 'alice@example.com',
        slackUserId: 'U001ALICE',
      };

      const projects: ProjectRecord[] = [
        {
          id: 'recProject1',
          name: 'Long Beach Airport',
          status: 'Active',
          slackChannelId: 'C001PROJECT',
          teamMemberIds: ['recPerson1'],
          projectLeadIds: [],
        },
        {
          id: 'recProject2',
          name: 'Marina Development',
          status: 'Active',
          slackChannelId: 'C002PROJECT',
          teamMemberIds: ['recPerson1'],
          projectLeadIds: ['recPerson1'],
        },
      ];

      mockGetActiveProjects.mockResolvedValueOnce(projects);

      await collectionManager.sendCollectionDM(
        personRecord,
        '2026-01-13',
        'sync-2026-01-13-001'
      );

      expect(mockRegisterThread).toHaveBeenCalledWith(
        expect.objectContaining({
          contextJson: expect.stringContaining('Long Beach Airport'),
        }),
        '1705152000.123456'
      );

      const contextJson = JSON.parse(
        mockRegisterThread.mock.calls[0][0].contextJson
      );
      expect(contextJson.personName).toBe('Alice Johnson');
      expect(contextJson.projects).toHaveLength(2);
      expect(contextJson.projects[0].name).toBe('Long Beach Airport');
    });
  });
});
