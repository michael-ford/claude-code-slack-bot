import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SlackHandler } from '../slack-handler';
import { WeeklySyncCommands } from '../weekly-sync/admin-commands';
import { config } from '../config';

/**
 * Integration test for WeeklySyncCommands wiring into SlackHandler.
 *
 * This test verifies Phase 8 of weekly-sync-system.md:
 * - SlackHandler checks for weekly-sync commands early in handleMessage()
 * - Permission validation against config.weeklySync.admins
 * - WeeklySyncCommands.isWeeklySyncCommand() is used to detect commands
 * - WeeklySyncCommands.parseWeeklySyncCommand() is used to parse actions
 * - Handling happens BEFORE Claude session processing
 *
 * Expected flow:
 * 1. handleMessage() receives "weekly-sync status"
 * 2. Calls WeeklySyncCommands.isWeeklySyncCommand() -> returns true
 * 3. Checks if user is in config.weeklySync.admins
 * 4. If not authorized, replies with permission denied
 * 5. If authorized, parses with WeeklySyncCommands.parseWeeklySyncCommand()
 * 6. Returns early WITHOUT calling ClaudeHandler.processUserMessage()
 */

describe('SlackHandler + WeeklySyncCommands Integration', () => {
  let mockApp: any;
  let mockClaudeHandler: any;
  let mockMcpManager: any;
  let mockSay: any;
  let originalAdmins: string[];

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
      // streamQuery is an async generator - mock it to yield nothing and complete
      streamQuery: vi.fn().mockImplementation(async function* () {
        // Yields nothing, just completes immediately
      }),
    };

    // Mock McpManager
    mockMcpManager = {
      formatMcpInfo: vi.fn().mockResolvedValue('Mock MCP Info'),
      reloadConfiguration: vi.fn().mockReturnValue(true),
      getServerConfigs: vi.fn().mockReturnValue([]),
    };

    // Mock say function - must return { ts } for status messages
    mockSay = vi.fn().mockResolvedValue({ ts: '1234567890.999999' });

    // Store original admins config to restore after each test
    originalAdmins = [...config.weeklySync.admins];
  });

  afterEach(() => {
    // Restore original config
    config.weeklySync.admins = originalAdmins;
  });

  describe('weekly-sync command detection', () => {
    it('detects "weekly-sync status" command before Claude processing', async () => {
      // Setup: Configure admin user
      config.weeklySync.admins = ['U123ADMIN'];

      const slackHandler = new SlackHandler(
        mockApp,
        mockClaudeHandler,
        mockMcpManager
      );

      const event = {
        user: 'U123ADMIN',
        channel: 'C456',
        ts: '1234567890.123456',
        text: 'weekly-sync status',
      };

      await slackHandler.handleMessage(event, mockSay);

      // Test should FAIL because slack-handler.ts doesn't check for weekly-sync commands yet
      // When implemented, it should:
      // 1. Detect the command using WeeklySyncCommands.isWeeklySyncCommand()
      // 2. Handle it directly
      // 3. NOT call claudeHandler.processUserMessage()

      expect(mockClaudeHandler.streamQuery).not.toHaveBeenCalled();
    });

    it('detects "wsync status" shorthand command', async () => {
      config.weeklySync.admins = ['U123ADMIN'];

      const slackHandler = new SlackHandler(
        mockApp,
        mockClaudeHandler,
        mockMcpManager
      );

      const event = {
        user: 'U123ADMIN',
        channel: 'C456',
        ts: '1234567890.123456',
        text: 'wsync status',
      };

      await slackHandler.handleMessage(event, mockSay);

      // Should not call Claude for weekly-sync commands
      expect(mockClaudeHandler.streamQuery).not.toHaveBeenCalled();
    });

    it('detects "weekly-sync start" command', async () => {
      config.weeklySync.admins = ['U123ADMIN'];

      const slackHandler = new SlackHandler(
        mockApp,
        mockClaudeHandler,
        mockMcpManager
      );

      const event = {
        user: 'U123ADMIN',
        channel: 'C456',
        ts: '1234567890.123456',
        text: 'weekly-sync start',
      };

      await slackHandler.handleMessage(event, mockSay);

      expect(mockClaudeHandler.streamQuery).not.toHaveBeenCalled();
    });

    it('detects "weekly-sync test <@U789>" command', async () => {
      config.weeklySync.admins = ['U123ADMIN'];

      const slackHandler = new SlackHandler(
        mockApp,
        mockClaudeHandler,
        mockMcpManager
      );

      const event = {
        user: 'U123ADMIN',
        channel: 'C456',
        ts: '1234567890.123456',
        text: 'weekly-sync test <@U789TEST>',
      };

      await slackHandler.handleMessage(event, mockSay);

      expect(mockClaudeHandler.streamQuery).not.toHaveBeenCalled();
    });

    it('does not interfere with regular messages', async () => {
      const slackHandler = new SlackHandler(
        mockApp,
        mockClaudeHandler,
        mockMcpManager
      );

      const event = {
        user: 'U123',
        channel: 'C456',
        ts: '1234567890.123456',
        text: 'hello, can you help me with some code?',
      };

      await slackHandler.handleMessage(event, mockSay);

      // Regular messages should still go to Claude via streamQuery
      expect(mockClaudeHandler.streamQuery).toHaveBeenCalled();
    });
  });

  describe('permission validation', () => {
    it('denies access when user is not in admins list', async () => {
      config.weeklySync.admins = ['U999OTHER'];

      const slackHandler = new SlackHandler(
        mockApp,
        mockClaudeHandler,
        mockMcpManager
      );

      const event = {
        user: 'U123UNAUTHORIZED',
        channel: 'C456',
        ts: '1234567890.123456',
        text: 'weekly-sync status',
      };

      await slackHandler.handleMessage(event, mockSay);

      // Should send permission denied message
      expect(mockSay).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringMatching(/permission denied|not authorized/i),
        })
      );

      // Should not process the command
      expect(mockClaudeHandler.streamQuery).not.toHaveBeenCalled();
    });

    it('allows access when user is in admins list', async () => {
      config.weeklySync.admins = ['U123ADMIN', 'U456ADMIN'];

      const slackHandler = new SlackHandler(
        mockApp,
        mockClaudeHandler,
        mockMcpManager
      );

      const event = {
        user: 'U456ADMIN',
        channel: 'C456',
        ts: '1234567890.123456',
        text: 'weekly-sync status',
      };

      await slackHandler.handleMessage(event, mockSay);

      // Should not send permission denied
      const denialCall = mockSay.mock.calls.find((call: any[]) =>
        call[0]?.text?.match(/permission denied|not authorized/i)
      );
      expect(denialCall).toBeUndefined();

      // Should not call Claude
      expect(mockClaudeHandler.streamQuery).not.toHaveBeenCalled();
    });

    it('denies access when admins list is empty', async () => {
      config.weeklySync.admins = [];

      const slackHandler = new SlackHandler(
        mockApp,
        mockClaudeHandler,
        mockMcpManager
      );

      const event = {
        user: 'U123',
        channel: 'C456',
        ts: '1234567890.123456',
        text: 'weekly-sync status',
      };

      await slackHandler.handleMessage(event, mockSay);

      expect(mockSay).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringMatching(/permission denied|not authorized/i),
        })
      );
    });
  });

  describe('command parsing and handling', () => {
    it('parses "weekly-sync status" and handles status action', async () => {
      config.weeklySync.admins = ['U123ADMIN'];

      const slackHandler = new SlackHandler(
        mockApp,
        mockClaudeHandler,
        mockMcpManager
      );

      const event = {
        user: 'U123ADMIN',
        channel: 'C456',
        ts: '1234567890.123456',
        text: 'weekly-sync status',
      };

      await slackHandler.handleMessage(event, mockSay);

      // Should respond with status information (not permission denied)
      const statusCall = mockSay.mock.calls.find((call: any[]) =>
        !call[0]?.text?.match(/permission denied/i)
      );
      expect(statusCall).toBeDefined();
    });

    it('parses "weekly-sync start" and handles start action', async () => {
      config.weeklySync.admins = ['U123ADMIN'];

      const slackHandler = new SlackHandler(
        mockApp,
        mockClaudeHandler,
        mockMcpManager
      );

      const event = {
        user: 'U123ADMIN',
        channel: 'C456',
        ts: '1234567890.123456',
        text: 'weekly-sync start',
      };

      await slackHandler.handleMessage(event, mockSay);

      // Should acknowledge the start command
      expect(mockSay).toHaveBeenCalled();
    });

    it('parses "weekly-sync start --dry-run" with dry-run flag', async () => {
      config.weeklySync.admins = ['U123ADMIN'];

      const slackHandler = new SlackHandler(
        mockApp,
        mockClaudeHandler,
        mockMcpManager
      );

      const event = {
        user: 'U123ADMIN',
        channel: 'C456',
        ts: '1234567890.123456',
        text: 'weekly-sync start --dry-run',
      };

      await slackHandler.handleMessage(event, mockSay);

      // Should acknowledge the dry-run start
      expect(mockSay).toHaveBeenCalled();
    });

    it('parses "weekly-sync test <@U789>" with target user', async () => {
      config.weeklySync.admins = ['U123ADMIN'];

      const slackHandler = new SlackHandler(
        mockApp,
        mockClaudeHandler,
        mockMcpManager
      );

      const event = {
        user: 'U123ADMIN',
        channel: 'C456',
        ts: '1234567890.123456',
        text: 'weekly-sync test <@U789TEST>',
      };

      await slackHandler.handleMessage(event, mockSay);

      // Should acknowledge the test command
      expect(mockSay).toHaveBeenCalled();
    });

    it('shows help for "weekly-sync" without subcommand', async () => {
      config.weeklySync.admins = ['U123ADMIN'];

      const slackHandler = new SlackHandler(
        mockApp,
        mockClaudeHandler,
        mockMcpManager
      );

      const event = {
        user: 'U123ADMIN',
        channel: 'C456',
        ts: '1234567890.123456',
        text: 'weekly-sync',
      };

      await slackHandler.handleMessage(event, mockSay);

      // Should show help message
      expect(mockSay).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringMatching(/help|usage|commands/i),
        })
      );
    });

    it('shows help for "weekly-sync invalid-command"', async () => {
      config.weeklySync.admins = ['U123ADMIN'];

      const slackHandler = new SlackHandler(
        mockApp,
        mockClaudeHandler,
        mockMcpManager
      );

      const event = {
        user: 'U123ADMIN',
        channel: 'C456',
        ts: '1234567890.123456',
        text: 'weekly-sync invalid-command',
      };

      await slackHandler.handleMessage(event, mockSay);

      // Should show help message for invalid command
      expect(mockSay).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringMatching(/help|usage|unknown/i),
        })
      );
    });
  });

  describe('execution order', () => {
    it('checks for weekly-sync commands before other command parsers', async () => {
      config.weeklySync.admins = ['U123ADMIN'];

      const slackHandler = new SlackHandler(
        mockApp,
        mockClaudeHandler,
        mockMcpManager
      );

      // Message that could be confused with other commands
      const event = {
        user: 'U123ADMIN',
        channel: 'C456',
        ts: '1234567890.123456',
        text: 'weekly-sync status',
      };

      await slackHandler.handleMessage(event, mockSay);

      // Should handle as weekly-sync command, not pass to Claude
      expect(mockClaudeHandler.streamQuery).not.toHaveBeenCalled();
    });

    it('handles weekly-sync commands in threads', async () => {
      config.weeklySync.admins = ['U123ADMIN'];

      const slackHandler = new SlackHandler(
        mockApp,
        mockClaudeHandler,
        mockMcpManager
      );

      const event = {
        user: 'U123ADMIN',
        channel: 'C456',
        thread_ts: '1234567890.000000',
        ts: '1234567890.123456',
        text: 'weekly-sync status',
      };

      await slackHandler.handleMessage(event, mockSay);

      // Should respond in thread
      expect(mockSay).toHaveBeenCalledWith(
        expect.objectContaining({
          thread_ts: '1234567890.000000',
        })
      );

      // Should not call Claude
      expect(mockClaudeHandler.streamQuery).not.toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('handles case-insensitive "WEEKLY-SYNC STATUS"', async () => {
      config.weeklySync.admins = ['U123ADMIN'];

      const slackHandler = new SlackHandler(
        mockApp,
        mockClaudeHandler,
        mockMcpManager
      );

      const event = {
        user: 'U123ADMIN',
        channel: 'C456',
        ts: '1234567890.123456',
        text: 'WEEKLY-SYNC STATUS',
      };

      await slackHandler.handleMessage(event, mockSay);

      expect(mockClaudeHandler.streamQuery).not.toHaveBeenCalled();
    });

    it('handles extra whitespace "  weekly-sync   status  "', async () => {
      config.weeklySync.admins = ['U123ADMIN'];

      const slackHandler = new SlackHandler(
        mockApp,
        mockClaudeHandler,
        mockMcpManager
      );

      const event = {
        user: 'U123ADMIN',
        channel: 'C456',
        ts: '1234567890.123456',
        text: '  weekly-sync   status  ',
      };

      await slackHandler.handleMessage(event, mockSay);

      expect(mockClaudeHandler.streamQuery).not.toHaveBeenCalled();
    });

    it('does not match partial strings like "my weekly-sync tool"', async () => {
      const slackHandler = new SlackHandler(
        mockApp,
        mockClaudeHandler,
        mockMcpManager
      );

      const event = {
        user: 'U123',
        channel: 'C456',
        ts: '1234567890.123456',
        text: 'I need to build a weekly-sync tool',
      };

      await slackHandler.handleMessage(event, mockSay);

      // Should pass to Claude as regular message via streamQuery
      expect(mockClaudeHandler.streamQuery).toHaveBeenCalled();
    });
  });
});
