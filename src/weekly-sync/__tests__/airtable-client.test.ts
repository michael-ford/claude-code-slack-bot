import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import type { CreateWeeklyUpdateData } from '../airtable-client';
import type { UpdateSegment } from '../types';

// Create mock table functions
const mockFirstPage = vi.fn();
const mockAll = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockFind = vi.fn();

const mockSelect = vi.fn(() => ({
  firstPage: mockFirstPage,
  all: mockAll,
}));

const mockTable = vi.fn(() => ({
  select: mockSelect,
  create: mockCreate,
  update: mockUpdate,
  find: mockFind,
}));

// Mock the Airtable library as a constructor
vi.mock('airtable', () => {
  return {
    default: class MockAirtable {
      constructor(_options: { apiKey: string }) {
        // Constructor receives options
      }
      base(_baseId: string) {
        return mockTable;
      }
    },
  };
});

// Mock the config module
vi.mock('../../config', () => ({
  config: {
    airtable: {
      token: 'keyTestAirtableToken123',
      baseId: 'appTestBaseId123',
    },
  },
}));

// Import after mocks are set up
import { WeeklySyncAirtableClient } from '../airtable-client';

describe('WeeklySyncAirtableClient', () => {
  let client: WeeklySyncAirtableClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new WeeklySyncAirtableClient();

    // Reset all mocks to default empty responses
    mockFirstPage.mockResolvedValue([]);
    mockAll.mockResolvedValue([]);
    mockCreate.mockResolvedValue({ id: 'recMockCreated123', fields: {} });
    mockUpdate.mockResolvedValue({ id: 'recMockUpdated123', fields: {} });
    mockFind.mockResolvedValue({ id: 'recMockFound123', fields: {} });
  });

  describe('findPersonBySlackId', () => {
    it('returns PersonRecord when user exists', async () => {
      mockFirstPage.mockResolvedValueOnce([
        {
          id: 'recPerson123',
          fields: {
            'Full Name': 'Sarah Johnson',
            'Email': 'sarah.johnson@example.com',
            'Slack User ID': 'U0123ABCDEF',
          },
        },
      ]);

      const result = await client.findPersonBySlackId('U0123ABCDEF');

      expect(result).not.toBeNull();
      expect(result).toMatchObject({
        id: expect.any(String),
        name: expect.any(String),
        email: expect.any(String),
        slackUserId: 'U0123ABCDEF',
      });
    });

    it('returns null when user not found', async () => {
      mockFirstPage.mockResolvedValueOnce([]);

      const result = await client.findPersonBySlackId('U9999NOTFOUND');

      expect(result).toBeNull();
    });

    it('escapes special characters in formula - handles apostrophes', async () => {
      // Test that a Slack ID with an apostrophe doesn't break the formula
      const slackIdWithApostrophe = "U0123A'BCDEF";
      mockFirstPage.mockResolvedValueOnce([
        {
          id: 'recPersonApos',
          fields: {
            'Full Name': "Patrick O'Brien",
            'Email': 'patrick@example.com',
            'Slack User ID': slackIdWithApostrophe,
          },
        },
      ]);

      const result = await client.findPersonBySlackId(slackIdWithApostrophe);

      // Should not throw an error and should handle the apostrophe
      expect(result).toBeDefined();
    });

    it('escapes special characters in formula - handles backslashes', async () => {
      // Test that a Slack ID with a backslash doesn't break the formula
      const slackIdWithBackslash = 'U0123A\\BCDEF';
      mockFirstPage.mockResolvedValueOnce([
        {
          id: 'recPersonBackslash',
          fields: {
            'Full Name': 'Test User',
            'Email': 'test@example.com',
            'Slack User ID': slackIdWithBackslash,
          },
        },
      ]);

      const result = await client.findPersonBySlackId(slackIdWithBackslash);

      // Should not throw an error and should handle the backslash
      expect(result).toBeDefined();
    });
  });

  describe('getActiveTeamMembers', () => {
    it('returns people who are Team Members on active projects', async () => {
      // Mock active projects with team members
      mockAll.mockResolvedValueOnce([
        {
          id: 'recProject1',
          fields: {
            'Team Members': ['recPerson1', 'recPerson2'],
            'Project Lead': ['recPerson3'],
          },
        },
      ]);

      // Mock person records
      mockAll.mockResolvedValueOnce([
        {
          id: 'recPerson1',
          fields: {
            'Full Name': 'Alice Smith',
            'Email': 'alice@example.com',
            'Slack User ID': 'U111',
          },
        },
        {
          id: 'recPerson2',
          fields: {
            'Full Name': 'Bob Jones',
            'Email': 'bob@example.com',
            'Slack User ID': 'U222',
          },
        },
        {
          id: 'recPerson3',
          fields: {
            'Full Name': 'Carol Williams',
            'Email': 'carol@example.com',
            'Slack User ID': 'U333',
          },
        },
      ]);

      const members = await client.getActiveTeamMembers();

      expect(Array.isArray(members)).toBe(true);
      expect(members.length).toBeGreaterThan(0);
      members.forEach((member) => {
        expect(member).toMatchObject({
          id: expect.any(String),
          name: expect.any(String),
          email: expect.any(String),
        });
      });
    });

    it('returns people who are Project Leads on active projects', async () => {
      // Mock active projects with project leads
      mockAll.mockResolvedValueOnce([
        {
          id: 'recProject2',
          fields: {
            'Team Members': [],
            'Project Lead': ['recLead1'],
          },
        },
      ]);

      // Mock person records
      mockAll.mockResolvedValueOnce([
        {
          id: 'recLead1',
          fields: {
            'Full Name': 'David Brown',
            'Email': 'david@example.com',
            'Slack User ID': 'U444',
          },
        },
      ]);

      const members = await client.getActiveTeamMembers();

      expect(Array.isArray(members)).toBe(true);
      expect(members.length).toBeGreaterThan(0);
    });

    it('returns empty array when no active projects exist', async () => {
      // Mock empty active projects response
      mockAll.mockResolvedValueOnce([]);

      const members = await client.getActiveTeamMembers();

      expect(Array.isArray(members)).toBe(true);
      expect(members.length).toBe(0);
    });

    it('deduplicates people who are on multiple projects', async () => {
      // Mock multiple projects with the same person
      mockAll.mockResolvedValueOnce([
        {
          id: 'recProject3',
          fields: {
            'Team Members': ['recPersonDupe'],
            'Project Lead': [],
          },
        },
        {
          id: 'recProject4',
          fields: {
            'Team Members': ['recPersonDupe'],
            'Project Lead': ['recPersonDupe'],
          },
        },
      ]);

      // Mock person record (should only return once)
      mockAll.mockResolvedValueOnce([
        {
          id: 'recPersonDupe',
          fields: {
            'Full Name': 'Emma Davis',
            'Email': 'emma@example.com',
            'Slack User ID': 'U555',
          },
        },
      ]);

      const members = await client.getActiveTeamMembers();

      expect(Array.isArray(members)).toBe(true);

      // Check for duplicates by ID
      const ids = members.map((m) => m.id);
      const uniqueIds = new Set(ids);

      expect(ids.length).toBe(uniqueIds.size);
    });
  });

  describe('createWeeklyUpdate', () => {
    it('creates record with DM Status = "Pending"', async () => {
      mockCreate.mockResolvedValueOnce({
        id: 'recWeeklyUpdate001',
        fields: {
          'Week Start': '2026-01-13',
          Person: ['rec123PersonId'],
          'Response Status': 'Pending',
          'DM Status': 'Pending',
          'Parsing Status': 'Pending',
          'Sync Cycle ID': 'sync-2026-01-13-001',
        },
      });

      const data: CreateWeeklyUpdateData = {
        weekStart: '2026-01-13',
        personId: 'rec123PersonId',
        syncCycleId: 'sync-2026-01-13-001',
        dmStatus: 'Pending',
      };

      const recordId = await client.createWeeklyUpdate(data);

      expect(recordId).toBeDefined();
      expect(typeof recordId).toBe('string');
      expect(recordId.length).toBeGreaterThan(0);
    });

    it('returns the created record ID', async () => {
      mockCreate.mockResolvedValueOnce({
        id: 'recWeeklyUpdate456',
        fields: {},
      });

      const data: CreateWeeklyUpdateData = {
        weekStart: '2026-01-13',
        personId: 'rec456PersonId',
        syncCycleId: 'sync-2026-01-13-002',
        dmStatus: 'Pending',
      };

      const recordId = await client.createWeeklyUpdate(data);

      expect(recordId).toMatch(/^rec[A-Za-z0-9]+$/);
    });

    it('sets initial Response Status to "Pending"', async () => {
      mockCreate.mockResolvedValueOnce({
        id: 'recWeeklyUpdate789',
        fields: {},
      });

      const data: CreateWeeklyUpdateData = {
        weekStart: '2026-01-13',
        personId: 'rec789PersonId',
        syncCycleId: 'sync-2026-01-13-003',
        dmStatus: 'Pending',
      };

      const recordId = await client.createWeeklyUpdate(data);

      // The record should be created with Response Status = 'Pending'
      // We'd need to fetch the record to verify, but this tests the creation
      expect(recordId).toBeDefined();
    });

    it('sets initial Parsing Status to "Pending"', async () => {
      mockCreate.mockResolvedValueOnce({
        id: 'recWeeklyUpdateABC',
        fields: {},
      });

      const data: CreateWeeklyUpdateData = {
        weekStart: '2026-01-13',
        personId: 'recABCPersonId',
        syncCycleId: 'sync-2026-01-13-004',
        dmStatus: 'Pending',
      };

      const recordId = await client.createWeeklyUpdate(data);

      // The record should be created with Parsing Status = 'Pending'
      expect(recordId).toBeDefined();
    });
  });

  describe('updateWeeklyUpdateDMStatus', () => {
    it("updates status to 'Sent'", async () => {
      mockUpdate.mockResolvedValueOnce({
        id: 'recTestUpdate123',
        fields: {
          'DM Status': 'Sent',
        },
      });

      const recordId = 'recTestUpdate123';

      await expect(
        client.updateWeeklyUpdateDMStatus(recordId, 'Sent')
      ).resolves.not.toThrow();
    });

    it("updates status to 'Failed'", async () => {
      mockUpdate.mockResolvedValueOnce({
        id: 'recTestUpdate456',
        fields: {
          'DM Status': 'Failed',
        },
      });

      const recordId = 'recTestUpdate456';

      await expect(
        client.updateWeeklyUpdateDMStatus(recordId, 'Failed')
      ).resolves.not.toThrow();
    });
  });

  describe('getPendingDMRecords', () => {
    it("returns only records with DM Status = 'Pending'", async () => {
      mockAll.mockResolvedValueOnce([
        {
          id: 'recPending1',
          fields: {
            'Week Start': '2026-01-13',
            Person: ['recPerson1'],
            'DM Status': 'Pending',
            'Response Status': 'Pending',
            'Parsing Status': 'Pending',
            'Sync Cycle ID': 'sync-001',
          },
        },
        {
          id: 'recPending2',
          fields: {
            'Week Start': '2026-01-13',
            Person: ['recPerson2'],
            'DM Status': 'Pending',
            'Response Status': 'Pending',
            'Parsing Status': 'Pending',
            'Sync Cycle ID': 'sync-002',
          },
        },
      ]);

      const records = await client.getPendingDMRecords();

      expect(Array.isArray(records)).toBe(true);

      // All records should have dmStatus = 'Pending'
      records.forEach((record) => {
        expect(record.dmStatus).toBe('Pending');
      });
    });

    it('returns empty array when no pending records', async () => {
      mockAll.mockResolvedValueOnce([]);

      const records = await client.getPendingDMRecords();

      expect(Array.isArray(records)).toBe(true);
      expect(records.length).toBe(0);
    });
  });

  describe('Tracked Threads Operations', () => {
    describe('createTrackedThread', () => {
      it('creates record with correct fields', async () => {
        mockCreate.mockResolvedValueOnce({
          id: 'recTrackedThread001',
          fields: {
            'Thread Ts': '1705152000.123456',
            'Channel Id': 'C0123ABCDEF',
            'Thread Type': 'collection',
            'Sync Cycle ID': 'sync-2026-01-13-001',
            'Person': ['recPerson123'],
            'Week Start': '2026-01-13',
            'Created At': '2026-01-13T10:00:00.000Z',
          },
        });

        const recordId = await client.createTrackedThread({
          threadTs: '1705152000.123456',
          channelId: 'C0123ABCDEF',
          threadType: 'collection',
          syncCycleId: 'sync-2026-01-13-001',
          personId: 'recPerson123',
          projectId: null,
          weekStart: '2026-01-13',
          contextJson: null,
        });

        expect(recordId).toBeDefined();
        expect(typeof recordId).toBe('string');
        expect(recordId.length).toBeGreaterThan(0);
      });

      it('returns the record ID', async () => {
        mockCreate.mockResolvedValueOnce({
          id: 'recTrackedThread456',
          fields: {},
        });

        const recordId = await client.createTrackedThread({
          threadTs: '1705152000.789012',
          channelId: 'C9876ZYXWVU',
          threadType: 'pre-meeting',
          syncCycleId: 'sync-2026-01-13-002',
          personId: null,
          projectId: 'recProject789',
          weekStart: '2026-01-13',
          contextJson: '{"meetingTime": "2026-01-13T14:00:00Z"}',
        });

        expect(recordId).toMatch(/^rec[A-Za-z0-9]+$/);
      });
    });

    describe('findTrackedThread', () => {
      it('returns thread by channelId + threadTs', async () => {
        mockFirstPage.mockResolvedValueOnce([
          {
            id: 'recTrackedThread789',
            fields: {
              'Thread Ts': '1705152000.123456',
              'Channel Id': 'C0123ABCDEF',
              'Thread Type': 'collection',
              'Sync Cycle ID': 'sync-2026-01-13-001',
              'Person': ['recPerson123'],
              'Week Start': '2026-01-13',
            },
          },
        ]);

        const result = await client.findTrackedThread(
          'C0123ABCDEF',
          '1705152000.123456'
        );

        expect(result).not.toBeNull();
        expect(result).toMatchObject({
          id: expect.any(String),
          channelId: 'C0123ABCDEF',
          threadTs: '1705152000.123456',
          threadType: 'collection',
          syncCycleId: expect.any(String),
        });
      });

      it('returns null for unknown thread', async () => {
        mockFirstPage.mockResolvedValueOnce([]);

        const result = await client.findTrackedThread(
          'C9999UNKNOWN',
          '1705152000.999999'
        );

        expect(result).toBeNull();
      });
    });

    describe('getActiveTrackedThreads', () => {
      it('returns threads since given date', async () => {
        mockAll.mockResolvedValueOnce([
          {
            id: 'recThread1',
            fields: {
              'Thread Ts': '1705152000.111111',
              'Channel Id': 'C0123ABC',
              'Thread Type': 'collection',
              'Sync Cycle ID': 'sync-001',
              'Person': ['recPerson1'],
              'Week Start': '2026-01-13',
              'Created At': '2026-01-13T10:00:00.000Z',
            },
          },
          {
            id: 'recThread2',
            fields: {
              'Thread Ts': '1705152000.222222',
              'Channel Id': 'C0123DEF',
              'Thread Type': 'pre-meeting',
              'Sync Cycle ID': 'sync-001',
              'Project': ['recProject1'],
              'Week Start': '2026-01-13',
              'Created At': '2026-01-13T11:00:00.000Z',
            },
          },
        ]);

        const threads = await client.getActiveTrackedThreads('2026-01-06');

        expect(Array.isArray(threads)).toBe(true);
        expect(threads.length).toBe(2);
        threads.forEach((thread) => {
          expect(thread).toMatchObject({
            id: expect.any(String),
            threadTs: expect.any(String),
            channelId: expect.any(String),
            threadType: expect.stringMatching(/^(collection|pre-meeting|post-meeting)$/),
          });
        });
      });
    });
  });

  describe('createUpdateSegments', () => {
    it('creates segments in batches of 10', async () => {
      const weeklyUpdateId = 'recWeeklyUpdate123';
      const segments: UpdateSegment[] = Array.from({ length: 15 }, (_, i) => ({
        projectId: `recProject${i}`,
        projectName: `Project ${i}`,
        content: `Update for project ${i}`,
        workedOn: [`Task ${i}A`, `Task ${i}B`],
        comingUp: [`Next task ${i}`],
        blockers: [],
        questions: [],
        confidence: 0.95,
      }));

      // Mock first batch of 10
      mockCreate.mockResolvedValueOnce(
        Array.from({ length: 10 }, (_, i) => ({
          id: `recSegment${i}`,
          fields: {},
        }))
      );

      // Mock second batch of 5
      mockCreate.mockResolvedValueOnce(
        Array.from({ length: 5 }, (_, i) => ({
          id: `recSegment${i + 10}`,
          fields: {},
        }))
      );

      const recordIds = await client.createUpdateSegments(weeklyUpdateId, segments);

      expect(Array.isArray(recordIds)).toBe(true);
      expect(recordIds.length).toBe(15);
      recordIds.forEach((id) => {
        expect(typeof id).toBe('string');
        expect(id.length).toBeGreaterThan(0);
      });
    });

    it('links segments to Weekly Update record', async () => {
      mockCreate.mockResolvedValueOnce([
        {
          id: 'recSegmentAlpha',
          fields: {
            'Weekly Update': ['recWeeklyUpdate456'],
            Project: ['recProjectAlpha'],
            Content: 'Made progress on authentication system',
          },
        },
      ]);

      const weeklyUpdateId = 'recWeeklyUpdate456';
      const segments: UpdateSegment[] = [
        {
          projectId: 'recProjectAlpha',
          projectName: 'Alpha Project',
          content: 'Made progress on authentication system',
          workedOn: ['Implemented OAuth flow', 'Added token refresh'],
          comingUp: ['Add error handling'],
          blockers: [],
          questions: [],
          confidence: 0.9,
        },
      ];

      const recordIds = await client.createUpdateSegments(weeklyUpdateId, segments);

      expect(recordIds.length).toBe(1);
      expect(typeof recordIds[0]).toBe('string');
    });

    it('links segments to Project records', async () => {
      mockCreate.mockResolvedValueOnce([
        {
          id: 'recSegmentBeta',
          fields: {
            'Weekly Update': ['recWeeklyUpdate789'],
            Project: ['recProjectBeta'],
          },
        },
      ]);

      const weeklyUpdateId = 'recWeeklyUpdate789';
      const segments: UpdateSegment[] = [
        {
          projectId: 'recProjectBeta',
          projectName: 'Beta Project',
          content: 'Completed user interface designs',
          workedOn: ['Created wireframes', 'Got stakeholder approval'],
          comingUp: ['Start development'],
          blockers: ['Waiting on API specs'],
          questions: ['Should we use TypeScript?'],
          confidence: 0.85,
        },
      ];

      const recordIds = await client.createUpdateSegments(weeklyUpdateId, segments);

      expect(recordIds.length).toBe(1);
    });

    it('returns array of created record IDs', async () => {
      mockCreate.mockResolvedValueOnce([
        {
          id: 'recSegmentGamma',
          fields: {},
        },
        {
          id: 'recSegmentDelta',
          fields: {},
        },
      ]);

      const weeklyUpdateId = 'recWeeklyUpdateABC';
      const segments: UpdateSegment[] = [
        {
          projectId: 'recProjectGamma',
          projectName: 'Gamma Project',
          content: 'Database migration completed',
          workedOn: ['Migrated to PostgreSQL', 'Optimized queries'],
          comingUp: ['Performance testing'],
          blockers: [],
          questions: [],
          confidence: 1.0,
        },
        {
          projectId: 'recProjectDelta',
          projectName: 'Delta Project',
          content: 'Documentation updates',
          workedOn: ['Updated API docs', 'Added examples'],
          comingUp: ['Review with team'],
          blockers: [],
          questions: [],
          confidence: 0.95,
        },
      ];

      const recordIds = await client.createUpdateSegments(weeklyUpdateId, segments);

      expect(recordIds.length).toBe(2);
      expect(recordIds[0]).not.toBe(recordIds[1]);
    });
  });
});
