import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { WebClient } from '@slack/bolt';
import type { WeeklySyncAirtableClient, ProjectRecord, UpdateSegmentRecord } from '../airtable-client';
import type { ThreadTracker } from '../thread-tracker';
import type { Logger } from '../../logger';
import { exec } from 'child_process';
import { promisify } from 'util';

// Mock child_process.exec
vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

const mockExec = exec as unknown as ReturnType<typeof vi.fn>;
const execAsync = promisify(exec);

// Mock the Slack WebClient
const mockChatPostMessage = vi.fn();

const createMockSlackClient = (): WebClient => {
  return {
    chat: {
      postMessage: mockChatPostMessage,
    },
  } as unknown as WebClient;
};

// Mock the Airtable client
const mockGetActiveProjects = vi.fn();
const mockGetUpdateSegmentsByProject = vi.fn();

const createMockAirtableClient = (): WeeklySyncAirtableClient => {
  return {
    getActiveProjects: mockGetActiveProjects,
    getUpdateSegmentsByProject: mockGetUpdateSegmentsByProject,
  } as unknown as WeeklySyncAirtableClient;
};

// Mock the ThreadTracker
const mockRegisterThread = vi.fn();

const createMockThreadTracker = (): ThreadTracker => {
  return {
    registerThread: mockRegisterThread,
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

describe('SummaryGenerator', () => {
  let airtableClient: WeeklySyncAirtableClient;
  let threadTracker: ThreadTracker;
  let slackClient: WebClient;
  let logger: Logger;
  let summaryGenerator: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    airtableClient = createMockAirtableClient();
    threadTracker = createMockThreadTracker();
    slackClient = createMockSlackClient();
    logger = createMockLogger();

    // Default mock responses
    mockGetActiveProjects.mockResolvedValue([]);
    mockGetUpdateSegmentsByProject.mockResolvedValue([]);
    mockChatPostMessage.mockResolvedValue({
      ok: true,
      ts: '1705327200.123456',
    });
    mockExec.mockImplementation((cmd, opts, callback) => {
      callback(null, { stdout: 'Generated summary content', stderr: '' });
    });

    // Import SummaryGenerator dynamically (will fail until implementation exists)
    const { SummaryGenerator } = await import('../summary-generator');
    summaryGenerator = new SummaryGenerator({
      airtableClient,
      threadTracker,
      slackClient,
      logger,
      workingDirectory: '/Users/test/pm-assistant/claude-code-slack-bot',
    });
  });

  describe('generatePreMeetingSummaries', () => {
    it('processes all active projects', async () => {
      const projects: ProjectRecord[] = [
        {
          id: 'recProject1',
          name: 'Long Beach Airport',
          status: 'Active',
          slackChannelId: 'C001PROJECT',
          teamMemberIds: ['recPerson1'],
          projectLeadIds: ['recPerson2'],
        },
        {
          id: 'recProject2',
          name: 'Marina Development',
          status: 'Active',
          slackChannelId: 'C002PROJECT',
          teamMemberIds: ['recPerson3'],
          projectLeadIds: [],
        },
        {
          id: 'recProject3',
          name: 'Downtown Revitalization',
          status: 'Active',
          slackChannelId: 'C003PROJECT',
          teamMemberIds: ['recPerson1', 'recPerson3'],
          projectLeadIds: ['recPerson4'],
        },
      ];

      mockGetActiveProjects.mockResolvedValueOnce(projects);

      // Mock update segments for all projects
      const updateSegmentsProject1: UpdateSegmentRecord[] = [
        {
          id: 'recSegment1',
          weeklyUpdateId: 'recUpdate1',
          projectId: 'recProject1',
          personId: 'recPerson1',
          weekStart: '2026-01-13',
          content: 'Completed terminal analysis',
          keyAccomplishments: 'Finished phase 1 design',
          blockers: null,
          nextSteps: 'Client presentation Friday',
        },
      ];

      const updateSegmentsProject2: UpdateSegmentRecord[] = [
        {
          id: 'recSegment2',
          weeklyUpdateId: 'recUpdate2',
          projectId: 'recProject2',
          personId: 'recPerson3',
          weekStart: '2026-01-13',
          content: 'Updated marina plans',
          keyAccomplishments: 'Completed stakeholder meetings',
          blockers: 'Waiting on environmental permits',
          nextSteps: 'Submit revised plans',
        },
      ];

      const updateSegmentsProject3: UpdateSegmentRecord[] = [
        {
          id: 'recSegment3',
          weeklyUpdateId: 'recUpdate3',
          projectId: 'recProject3',
          personId: 'recPerson1',
          weekStart: '2026-01-13',
          content: 'Surveyed downtown area',
          keyAccomplishments: 'Identified key locations',
          blockers: null,
          nextSteps: 'Draft initial proposal',
        },
      ];

      mockGetUpdateSegmentsByProject
        .mockResolvedValueOnce(updateSegmentsProject1)
        .mockResolvedValueOnce(updateSegmentsProject2)
        .mockResolvedValueOnce(updateSegmentsProject3);

      const result = await summaryGenerator.generatePreMeetingSummaries(
        '2026-01-13',
        'sync-2026-01-13-001'
      );

      expect(result.posted).toBe(3);
      expect(result.skipped).toBe(0);
      expect(result.failed).toBe(0);
      expect(mockChatPostMessage).toHaveBeenCalledTimes(3);
    });

    it('skips projects with no updates for the week', async () => {
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
          teamMemberIds: ['recPerson2'],
          projectLeadIds: [],
        },
      ];

      mockGetActiveProjects.mockResolvedValueOnce(projects);

      // Only project1 has updates
      mockGetUpdateSegmentsByProject
        .mockResolvedValueOnce([
          {
            id: 'recSegment1',
            weeklyUpdateId: 'recUpdate1',
            projectId: 'recProject1',
            personId: 'recPerson1',
            weekStart: '2026-01-13',
            content: 'Completed work',
            keyAccomplishments: 'Finished phase 1',
            blockers: null,
            nextSteps: 'Start phase 2',
          },
        ])
        .mockResolvedValueOnce([]); // No updates for project2

      const result = await summaryGenerator.generatePreMeetingSummaries(
        '2026-01-13',
        'sync-2026-01-13-001'
      );

      expect(result.posted).toBe(1);
      expect(result.skipped).toBe(1);
      expect(result.failed).toBe(0);
      expect(mockChatPostMessage).toHaveBeenCalledTimes(1);
    });

    it('calls claude -p with correct prompt structure', async () => {
      const projects: ProjectRecord[] = [
        {
          id: 'recProject1',
          name: 'Long Beach Airport',
          status: 'Active',
          slackChannelId: 'C001PROJECT',
          teamMemberIds: ['recPerson1'],
          projectLeadIds: [],
        },
      ];

      mockGetActiveProjects.mockResolvedValueOnce(projects);

      const updateSegments: UpdateSegmentRecord[] = [
        {
          id: 'recSegment1',
          weeklyUpdateId: 'recUpdate1',
          projectId: 'recProject1',
          personId: 'recPerson1',
          personName: 'Alice Johnson',
          weekStart: '2026-01-13',
          content: 'Completed terminal analysis',
          keyAccomplishments: 'Finished phase 1 design',
          blockers: null,
          nextSteps: 'Client presentation Friday',
        },
      ];

      mockGetUpdateSegmentsByProject.mockResolvedValueOnce(updateSegments);

      await summaryGenerator.generatePreMeetingSummaries(
        '2026-01-13',
        'sync-2026-01-13-001'
      );

      // Verify exec was called with claude -p
      expect(mockExec).toHaveBeenCalled();
      const execCall = mockExec.mock.calls[0];
      const command = execCall[0];

      expect(command).toContain('claude -p');
      expect(command).toContain('Long Beach Airport');
      expect(command).toContain('2026-01-13');
      expect(command).toContain('Alice Johnson');
    });

    it('posts summary to project Slack channel', async () => {
      const projects: ProjectRecord[] = [
        {
          id: 'recProject1',
          name: 'Long Beach Airport',
          status: 'Active',
          slackChannelId: 'C001AIRPORT',
          teamMemberIds: ['recPerson1'],
          projectLeadIds: [],
        },
      ];

      mockGetActiveProjects.mockResolvedValueOnce(projects);

      mockGetUpdateSegmentsByProject.mockResolvedValueOnce([
        {
          id: 'recSegment1',
          weeklyUpdateId: 'recUpdate1',
          projectId: 'recProject1',
          personId: 'recPerson1',
          weekStart: '2026-01-13',
          content: 'Completed work',
          keyAccomplishments: 'Finished phase 1',
          blockers: null,
          nextSteps: 'Start phase 2',
        },
      ]);

      mockExec.mockImplementationOnce((cmd, opts, callback) => {
        callback(null, {
          stdout: ':calendar: Pre-Meeting Summary for Long Beach Airport',
          stderr: '',
        });
      });

      await summaryGenerator.generatePreMeetingSummaries(
        '2026-01-13',
        'sync-2026-01-13-001'
      );

      expect(mockChatPostMessage).toHaveBeenCalledWith({
        channel: 'C001AIRPORT',
        text: expect.stringContaining('Long Beach Airport'),
      });
    });

    it('registers posted thread for tracking', async () => {
      const projects: ProjectRecord[] = [
        {
          id: 'recProject1',
          name: 'Long Beach Airport',
          status: 'Active',
          slackChannelId: 'C001PROJECT',
          teamMemberIds: ['recPerson1'],
          projectLeadIds: [],
        },
      ];

      mockGetActiveProjects.mockResolvedValueOnce(projects);

      mockGetUpdateSegmentsByProject.mockResolvedValueOnce([
        {
          id: 'recSegment1',
          weeklyUpdateId: 'recUpdate1',
          projectId: 'recProject1',
          personId: 'recPerson1',
          weekStart: '2026-01-13',
          content: 'Completed work',
          keyAccomplishments: 'Finished phase 1',
          blockers: null,
          nextSteps: 'Start phase 2',
        },
      ]);

      await summaryGenerator.generatePreMeetingSummaries(
        '2026-01-13',
        'sync-2026-01-13-001'
      );

      expect(mockRegisterThread).toHaveBeenCalledWith(
        {
          channelId: 'C001PROJECT',
          threadType: 'pre-meeting',
          syncCycleId: 'sync-2026-01-13-001',
          projectId: 'recProject1',
          weekStart: '2026-01-13',
        },
        '1705327200.123456'
      );
    });

    it('handles projects without Slack channel gracefully', async () => {
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
          slackChannelId: null, // No Slack channel
          teamMemberIds: ['recPerson2'],
          projectLeadIds: [],
        },
      ];

      mockGetActiveProjects.mockResolvedValueOnce(projects);

      // Both have updates
      mockGetUpdateSegmentsByProject
        .mockResolvedValueOnce([
          {
            id: 'recSegment1',
            weeklyUpdateId: 'recUpdate1',
            projectId: 'recProject1',
            personId: 'recPerson1',
            weekStart: '2026-01-13',
            content: 'Work done',
            keyAccomplishments: 'Phase 1',
            blockers: null,
            nextSteps: 'Phase 2',
          },
        ])
        .mockResolvedValueOnce([
          {
            id: 'recSegment2',
            weeklyUpdateId: 'recUpdate2',
            projectId: 'recProject2',
            personId: 'recPerson2',
            weekStart: '2026-01-13',
            content: 'Work done',
            keyAccomplishments: 'Phase 1',
            blockers: null,
            nextSteps: 'Phase 2',
          },
        ]);

      const result = await summaryGenerator.generatePreMeetingSummaries(
        '2026-01-13',
        'sync-2026-01-13-001'
      );

      expect(result.posted).toBe(1); // Only project1 posted
      expect(result.skipped).toBe(1); // Project2 skipped (no channel)
      expect(result.failed).toBe(0);
      expect(mockChatPostMessage).toHaveBeenCalledTimes(1);
    });

    it('returns error details for failed posts', async () => {
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
          teamMemberIds: ['recPerson2'],
          projectLeadIds: [],
        },
      ];

      mockGetActiveProjects.mockResolvedValueOnce(projects);

      // Both have updates
      mockGetUpdateSegmentsByProject
        .mockResolvedValueOnce([
          {
            id: 'recSegment1',
            weeklyUpdateId: 'recUpdate1',
            projectId: 'recProject1',
            personId: 'recPerson1',
            weekStart: '2026-01-13',
            content: 'Work',
            keyAccomplishments: 'Done',
            blockers: null,
            nextSteps: 'Next',
          },
        ])
        .mockResolvedValueOnce([
          {
            id: 'recSegment2',
            weeklyUpdateId: 'recUpdate2',
            projectId: 'recProject2',
            personId: 'recPerson2',
            weekStart: '2026-01-13',
            content: 'Work',
            keyAccomplishments: 'Done',
            blockers: null,
            nextSteps: 'Next',
          },
        ]);

      // First post succeeds, second fails
      mockChatPostMessage
        .mockResolvedValueOnce({
          ok: true,
          ts: '1705327200.123456',
        })
        .mockRejectedValueOnce(new Error('Channel not found'));

      const result = await summaryGenerator.generatePreMeetingSummaries(
        '2026-01-13',
        'sync-2026-01-13-001'
      );

      expect(result.posted).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.results).toHaveLength(2);

      const failedResult = result.results.find((r) => r.projectId === 'recProject2');
      expect(failedResult?.error).toContain('Channel not found');
    });
  });

  describe('generateProjectSummary', () => {
    it('fetches update segments for the project', async () => {
      const updateSegments: UpdateSegmentRecord[] = [
        {
          id: 'recSegment1',
          weeklyUpdateId: 'recUpdate1',
          projectId: 'recProject1',
          personId: 'recPerson1',
          personName: 'Alice Johnson',
          weekStart: '2026-01-13',
          content: 'Completed work',
          keyAccomplishments: 'Phase 1 done',
          blockers: null,
          nextSteps: 'Phase 2',
        },
        {
          id: 'recSegment2',
          weeklyUpdateId: 'recUpdate2',
          projectId: 'recProject1',
          personId: 'recPerson2',
          personName: 'Bob Martinez',
          weekStart: '2026-01-13',
          content: 'Updated designs',
          keyAccomplishments: 'Finalized blueprints',
          blockers: 'Need client approval',
          nextSteps: 'Schedule review',
        },
      ];

      mockGetUpdateSegmentsByProject.mockResolvedValueOnce(updateSegments);

      await summaryGenerator.generateProjectSummary(
        'recProject1',
        '2026-01-13',
        'sync-2026-01-13-001'
      );

      expect(mockGetUpdateSegmentsByProject).toHaveBeenCalledWith(
        'recProject1',
        '2026-01-13'
      );
    });

    it('builds prompt with all team member updates', async () => {
      const updateSegments: UpdateSegmentRecord[] = [
        {
          id: 'recSegment1',
          weeklyUpdateId: 'recUpdate1',
          projectId: 'recProject1',
          personId: 'recPerson1',
          personName: 'Alice Johnson',
          weekStart: '2026-01-13',
          content: 'Completed terminal analysis',
          keyAccomplishments: 'Phase 1 design complete',
          blockers: null,
          nextSteps: 'Client presentation',
        },
        {
          id: 'recSegment2',
          weeklyUpdateId: 'recUpdate2',
          projectId: 'recProject1',
          personId: 'recPerson2',
          personName: 'Bob Martinez',
          weekStart: '2026-01-13',
          content: 'Updated blueprints',
          keyAccomplishments: 'Finalized structural plans',
          blockers: 'Waiting for environmental clearance',
          nextSteps: 'Submit revised plans',
        },
      ];

      mockGetUpdateSegmentsByProject.mockResolvedValueOnce(updateSegments);

      await summaryGenerator.generateProjectSummary(
        'recProject1',
        '2026-01-13',
        'sync-2026-01-13-001'
      );

      // Verify exec was called with all team members
      expect(mockExec).toHaveBeenCalled();
      const execCall = mockExec.mock.calls[0];
      const command = execCall[0];

      expect(command).toContain('Alice Johnson');
      expect(command).toContain('Bob Martinez');
      expect(command).toContain('terminal analysis');
      expect(command).toContain('blueprints');
    });

    it('returns success with generated summary', async () => {
      const updateSegments: UpdateSegmentRecord[] = [
        {
          id: 'recSegment1',
          weeklyUpdateId: 'recUpdate1',
          projectId: 'recProject1',
          personId: 'recPerson1',
          weekStart: '2026-01-13',
          content: 'Work done',
          keyAccomplishments: 'Completed tasks',
          blockers: null,
          nextSteps: 'Continue work',
        },
      ];

      mockGetUpdateSegmentsByProject.mockResolvedValueOnce(updateSegments);

      mockExec.mockImplementationOnce((cmd, opts, callback) => {
        callback(null, {
          stdout: ':calendar: Generated pre-meeting summary content',
          stderr: '',
        });
      });

      const result = await summaryGenerator.generateProjectSummary(
        'recProject1',
        '2026-01-13',
        'sync-2026-01-13-001'
      );

      expect(result.success).toBe(true);
      expect(result.summary).toContain('Generated pre-meeting summary');
      expect(result.error).toBeUndefined();
    });

    it('returns error when claude -p fails', async () => {
      const updateSegments: UpdateSegmentRecord[] = [
        {
          id: 'recSegment1',
          weeklyUpdateId: 'recUpdate1',
          projectId: 'recProject1',
          personId: 'recPerson1',
          weekStart: '2026-01-13',
          content: 'Work',
          keyAccomplishments: 'Done',
          blockers: null,
          nextSteps: 'Next',
        },
      ];

      mockGetUpdateSegmentsByProject.mockResolvedValueOnce(updateSegments);

      mockExec.mockImplementationOnce((cmd, opts, callback) => {
        callback(new Error('Claude CLI not found'), null);
      });

      const result = await summaryGenerator.generateProjectSummary(
        'recProject1',
        '2026-01-13',
        'sync-2026-01-13-001'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Claude CLI not found');
      expect(result.summary).toBeUndefined();
    });

    it('returns error when project has no updates', async () => {
      mockGetUpdateSegmentsByProject.mockResolvedValueOnce([]);

      const result = await summaryGenerator.generateProjectSummary(
        'recProject1',
        '2026-01-13',
        'sync-2026-01-13-001'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('No updates');
      expect(mockExec).not.toHaveBeenCalled();
    });
  });
});
