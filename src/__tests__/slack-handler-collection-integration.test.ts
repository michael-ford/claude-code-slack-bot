import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SlackHandler } from '../slack-handler';

/**
 * Integration test for CollectionManager wiring into SlackHandler.
 *
 * This test verifies behavioral integration:
 * 1. handleMessage() calls isCollectionThread() when thread_ts is present
 * 2. handleMessage() retrieves collection context when collection thread is detected
 * 3. Error handling works correctly (CollectionManager throws, handler continues)
 */

describe('SlackHandler + CollectionManager Integration', () => {
  let mockApp: any;
  let mockClaudeHandler: any;
  let mockMcpManager: any;
  let mockCollectionManager: any;
  let mockSay: any;

  beforeEach(() => {
    // Mock Slack App
    mockApp = {
      client: {
        reactions: {
          add: vi.fn(),
          remove: vi.fn(),
        },
        chat: {
          postMessage: vi.fn().mockResolvedValue({ ok: true, ts: '1234567890.123456' }),
          update: vi.fn(),
        },
        users: {
          info: vi.fn().mockResolvedValue({
            ok: true,
            user: { real_name: 'Test User' },
          }),
        },
      },
    };

    // Mock ClaudeHandler
    mockClaudeHandler = {
      processUserMessage: vi.fn().mockResolvedValue(undefined),
      getOrCreateSession: vi.fn().mockResolvedValue({
        sessionId: 'test-session-id',
        sessionKey: 'test-session-key',
      }),
      terminateSession: vi.fn(),
      getSessionKey: vi.fn((channel: string, threadTs?: string) => {
        return threadTs ? `${channel}-${threadTs}` : channel;
      }),
      getSession: vi.fn().mockReturnValue(null),
      createSession: vi.fn().mockResolvedValue({
        sessionId: 'test-session-id',
        sessionKey: 'test-session-key',
        ownerUserId: 'U123',
        ownerName: 'Test User',
      }),
      setSessionTitle: vi.fn(),
      canInterrupt: vi.fn().mockReturnValue(true),
      updateInitiator: vi.fn(),
    };

    // Mock McpManager
    mockMcpManager = {
      formatMcpInfo: vi.fn().mockResolvedValue('Mock MCP Info'),
      reloadConfiguration: vi.fn().mockReturnValue(true),
      getServerConfigs: vi.fn().mockReturnValue([]),
    };

    // Mock CollectionManager
    mockCollectionManager = {
      isCollectionThread: vi.fn(),
      getCollectionContext: vi.fn(),
    };

    // Mock say function
    mockSay = vi.fn().mockResolvedValue(undefined);
  });

  describe('constructor accepts CollectionManager', () => {
    it('stores collectionManager when provided', () => {
      const slackHandler = new SlackHandler(
        mockApp,
        mockClaudeHandler,
        mockMcpManager,
        { collectionManager: mockCollectionManager }
      );

      expect(slackHandler.collectionManager).toBe(mockCollectionManager);
    });

    it('has undefined collectionManager when not provided', () => {
      const slackHandler = new SlackHandler(
        mockApp,
        mockClaudeHandler,
        mockMcpManager
      );

      expect(slackHandler.collectionManager).toBeUndefined();
    });
  });

  describe('isCollectionThread method', () => {
    it('delegates to collectionManager when available', async () => {
      mockCollectionManager.isCollectionThread.mockResolvedValue(true);

      const slackHandler = new SlackHandler(
        mockApp,
        mockClaudeHandler,
        mockMcpManager,
        { collectionManager: mockCollectionManager }
      );

      const result = await slackHandler.isCollectionThread('C123', '1234567890.123456');

      expect(result).toBe(true);
      expect(mockCollectionManager.isCollectionThread).toHaveBeenCalledWith('C123', '1234567890.123456');
    });

    it('returns false when collectionManager is not available', async () => {
      const slackHandler = new SlackHandler(
        mockApp,
        mockClaudeHandler,
        mockMcpManager
      );

      const result = await slackHandler.isCollectionThread('C123', '1234567890.123456');

      expect(result).toBe(false);
    });
  });

  describe('getCollectionContext method', () => {
    it('delegates to collectionManager when available', async () => {
      const mockContext = {
        skill: 'weekly-sync-collection',
        personId: 'rec123',
        personName: 'John Doe',
        weekStart: '2026-01-13',
        projects: [{ id: 'proj1', name: 'Project A' }],
      };
      mockCollectionManager.getCollectionContext.mockResolvedValue(mockContext);

      const slackHandler = new SlackHandler(
        mockApp,
        mockClaudeHandler,
        mockMcpManager,
        { collectionManager: mockCollectionManager }
      );

      const result = await slackHandler.getCollectionContext('C123', '1234567890.123456');

      expect(result).toEqual(mockContext);
      expect(mockCollectionManager.getCollectionContext).toHaveBeenCalledWith('C123', '1234567890.123456');
    });

    it('returns null when collectionManager is not available', async () => {
      const slackHandler = new SlackHandler(
        mockApp,
        mockClaudeHandler,
        mockMcpManager
      );

      const result = await slackHandler.getCollectionContext('C123', '1234567890.123456');

      expect(result).toBeNull();
    });
  });

  describe('handleMessage behavior with CollectionManager', () => {
    it('calls isCollectionThread when thread_ts is present', async () => {
      mockCollectionManager.isCollectionThread.mockResolvedValue(false);

      const slackHandler = new SlackHandler(
        mockApp,
        mockClaudeHandler,
        mockMcpManager,
        { collectionManager: mockCollectionManager }
      );

      const event = {
        user: 'U123',
        channel: 'D456',
        thread_ts: '1234567890.123456',
        ts: '1234567890.123457',
        text: 'Hello',
      };

      await slackHandler.handleMessage(event, mockSay);

      // Verify isCollectionThread was called with correct parameters
      expect(mockCollectionManager.isCollectionThread).toHaveBeenCalledWith('D456', '1234567890.123456');
    });

    it('does not call isCollectionThread when thread_ts is missing', async () => {
      const slackHandler = new SlackHandler(
        mockApp,
        mockClaudeHandler,
        mockMcpManager,
        { collectionManager: mockCollectionManager }
      );

      const event = {
        user: 'U123',
        channel: 'D456',
        ts: '1234567890.123457',
        text: 'Hello',
      };

      await slackHandler.handleMessage(event, mockSay);

      // isCollectionThread should not be called for non-thread messages
      expect(mockCollectionManager.isCollectionThread).not.toHaveBeenCalled();
    });

    it('retrieves collection context when collection thread is detected', async () => {
      const mockContext = {
        skill: 'weekly-sync-collection',
        personId: 'rec123',
        personName: 'John Doe',
        weekStart: '2026-01-13',
        projects: [{ id: 'proj1', name: 'Project A' }],
      };

      mockCollectionManager.isCollectionThread.mockResolvedValue(true);
      mockCollectionManager.getCollectionContext.mockResolvedValue(mockContext);

      const slackHandler = new SlackHandler(
        mockApp,
        mockClaudeHandler,
        mockMcpManager,
        { collectionManager: mockCollectionManager }
      );

      const event = {
        user: 'U123',
        channel: 'D456',
        thread_ts: '1234567890.123456',
        ts: '1234567890.123457',
        text: 'Hello',
      };

      await slackHandler.handleMessage(event, mockSay);

      // Verify getCollectionContext was called
      expect(mockCollectionManager.getCollectionContext).toHaveBeenCalledWith('D456', '1234567890.123456');
    });

    it('continues gracefully when CollectionManager.isCollectionThread throws', async () => {
      mockCollectionManager.isCollectionThread.mockRejectedValue(
        new Error('Database connection failed')
      );

      const slackHandler = new SlackHandler(
        mockApp,
        mockClaudeHandler,
        mockMcpManager,
        { collectionManager: mockCollectionManager }
      );

      const event = {
        user: 'U123',
        channel: 'D456',
        thread_ts: '1234567890.123456',
        ts: '1234567890.123457',
        text: 'Hello',
      };

      // Should not throw - handler should continue normally
      await expect(slackHandler.handleMessage(event, mockSay)).resolves.toBeUndefined();

      // Error should be logged but flow continues (verified by no exception thrown)
    });

    it('continues gracefully when CollectionManager.getCollectionContext throws', async () => {
      mockCollectionManager.isCollectionThread.mockResolvedValue(true);
      mockCollectionManager.getCollectionContext.mockRejectedValue(
        new Error('Failed to fetch context')
      );

      const slackHandler = new SlackHandler(
        mockApp,
        mockClaudeHandler,
        mockMcpManager,
        { collectionManager: mockCollectionManager }
      );

      const event = {
        user: 'U123',
        channel: 'D456',
        thread_ts: '1234567890.123456',
        ts: '1234567890.123457',
        text: 'Hello',
      };

      // Should not throw - handler should continue normally
      await expect(slackHandler.handleMessage(event, mockSay)).resolves.toBeUndefined();

      // Error should be logged but flow continues (verified by no exception thrown)
    });

    it('does not call getCollectionContext when isCollectionThread returns false', async () => {
      mockCollectionManager.isCollectionThread.mockResolvedValue(false);

      const slackHandler = new SlackHandler(
        mockApp,
        mockClaudeHandler,
        mockMcpManager,
        { collectionManager: mockCollectionManager }
      );

      const event = {
        user: 'U123',
        channel: 'D456',
        thread_ts: '1234567890.123456',
        ts: '1234567890.123457',
        text: 'Hello',
      };

      await slackHandler.handleMessage(event, mockSay);

      // getCollectionContext should not be called if it's not a collection thread
      expect(mockCollectionManager.getCollectionContext).not.toHaveBeenCalled();
    });

    it('handles null context from getCollectionContext gracefully', async () => {
      mockCollectionManager.isCollectionThread.mockResolvedValue(true);
      mockCollectionManager.getCollectionContext.mockResolvedValue(null);

      const slackHandler = new SlackHandler(
        mockApp,
        mockClaudeHandler,
        mockMcpManager,
        { collectionManager: mockCollectionManager }
      );

      const event = {
        user: 'U123',
        channel: 'D456',
        thread_ts: '1234567890.123456',
        ts: '1234567890.123457',
        text: 'Hello',
      };

      // Should not throw - handler should continue normally
      await expect(slackHandler.handleMessage(event, mockSay)).resolves.toBeUndefined();

      // Null context is a valid response (verified by no exception thrown)
    });
  });
});
