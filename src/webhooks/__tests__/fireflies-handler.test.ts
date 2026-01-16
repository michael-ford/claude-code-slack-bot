import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response } from 'express';
import type { WebClient } from '@slack/bolt';
import type { WeeklySyncAirtableClient, ProjectRecord } from '../../weekly-sync/airtable-client';
import type { ThreadTracker } from '../../weekly-sync/thread-tracker';
import type { Logger } from '../../logger';
import { exec } from 'child_process';
import { createHmac } from 'crypto';

// Mock child_process.exec
vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

const mockExec = exec as unknown as ReturnType<typeof vi.fn>;

// Helper to generate valid HMAC-SHA256 signature
function generateSignature(payload: string, secret: string): string {
  const hmac = createHmac('sha256', secret);
  hmac.update(payload);
  return hmac.digest('hex');
}

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

const createMockAirtableClient = (): WeeklySyncAirtableClient => {
  return {
    getActiveProjects: mockGetActiveProjects,
  } as unknown as WeeklySyncAirtableClient;
};

// Mock the ThreadTracker
const mockRegisterThread = vi.fn();
const mockFindThreadBySyncCycle = vi.fn();
const mockLoadActiveThreads = vi.fn();

const createMockThreadTracker = (): ThreadTracker => {
  return {
    registerThread: mockRegisterThread,
    findThreadBySyncCycle: mockFindThreadBySyncCycle,
    loadActiveThreads: mockLoadActiveThreads,
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

// Mock Express Request/Response
const createMockRequest = (body: any, headers: Record<string, string> = {}): Request => {
  return {
    body,
    headers,
  } as Request;
};

const createMockResponse = (): Response => {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
  return res as unknown as Response;
};

describe('FirefliesHandler', () => {
  let airtableClient: WeeklySyncAirtableClient;
  let threadTracker: ThreadTracker;
  let slackClient: WebClient;
  let logger: Logger;
  let firefliesHandler: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    airtableClient = createMockAirtableClient();
    threadTracker = createMockThreadTracker();
    slackClient = createMockSlackClient();
    logger = createMockLogger();

    // Default mock responses
    mockGetActiveProjects.mockResolvedValue([]);
    mockFindThreadBySyncCycle.mockResolvedValue(null);
    mockLoadActiveThreads.mockResolvedValue(undefined);
    mockChatPostMessage.mockResolvedValue({
      ok: true,
      ts: '1705327200.123456',
    });
    mockExec.mockImplementation((cmd, opts, callback) => {
      callback(null, { stdout: 'Generated content', stderr: '' });
    });

    // Import FirefliesHandler dynamically (will fail until implementation exists)
    const { FirefliesHandler } = await import('../fireflies-handler');
    firefliesHandler = new FirefliesHandler({
      airtableClient,
      threadTracker,
      slackClient,
      logger,
      workingDirectory: '/Users/test/pm-assistant/claude-code-slack-bot',
    });
  });

  describe('webhook signature verification', () => {
    it('verifies webhook signature when secret configured', async () => {
      const { FirefliesHandler } = await import('../fireflies-handler');
      const webhookSecret = 'test-secret-key';
      const handlerWithSecret = new FirefliesHandler({
        airtableClient,
        threadTracker,
        slackClient,
        logger,
        workingDirectory: '/Users/test/pm-assistant/claude-code-slack-bot',
        webhookSecret,
      });

      const body = {
        meetingId: 'ff-meeting-123',
        eventType: 'Transcription completed',
      };
      const bodyStr = JSON.stringify(body);
      const validSignature = generateSignature(bodyStr, webhookSecret);

      const req = createMockRequest(body, {
        'x-fireflies-signature': validSignature,
      });
      const res = createMockResponse();

      // Mock transcript fetch
      mockExec.mockImplementationOnce((cmd, opts, callback) => {
        callback(null, {
          stdout: JSON.stringify({
            success: true,
            transcript: {
              id: 'ff-meeting-123',
              title: '[Long Beach Airport] Weekly Sync',
              date: '2026-01-13',
              duration: 1800,
              transcript_url: 'https://fireflies.ai/view/meeting123',
              participants: ['Alice Johnson', 'Bob Martinez'],
              summary: {
                action_items: 'Review blueprints',
                gist: 'Project status update',
                overview: 'Weekly sync meeting',
                topics_discussed: ['Terminal design', 'Timeline'],
              },
              sentences: [],
            },
          }),
          stderr: '',
        });
      });

      // Mock claude -p for notes generation
      mockExec.mockImplementationOnce((cmd, opts, callback) => {
        callback(null, {
          stdout: ':memo: **Post-Meeting Notes**',
          stderr: '',
        });
      });

      // Mock project match
      mockGetActiveProjects.mockResolvedValueOnce([
        {
          id: 'recProject1',
          name: 'Long Beach Airport',
          status: 'Active',
          slackChannelId: 'C001PROJECT',
          teamMemberIds: [],
          projectLeadIds: [],
        },
      ]);

      await handlerWithSecret.handleWebhook(req, res);

      // Should verify signature and proceed (not return 401)
      expect(res.status).not.toHaveBeenCalledWith(401);
    });

    it('returns 401 for invalid signature', async () => {
      const { FirefliesHandler } = await import('../fireflies-handler');
      const handlerWithSecret = new FirefliesHandler({
        airtableClient,
        threadTracker,
        slackClient,
        logger,
        workingDirectory: '/Users/test/pm-assistant/claude-code-slack-bot',
        webhookSecret: 'test-secret-key',
      });

      const req = createMockRequest(
        {
          meetingId: 'ff-meeting-123',
          eventType: 'Transcription completed',
        },
        {
          'x-fireflies-signature': 'invalid-signature',
        }
      );
      const res = createMockResponse();

      await handlerWithSecret.handleWebhook(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('Invalid signature') })
      );
    });
  });

  describe('handleWebhook', () => {
    it('returns 200 and processes valid webhook', async () => {
      const req = createMockRequest({
        meetingId: 'ff-meeting-abc123',
        eventType: 'Transcription completed',
      });
      const res = createMockResponse();

      // Mock transcript fetch
      mockExec.mockImplementationOnce((cmd, opts, callback) => {
        callback(null, {
          stdout: JSON.stringify({
            success: true,
            transcript: {
              id: 'ff-meeting-abc123',
              title: 'Marina Development - Weekly Sync',
              date: '2026-01-13',
              duration: 1800,
              transcript_url: 'https://fireflies.ai/view/meeting-abc123',
              participants: ['Carol Davis', 'David Lee'],
              summary: {
                action_items: 'Submit environmental permits',
                gist: 'Progress update on marina project',
                overview: 'Weekly sync meeting',
                topics_discussed: ['Permit status', 'Design updates'],
              },
              sentences: [],
            },
          }),
          stderr: '',
        });
      });

      // Mock project match
      mockGetActiveProjects.mockResolvedValueOnce([
        {
          id: 'recProject2',
          name: 'Marina Development',
          status: 'Active',
          slackChannelId: 'C002PROJECT',
          teamMemberIds: [],
          projectLeadIds: [],
        },
      ]);

      await firefliesHandler.handleWebhook(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          projectId: 'recProject2',
        })
      );
    });

    it('handles missing meetingId', async () => {
      const req = createMockRequest({
        eventType: 'Transcription completed',
      });
      const res = createMockResponse();

      await firefliesHandler.handleWebhook(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('meetingId'),
        })
      );
    });

    it('handles non-transcription events gracefully', async () => {
      const req = createMockRequest({
        meetingId: 'ff-meeting-xyz',
        eventType: 'Meeting started',
      });
      const res = createMockResponse();

      await firefliesHandler.handleWebhook(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: expect.stringContaining('Ignoring'),
        })
      );
    });
  });

  describe('processTranscription', () => {
    it('fetches transcript via get_fireflies_transcript script', async () => {
      const meetingId = 'ff-meeting-test123';

      mockExec.mockImplementationOnce((cmd, opts, callback) => {
        callback(null, {
          stdout: JSON.stringify({
            success: true,
            transcript: {
              id: meetingId,
              title: '[Downtown Revitalization] Weekly Sync',
              date: '2026-01-13',
              duration: 2400,
              transcript_url: 'https://fireflies.ai/view/test123',
              participants: ['Emily Chen', 'Frank Wilson'],
              summary: {
                action_items: 'Draft initial proposal',
                gist: 'Planning phase discussion',
                overview: 'Weekly project sync',
                topics_discussed: ['Site survey', 'Stakeholder feedback'],
              },
              sentences: [],
            },
          }),
          stderr: '',
        });
      });

      mockGetActiveProjects.mockResolvedValueOnce([
        {
          id: 'recProject3',
          name: 'Downtown Revitalization',
          status: 'Active',
          slackChannelId: 'C003PROJECT',
          teamMemberIds: [],
          projectLeadIds: [],
        },
      ]);

      const result = await firefliesHandler.processTranscription(meetingId);

      expect(result.success).toBe(true);
      expect(mockExec).toHaveBeenCalled();
      const execCall = mockExec.mock.calls[0];
      const command = execCall[0];

      // Verify correct script called
      expect(command).toContain('npm run get-transcript');
      expect(command).toContain(meetingId);
    });

    it('generates post-meeting notes via claude -p', async () => {
      const meetingId = 'ff-meeting-notes-test';

      // First call: get transcript
      mockExec.mockImplementationOnce((cmd, opts, callback) => {
        callback(null, {
          stdout: JSON.stringify({
            success: true,
            transcript: {
              id: meetingId,
              title: 'Long Beach Airport - Weekly Sync',
              date: '2026-01-13',
              duration: 1800,
              transcript_url: 'https://fireflies.ai/view/notes-test',
              participants: ['Alice Johnson', 'Bob Martinez'],
              summary: {
                action_items: 'Client presentation Friday',
                gist: 'Design review and next steps',
                overview: 'Weekly sync meeting',
                topics_discussed: ['Terminal design', 'Client feedback'],
              },
              sentences: [
                {
                  speaker_name: 'Alice Johnson',
                  text: 'The terminal design is finalized.',
                  start_time: 120,
                  end_time: 125,
                },
              ],
            },
          }),
          stderr: '',
        });
      });

      // Second call: claude -p for post-meeting notes
      mockExec.mockImplementationOnce((cmd, opts, callback) => {
        callback(null, {
          stdout: ':memo: **Post-Meeting Notes: Long Beach Airport Weekly Sync**',
          stderr: '',
        });
      });

      mockGetActiveProjects.mockResolvedValueOnce([
        {
          id: 'recProject1',
          name: 'Long Beach Airport',
          status: 'Active',
          slackChannelId: 'C001PROJECT',
          teamMemberIds: [],
          projectLeadIds: [],
        },
      ]);

      const result = await firefliesHandler.processTranscription(meetingId);

      expect(result.success).toBe(true);

      // Verify claude -p was called
      const claudeCalls = mockExec.mock.calls.filter((call) =>
        call[0].includes('claude -p')
      );
      expect(claudeCalls.length).toBeGreaterThan(0);
    });

    it('posts as reply to pre-meeting thread if exists', async () => {
      const meetingId = 'ff-meeting-reply-test';

      mockExec
        .mockImplementationOnce((cmd, opts, callback) => {
          // Get transcript
          callback(null, {
            stdout: JSON.stringify({
              success: true,
              transcript: {
                id: meetingId,
                title: 'Marina Development - Weekly Sync',
                date: '2026-01-13',
                duration: 1800,
                transcript_url: 'https://fireflies.ai/view/reply-test',
                participants: ['Carol Davis'],
                summary: {
                  action_items: 'Submit permits',
                  gist: 'Marina progress',
                  overview: 'Weekly sync',
                  topics_discussed: ['Permits'],
                },
                sentences: [],
              },
            }),
            stderr: '',
          });
        })
        .mockImplementationOnce((cmd, opts, callback) => {
          // Generate notes
          callback(null, {
            stdout: ':memo: **Post-Meeting Notes**',
            stderr: '',
          });
        });

      mockGetActiveProjects.mockResolvedValueOnce([
        {
          id: 'recProject2',
          name: 'Marina Development',
          status: 'Active',
          slackChannelId: 'C002PROJECT',
          teamMemberIds: [],
          projectLeadIds: [],
        },
      ]);

      // Mock pre-meeting thread exists
      mockFindThreadBySyncCycle.mockResolvedValueOnce({
        threadTs: '1705240000.111111',
        channelId: 'C002PROJECT',
        threadType: 'pre-meeting',
        syncCycleId: 'sync-2026-01-13-001',
        projectId: 'recProject2',
        weekStart: '2026-01-13',
      });

      const result = await firefliesHandler.processTranscription(meetingId);

      expect(result.success).toBe(true);
      expect(mockChatPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'C002PROJECT',
          thread_ts: '1705240000.111111', // Reply to pre-meeting thread
        })
      );
    });

    it('posts as new message if no pre-meeting thread', async () => {
      const meetingId = 'ff-meeting-new-test';

      mockExec
        .mockImplementationOnce((cmd, opts, callback) => {
          callback(null, {
            stdout: JSON.stringify({
              success: true,
              transcript: {
                id: meetingId,
                title: 'Downtown Revitalization - Weekly Sync',
                date: '2026-01-13',
                duration: 1800,
                transcript_url: 'https://fireflies.ai/view/new-test',
                participants: ['Emily Chen'],
                summary: {
                  action_items: 'Draft proposal',
                  gist: 'Planning',
                  overview: 'Weekly sync',
                  topics_discussed: ['Survey'],
                },
                sentences: [],
              },
            }),
            stderr: '',
          });
        })
        .mockImplementationOnce((cmd, opts, callback) => {
          callback(null, {
            stdout: ':memo: **Post-Meeting Notes**',
            stderr: '',
          });
        });

      mockGetActiveProjects.mockResolvedValueOnce([
        {
          id: 'recProject3',
          name: 'Downtown Revitalization',
          status: 'Active',
          slackChannelId: 'C003PROJECT',
          teamMemberIds: [],
          projectLeadIds: [],
        },
      ]);

      // No pre-meeting thread
      mockFindThreadBySyncCycle.mockResolvedValueOnce(null);

      const result = await firefliesHandler.processTranscription(meetingId);

      expect(result.success).toBe(true);
      expect(mockChatPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'C003PROJECT',
          thread_ts: undefined, // New message, not a reply
        })
      );
    });

    it('registers posted thread for tracking', async () => {
      const meetingId = 'ff-meeting-register-test';

      mockExec
        .mockImplementationOnce((cmd, opts, callback) => {
          callback(null, {
            stdout: JSON.stringify({
              success: true,
              transcript: {
                id: meetingId,
                title: '[Long Beach Airport] Weekly Sync',
                date: '2026-01-13',
                duration: 1800,
                transcript_url: 'https://fireflies.ai/view/register-test',
                participants: ['Alice Johnson'],
                summary: {
                  action_items: 'Presentation',
                  gist: 'Design review',
                  overview: 'Weekly sync',
                  topics_discussed: ['Design'],
                },
                sentences: [],
              },
            }),
            stderr: '',
          });
        })
        .mockImplementationOnce((cmd, opts, callback) => {
          callback(null, {
            stdout: ':memo: **Post-Meeting Notes**',
            stderr: '',
          });
        });

      mockGetActiveProjects.mockResolvedValueOnce([
        {
          id: 'recProject1',
          name: 'Long Beach Airport',
          status: 'Active',
          slackChannelId: 'C001PROJECT',
          teamMemberIds: [],
          projectLeadIds: [],
        },
      ]);

      mockFindThreadBySyncCycle.mockResolvedValueOnce(null);

      const result = await firefliesHandler.processTranscription(meetingId);

      expect(result.success).toBe(true);
      expect(mockRegisterThread).toHaveBeenCalledWith(
        expect.objectContaining({
          channelId: 'C001PROJECT',
          threadType: 'post-meeting',
          projectId: 'recProject1',
        }),
        '1705327200.123456' // The mocked timestamp from Slack post
      );
    });

    it('handles missing project gracefully', async () => {
      const meetingId = 'ff-meeting-no-project';

      mockExec.mockImplementationOnce((cmd, opts, callback) => {
        callback(null, {
          stdout: JSON.stringify({
            success: true,
            transcript: {
              id: meetingId,
              title: 'Unknown Project - Weekly Sync',
              date: '2026-01-13',
              duration: 1800,
              transcript_url: 'https://fireflies.ai/view/no-project',
              participants: ['John Doe'],
              summary: {
                action_items: 'TBD',
                gist: 'Meeting',
                overview: 'Sync',
                topics_discussed: ['Updates'],
              },
              sentences: [],
            },
          }),
          stderr: '',
        });
      });

      // No matching project
      mockGetActiveProjects.mockResolvedValueOnce([
        {
          id: 'recProject1',
          name: 'Long Beach Airport',
          status: 'Active',
          slackChannelId: 'C001PROJECT',
          teamMemberIds: [],
          projectLeadIds: [],
        },
      ]);

      const result = await firefliesHandler.processTranscription(meetingId);

      expect(result.success).toBe(false);
      expect(result.error).toContain('project');
      expect(mockChatPostMessage).not.toHaveBeenCalled();
    });

    it('handles transcript fetch failure gracefully', async () => {
      const meetingId = 'ff-meeting-fetch-fail';

      mockExec.mockImplementationOnce((cmd, opts, callback) => {
        callback(new Error('Fireflies API unavailable'), null);
      });

      const result = await firefliesHandler.processTranscription(meetingId);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Fireflies API unavailable');
      expect(mockChatPostMessage).not.toHaveBeenCalled();
    });
  });

  describe('matchMeetingToProject', () => {
    beforeEach(() => {
      mockGetActiveProjects.mockResolvedValue([
        {
          id: 'recProject1',
          name: 'Long Beach Airport',
          status: 'Active',
          slackChannelId: 'C001PROJECT',
          teamMemberIds: [],
          projectLeadIds: [],
        },
        {
          id: 'recProject2',
          name: 'Marina Development',
          status: 'Active',
          slackChannelId: 'C002PROJECT',
          teamMemberIds: [],
          projectLeadIds: [],
        },
        {
          id: 'recProject3',
          name: 'Downtown Revitalization',
          status: 'Active',
          slackChannelId: 'C003PROJECT',
          teamMemberIds: [],
          projectLeadIds: [],
        },
      ]);
    });

    it('matches [Project Name] Weekly Sync pattern', async () => {
      const project = await firefliesHandler.matchMeetingToProject(
        '[Long Beach Airport] Weekly Sync'
      );

      expect(project).not.toBeNull();
      expect(project?.name).toBe('Long Beach Airport');
      expect(project?.id).toBe('recProject1');
    });

    it('matches Project Name - Weekly Sync pattern', async () => {
      const project = await firefliesHandler.matchMeetingToProject(
        'Marina Development - Weekly Sync'
      );

      expect(project).not.toBeNull();
      expect(project?.name).toBe('Marina Development');
      expect(project?.id).toBe('recProject2');
    });

    it('matches Project Name: Weekly Sync pattern', async () => {
      const project = await firefliesHandler.matchMeetingToProject(
        'Downtown Revitalization: Weekly Sync'
      );

      expect(project).not.toBeNull();
      expect(project?.name).toBe('Downtown Revitalization');
      expect(project?.id).toBe('recProject3');
    });

    it('returns null for non-matching title', async () => {
      const project = await firefliesHandler.matchMeetingToProject(
        'Random Team Meeting'
      );

      expect(project).toBeNull();
    });

    it('returns null when project name not found in Airtable', async () => {
      const project = await firefliesHandler.matchMeetingToProject(
        '[Nonexistent Project] Weekly Sync'
      );

      expect(project).toBeNull();
    });

    it('handles case-insensitive project name matching', async () => {
      const project = await firefliesHandler.matchMeetingToProject(
        '[long beach airport] Weekly Sync'
      );

      expect(project).not.toBeNull();
      expect(project?.name).toBe('Long Beach Airport');
    });
  });

  describe('error handling', () => {
    it('handles Slack API errors gracefully', async () => {
      const meetingId = 'ff-meeting-slack-error';

      mockExec
        .mockImplementationOnce((cmd, opts, callback) => {
          callback(null, {
            stdout: JSON.stringify({
              success: true,
              transcript: {
                id: meetingId,
                title: '[Long Beach Airport] Weekly Sync',
                date: '2026-01-13',
                duration: 1800,
                transcript_url: 'https://fireflies.ai/view/slack-error',
                participants: ['Alice Johnson'],
                summary: {
                  action_items: 'Presentation',
                  gist: 'Design review',
                  overview: 'Weekly sync',
                  topics_discussed: ['Design'],
                },
                sentences: [],
              },
            }),
            stderr: '',
          });
        })
        .mockImplementationOnce((cmd, opts, callback) => {
          callback(null, {
            stdout: ':memo: **Post-Meeting Notes**',
            stderr: '',
          });
        });

      mockGetActiveProjects.mockResolvedValueOnce([
        {
          id: 'recProject1',
          name: 'Long Beach Airport',
          status: 'Active',
          slackChannelId: 'C001PROJECT',
          teamMemberIds: [],
          projectLeadIds: [],
        },
      ]);

      mockFindThreadBySyncCycle.mockResolvedValueOnce(null);

      // Slack API fails
      mockChatPostMessage.mockRejectedValueOnce(new Error('Channel not found'));

      const result = await firefliesHandler.processTranscription(meetingId);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Channel not found');
    });

    it('handles claude -p generation errors gracefully', async () => {
      const meetingId = 'ff-meeting-claude-error';

      mockExec
        .mockImplementationOnce((cmd, opts, callback) => {
          callback(null, {
            stdout: JSON.stringify({
              success: true,
              transcript: {
                id: meetingId,
                title: '[Marina Development] Weekly Sync',
                date: '2026-01-13',
                duration: 1800,
                transcript_url: 'https://fireflies.ai/view/claude-error',
                participants: ['Carol Davis'],
                summary: {
                  action_items: 'Submit permits',
                  gist: 'Marina progress',
                  overview: 'Weekly sync',
                  topics_discussed: ['Permits'],
                },
                sentences: [],
              },
            }),
            stderr: '',
          });
        })
        .mockImplementationOnce((cmd, opts, callback) => {
          // Claude CLI fails
          callback(new Error('Claude CLI not available'), null);
        });

      mockGetActiveProjects.mockResolvedValueOnce([
        {
          id: 'recProject2',
          name: 'Marina Development',
          status: 'Active',
          slackChannelId: 'C002PROJECT',
          teamMemberIds: [],
          projectLeadIds: [],
        },
      ]);

      const result = await firefliesHandler.processTranscription(meetingId);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Claude CLI not available');
      expect(mockChatPostMessage).not.toHaveBeenCalled();
    });
  });
});
