import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs';

// Mock the fs module
vi.mock('fs');

// Import after mocking
import { getChannelProjectContext } from './channel-project-context';

describe('channel-project-context', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('getChannelProjectContext', () => {
    const mockWorkingDirectory = '/Users/test/pm-assistant';
    const mockChannelId = 'C0123ABCDEF';

    it('should return XML context when project matches channel ID', () => {
      // Mock readdirSync to return a snapshot directory (returns string[] by default)
      vi.mocked(fs.readdirSync).mockReturnValue([
        'appQlKIvpxd6byC5H-ImFX___OLA_Project_Managment',
      ] as unknown as fs.Dirent<Buffer>[]);

      // Mock existsSync to return true for the Projects.json file
      vi.mocked(fs.existsSync).mockReturnValue(true);

      // Mock readFileSync to return project data with matching channel ID
      const mockProjectsData = {
        table: { id: 'tbldgctJFcunQ1ZgM' },
        records: [
          {
            id: 'recXYZ123',
            fields: {
              'Name': 'Test Project',
              'Slack Channel ID': mockChannelId,
              'Google Drive Folder ID': 'folder-id-123',
              'Status': 'Active',
            },
          },
          {
            id: 'recABC456',
            fields: {
              'Name': 'Other Project',
              'Slack Channel ID': 'C9999OTHER',
              'Google Drive Folder ID': 'folder-id-456',
              'Status': 'Active',
            },
          },
        ],
      };
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockProjectsData));

      const result = getChannelProjectContext(mockChannelId, mockWorkingDirectory);

      expect(result).not.toBeNull();
      expect(result).toContain('<channel-project>');
      expect(result).toContain('<project-name>Test Project</project-name>');
      expect(result).toContain('<airtable-project-id>recXYZ123</airtable-project-id>');
      expect(result).toContain('<google-drive-folder>folder-id-123</google-drive-folder>');
      expect(result).toContain('</channel-project>');
    });

    it('should return null when no project matches the channel ID', () => {
      vi.mocked(fs.readdirSync).mockReturnValue([
        'appQlKIvpxd6byC5H-ImFX___OLA_Project_Managment',
      ] as unknown as fs.Dirent<Buffer>[]);
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const mockProjectsData = {
        table: { id: 'tbldgctJFcunQ1ZgM' },
        records: [
          {
            id: 'recXYZ123',
            fields: {
              'Name': 'Test Project',
              'Slack Channel ID': 'C9999OTHER',
              'Status': 'Active',
            },
          },
        ],
      };
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockProjectsData));

      const result = getChannelProjectContext('C0000NOMATCH', mockWorkingDirectory);

      expect(result).toBeNull();
    });

    it('should return null when snapshot directory does not exist', () => {
      // Mock readdirSync to throw an error (directory doesn't exist)
      vi.mocked(fs.readdirSync).mockImplementation(() => {
        throw new Error('ENOENT: no such file or directory');
      });

      const result = getChannelProjectContext(mockChannelId, mockWorkingDirectory);

      expect(result).toBeNull();
    });

    it('should return null when Projects.json file does not exist', () => {
      vi.mocked(fs.readdirSync).mockReturnValue([
        'appQlKIvpxd6byC5H-ImFX___OLA_Project_Managment',
      ] as unknown as fs.Dirent<Buffer>[]);
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = getChannelProjectContext(mockChannelId, mockWorkingDirectory);

      expect(result).toBeNull();
    });

    it('should return null when JSON parsing fails', () => {
      vi.mocked(fs.readdirSync).mockReturnValue([
        'appQlKIvpxd6byC5H-ImFX___OLA_Project_Managment',
      ] as unknown as fs.Dirent<Buffer>[]);
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('invalid json');

      const result = getChannelProjectContext(mockChannelId, mockWorkingDirectory);

      expect(result).toBeNull();
    });

    it('should return null silently without logging errors', () => {
      // Spy on console.error to ensure no logging happens
      const consoleErrorSpy = vi.spyOn(console, 'error');

      vi.mocked(fs.readdirSync).mockImplementation(() => {
        throw new Error('Test error');
      });

      const result = getChannelProjectContext(mockChannelId, mockWorkingDirectory);

      expect(result).toBeNull();
      expect(consoleErrorSpy).not.toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    it('should handle project without Google Drive Folder ID', () => {
      vi.mocked(fs.readdirSync).mockReturnValue([
        'appQlKIvpxd6byC5H-ImFX___OLA_Project_Managment',
      ] as unknown as fs.Dirent<Buffer>[]);
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const mockProjectsData = {
        table: { id: 'tbldgctJFcunQ1ZgM' },
        records: [
          {
            id: 'recXYZ123',
            fields: {
              'Name': 'Test Project',
              'Slack Channel ID': mockChannelId,
              // No Google Drive Folder ID
            },
          },
        ],
      };
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockProjectsData));

      const result = getChannelProjectContext(mockChannelId, mockWorkingDirectory);

      expect(result).not.toBeNull();
      expect(result).toContain('<channel-project>');
      expect(result).toContain('<project-name>Test Project</project-name>');
      expect(result).toContain('<airtable-project-id>recXYZ123</airtable-project-id>');
      expect(result).not.toContain('<google-drive-folder>');
      expect(result).toContain('</channel-project>');
    });

    it('should find the correct snapshot directory matching the glob pattern', () => {
      // Return multiple directories, only one matching the pattern
      vi.mocked(fs.readdirSync).mockReturnValue([
        'some-other-directory',
        'appQlKIvpxd6byC5H-ImFX___OLA_Project_Managment',
        'another-dir',
      ] as unknown as fs.Dirent<Buffer>[]);
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const mockProjectsData = {
        table: { id: 'tbldgctJFcunQ1ZgM' },
        records: [
          {
            id: 'recXYZ123',
            fields: {
              'Name': 'Test Project',
              'Slack Channel ID': mockChannelId,
            },
          },
        ],
      };
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockProjectsData));

      const result = getChannelProjectContext(mockChannelId, mockWorkingDirectory);

      expect(result).not.toBeNull();
      expect(result).toContain('Test Project');
    });

    it('should return null when no matching snapshot directory exists', () => {
      vi.mocked(fs.readdirSync).mockReturnValue([
        'some-other-directory',
        'another-dir',
      ] as unknown as fs.Dirent<Buffer>[]);

      const result = getChannelProjectContext(mockChannelId, mockWorkingDirectory);

      expect(result).toBeNull();
    });
  });
});
