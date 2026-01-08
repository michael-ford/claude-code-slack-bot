import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the claude-code SDK
vi.mock('@anthropic-ai/claude-code', () => ({
  query: vi.fn(async function* () {
    yield { type: 'system', subtype: 'init', session_id: 'test-session' };
  }),
}));

// Mock the prompt loader
vi.mock('./prompts/slack-formatting', () => ({
  loadSlackFormattingPrompt: vi.fn(() => '<slack_formatting>\nTest content\n</slack_formatting>'),
}));

// Mock other dependencies
vi.mock('./mcp-manager', () => {
  return {
    McpManager: class MockMcpManager {
      getServerConfiguration = vi.fn().mockResolvedValue({});
      getDefaultAllowedTools = vi.fn().mockReturnValue([]);
    },
  };
});

vi.mock('./user-settings-store', () => ({
  userSettingsStore: {
    getUserBypassPermission: vi.fn().mockReturnValue(false),
    getUserDefaultModel: vi.fn().mockReturnValue('claude-sonnet-4-5-20250929'),
  },
}));

vi.mock('./credentials-manager', () => ({
  ensureValidCredentials: vi.fn().mockResolvedValue({ valid: true }),
  getCredentialStatus: vi.fn().mockReturnValue('valid'),
}));

vi.mock('./credential-alert', () => ({
  sendCredentialAlert: vi.fn(),
}));

vi.mock('./config', () => ({
  config: {
    workingDirectory: {
      fixed: null,
    },
  },
}));

describe('ClaudeHandler prompt injection', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('should include slack formatting in customSystemPrompt', async () => {
    const { query } = await import('@anthropic-ai/claude-code');
    const { ClaudeHandler } = await import('./claude-handler');
    const { McpManager } = await import('./mcp-manager');

    const mcpManager = new McpManager();
    const handler = new ClaudeHandler(mcpManager);

    // Create a generator and consume first message to trigger the query
    const generator = handler.streamQuery('test prompt', undefined, undefined, '/tmp');
    await generator.next();

    // Check that query was called with customSystemPrompt containing slack formatting
    expect(query).toHaveBeenCalled();
    const callArgs = vi.mocked(query).mock.calls[0][0];
    expect(callArgs.options?.customSystemPrompt).toContain('<slack_formatting>');
  });
});
