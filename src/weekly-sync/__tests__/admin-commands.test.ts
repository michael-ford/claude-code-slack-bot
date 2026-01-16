import { describe, it, expect } from 'vitest';
import type { WeeklySyncAction } from '../admin-commands';
import { WeeklySyncCommands } from '../admin-commands';

describe('WeeklySyncCommands', () => {
  describe('isWeeklySyncCommand', () => {
    it('matches "weekly-sync"', () => {
      expect(WeeklySyncCommands.isWeeklySyncCommand('weekly-sync')).toBe(true);
    });

    it('matches "weekly_sync"', () => {
      expect(WeeklySyncCommands.isWeeklySyncCommand('weekly_sync')).toBe(true);
    });

    it('matches "weeklysync" without separator', () => {
      expect(WeeklySyncCommands.isWeeklySyncCommand('weeklysync')).toBe(true);
    });

    it('matches "wsync" shorthand', () => {
      expect(WeeklySyncCommands.isWeeklySyncCommand('wsync')).toBe(true);
    });

    it('matches with leading slash "/weekly-sync"', () => {
      expect(WeeklySyncCommands.isWeeklySyncCommand('/weekly-sync')).toBe(true);
    });

    it('matches with leading slash "/weekly_sync"', () => {
      expect(WeeklySyncCommands.isWeeklySyncCommand('/weekly_sync')).toBe(true);
    });

    it('matches with leading slash "/wsync"', () => {
      expect(WeeklySyncCommands.isWeeklySyncCommand('/wsync')).toBe(true);
    });

    it('is case-insensitive for "WEEKLY-SYNC"', () => {
      expect(WeeklySyncCommands.isWeeklySyncCommand('WEEKLY-SYNC')).toBe(true);
    });

    it('is case-insensitive for "Weekly_Sync"', () => {
      expect(WeeklySyncCommands.isWeeklySyncCommand('Weekly_Sync')).toBe(true);
    });

    it('is case-insensitive for "WSYNC"', () => {
      expect(WeeklySyncCommands.isWeeklySyncCommand('WSYNC')).toBe(true);
    });

    it('matches with subcommands "weekly-sync status"', () => {
      expect(WeeklySyncCommands.isWeeklySyncCommand('weekly-sync status')).toBe(true);
    });

    it('matches with subcommands "weekly-sync start"', () => {
      expect(WeeklySyncCommands.isWeeklySyncCommand('weekly-sync start')).toBe(true);
    });

    it('matches with subcommands "wsync test @user"', () => {
      expect(WeeklySyncCommands.isWeeklySyncCommand('wsync test @user')).toBe(true);
    });

    it('returns false for non-matching text "weekly update"', () => {
      expect(WeeklySyncCommands.isWeeklySyncCommand('weekly update')).toBe(false);
    });

    it('returns false for non-matching text "sync status"', () => {
      expect(WeeklySyncCommands.isWeeklySyncCommand('sync status')).toBe(false);
    });

    it('returns false for non-matching text "hello world"', () => {
      expect(WeeklySyncCommands.isWeeklySyncCommand('hello world')).toBe(false);
    });

    it('returns false for partial match "weekly-syncing"', () => {
      expect(WeeklySyncCommands.isWeeklySyncCommand('weekly-syncing')).toBe(false);
    });
  });

  describe('parseWeeklySyncCommand', () => {
    describe('status action', () => {
      it('parses "weekly-sync status" correctly', () => {
        const result = WeeklySyncCommands.parseWeeklySyncCommand('weekly-sync status');
        expect(result).toEqual({ action: 'status' });
      });

      it('parses "/weekly-sync status" correctly', () => {
        const result = WeeklySyncCommands.parseWeeklySyncCommand('/weekly-sync status');
        expect(result).toEqual({ action: 'status' });
      });

      it('parses "wsync status" correctly', () => {
        const result = WeeklySyncCommands.parseWeeklySyncCommand('wsync status');
        expect(result).toEqual({ action: 'status' });
      });

      it('is case-insensitive for "WEEKLY-SYNC STATUS"', () => {
        const result = WeeklySyncCommands.parseWeeklySyncCommand('WEEKLY-SYNC STATUS');
        expect(result).toEqual({ action: 'status' });
      });
    });

    describe('start action', () => {
      it('parses "weekly-sync start" correctly without dry-run', () => {
        const result = WeeklySyncCommands.parseWeeklySyncCommand('weekly-sync start');
        expect(result).toEqual({ action: 'start', dryRun: false });
      });

      it('parses "/weekly-sync start" correctly without dry-run', () => {
        const result = WeeklySyncCommands.parseWeeklySyncCommand('/weekly-sync start');
        expect(result).toEqual({ action: 'start', dryRun: false });
      });

      it('parses "weekly-sync start --dry-run" correctly with dry-run', () => {
        const result = WeeklySyncCommands.parseWeeklySyncCommand('weekly-sync start --dry-run');
        expect(result).toEqual({ action: 'start', dryRun: true });
      });

      it('parses "weekly-sync start --dryrun" correctly with dry-run', () => {
        const result = WeeklySyncCommands.parseWeeklySyncCommand('weekly-sync start --dryrun');
        expect(result).toEqual({ action: 'start', dryRun: true });
      });

      it('parses "wsync start --dry-run" correctly', () => {
        const result = WeeklySyncCommands.parseWeeklySyncCommand('wsync start --dry-run');
        expect(result).toEqual({ action: 'start', dryRun: true });
      });

      it('is case-insensitive for "WEEKLY-SYNC START --DRY-RUN"', () => {
        const result = WeeklySyncCommands.parseWeeklySyncCommand('WEEKLY-SYNC START --DRY-RUN');
        expect(result).toEqual({ action: 'start', dryRun: true });
      });
    });

    describe('test action', () => {
      it('returns help for invalid user format "@user"', () => {
        const result = WeeklySyncCommands.parseWeeklySyncCommand('weekly-sync test @user');
        expect(result).toEqual({ action: 'help' });
      });

      it('parses "weekly-sync test U12345" correctly with bare user ID', () => {
        const result = WeeklySyncCommands.parseWeeklySyncCommand('weekly-sync test U12345');
        expect(result).toEqual({ action: 'test', targetUserId: 'U12345' });
      });

      it('parses "weekly-sync test <@U12345>" correctly (Slack mention format)', () => {
        const result = WeeklySyncCommands.parseWeeklySyncCommand('weekly-sync test <@U12345>');
        expect(result).toEqual({ action: 'test', targetUserId: 'U12345' });
      });

      it('parses "weekly-sync test <@U12345|alice>" correctly (Slack mention with username)', () => {
        const result = WeeklySyncCommands.parseWeeklySyncCommand('weekly-sync test <@U12345|alice>');
        expect(result).toEqual({ action: 'test', targetUserId: 'U12345' });
      });

      it('parses "wsync test <@UABCDEF123>" correctly', () => {
        const result = WeeklySyncCommands.parseWeeklySyncCommand('wsync test <@UABCDEF123>');
        expect(result).toEqual({ action: 'test', targetUserId: 'UABCDEF123' });
      });

      it('is case-insensitive for "WEEKLY-SYNC TEST <@U12345>"', () => {
        const result = WeeklySyncCommands.parseWeeklySyncCommand('WEEKLY-SYNC TEST <@U12345>');
        expect(result).toEqual({ action: 'test', targetUserId: 'U12345' });
      });

      it('returns help for invalid user ID format (does not start with U)', () => {
        const result = WeeklySyncCommands.parseWeeklySyncCommand('weekly-sync test <@X12345>');
        expect(result).toEqual({ action: 'help' });
      });

      it('returns help for invalid user ID format (only U with no following characters)', () => {
        const result = WeeklySyncCommands.parseWeeklySyncCommand('weekly-sync test <@U>');
        expect(result).toEqual({ action: 'help' });
      });

      it('returns help for empty mention <@>', () => {
        const result = WeeklySyncCommands.parseWeeklySyncCommand('weekly-sync test <@>');
        expect(result).toEqual({ action: 'help' });
      });

      it('returns help for invalid user ID format (contains special characters)', () => {
        const result = WeeklySyncCommands.parseWeeklySyncCommand('weekly-sync test U12345!@#');
        expect(result).toEqual({ action: 'help' });
      });

      it('returns help for invalid user ID format (bare string not starting with U)', () => {
        const result = WeeklySyncCommands.parseWeeklySyncCommand('weekly-sync test invalid-user');
        expect(result).toEqual({ action: 'help' });
      });
    });

    describe('summary action', () => {
      it('parses "weekly-sync summary" correctly without project name', () => {
        const result = WeeklySyncCommands.parseWeeklySyncCommand('weekly-sync summary');
        expect(result).toEqual({ action: 'summary' });
      });

      it('parses "/weekly-sync summary" correctly without project name', () => {
        const result = WeeklySyncCommands.parseWeeklySyncCommand('/weekly-sync summary');
        expect(result).toEqual({ action: 'summary' });
      });

      it('parses "weekly-sync summary ProjectName" correctly with project name', () => {
        const result = WeeklySyncCommands.parseWeeklySyncCommand('weekly-sync summary ProjectName');
        expect(result).toEqual({ action: 'summary', projectName: 'ProjectName' });
      });

      it('parses "weekly-sync summary Long Beach Airport" correctly with multi-word project', () => {
        const result = WeeklySyncCommands.parseWeeklySyncCommand('weekly-sync summary Long Beach Airport');
        expect(result).toEqual({ action: 'summary', projectName: 'Long Beach Airport' });
      });

      it('parses "wsync summary Marina_Dev" correctly', () => {
        const result = WeeklySyncCommands.parseWeeklySyncCommand('wsync summary Marina_Dev');
        expect(result).toEqual({ action: 'summary', projectName: 'Marina_Dev' });
      });

      it('is case-insensitive for "WEEKLY-SYNC SUMMARY"', () => {
        const result = WeeklySyncCommands.parseWeeklySyncCommand('WEEKLY-SYNC SUMMARY');
        expect(result).toEqual({ action: 'summary' });
      });

      it('returns help for extremely long project name (>200 chars)', () => {
        const longName = 'A'.repeat(201);
        const result = WeeklySyncCommands.parseWeeklySyncCommand(`weekly-sync summary ${longName}`);
        expect(result).toEqual({ action: 'help' });
      });

      it('accepts project name at exactly 200 chars', () => {
        const longName = 'A'.repeat(200);
        const result = WeeklySyncCommands.parseWeeklySyncCommand(`weekly-sync summary ${longName}`);
        expect(result).toEqual({ action: 'summary', projectName: longName });
      });
    });

    describe('help action', () => {
      it('returns help for unknown subcommand "weekly-sync foo"', () => {
        const result = WeeklySyncCommands.parseWeeklySyncCommand('weekly-sync foo');
        expect(result).toEqual({ action: 'help' });
      });

      it('returns help for unknown subcommand "weekly-sync invalid"', () => {
        const result = WeeklySyncCommands.parseWeeklySyncCommand('weekly-sync invalid');
        expect(result).toEqual({ action: 'help' });
      });

      it('returns help for empty subcommand "weekly-sync"', () => {
        const result = WeeklySyncCommands.parseWeeklySyncCommand('weekly-sync');
        expect(result).toEqual({ action: 'help' });
      });

      it('returns help for just "/weekly-sync"', () => {
        const result = WeeklySyncCommands.parseWeeklySyncCommand('/weekly-sync');
        expect(result).toEqual({ action: 'help' });
      });

      it('returns help for just "wsync"', () => {
        const result = WeeklySyncCommands.parseWeeklySyncCommand('wsync');
        expect(result).toEqual({ action: 'help' });
      });

      it('returns help when test is missing target user', () => {
        const result = WeeklySyncCommands.parseWeeklySyncCommand('weekly-sync test');
        expect(result).toEqual({ action: 'help' });
      });
    });

    describe('edge cases', () => {
      it('handles extra whitespace "  weekly-sync   status  "', () => {
        const result = WeeklySyncCommands.parseWeeklySyncCommand('  weekly-sync   status  ');
        expect(result).toEqual({ action: 'status' });
      });

      it('handles tabs "weekly-sync\tstatus"', () => {
        const result = WeeklySyncCommands.parseWeeklySyncCommand('weekly-sync\tstatus');
        expect(result).toEqual({ action: 'status' });
      });

      it('preserves whitespace in project names "weekly-sync summary   Project   Name  "', () => {
        const result = WeeklySyncCommands.parseWeeklySyncCommand('weekly-sync summary   Project   Name  ');
        // Normalized whitespace in project name
        expect(result).toEqual({ action: 'summary', projectName: 'Project   Name' });
      });
    });
  });

  describe('type validation', () => {
    it('ensures WeeklySyncAction type accepts status action', () => {
      const action: WeeklySyncAction = { action: 'status' };
      expect(action.action).toBe('status');
    });

    it('ensures WeeklySyncAction type accepts start action with dryRun', () => {
      const action: WeeklySyncAction = { action: 'start', dryRun: true };
      expect(action.action).toBe('start');
      expect(action.dryRun).toBe(true);
    });

    it('ensures WeeklySyncAction type accepts test action with targetUserId', () => {
      const action: WeeklySyncAction = { action: 'test', targetUserId: 'U12345' };
      expect(action.action).toBe('test');
      expect(action.targetUserId).toBe('U12345');
    });

    it('ensures WeeklySyncAction type accepts summary action without projectName', () => {
      const action: WeeklySyncAction = { action: 'summary' };
      expect(action.action).toBe('summary');
      expect((action as any).projectName).toBeUndefined();
    });

    it('ensures WeeklySyncAction type accepts summary action with projectName', () => {
      const action: WeeklySyncAction = { action: 'summary', projectName: 'TestProject' };
      expect(action.action).toBe('summary');
      expect(action.projectName).toBe('TestProject');
    });

    it('ensures WeeklySyncAction type accepts help action', () => {
      const action: WeeklySyncAction = { action: 'help' };
      expect(action.action).toBe('help');
    });
  });
});
