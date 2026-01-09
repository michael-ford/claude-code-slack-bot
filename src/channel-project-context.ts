import * as fs from 'fs';
import * as path from 'path';

interface ProjectRecord {
  id: string;
  fields: {
    Name?: string;
    'Slack Channel ID'?: string;
    'Google Drive Folder ID'?: string;
    [key: string]: unknown;
  };
}

interface ProjectsData {
  table: { id: string };
  records: ProjectRecord[];
}

/**
 * Gets project context for a Slack channel by looking up the channel ID
 * in the Airtable snapshot data.
 *
 * @param channelId - The Slack channel ID (e.g., 'C0123ABCDEF')
 * @param workingDirectory - The working directory containing airtable-snapshots
 * @returns XML-formatted project context or null if no matching project found
 */
export function getChannelProjectContext(
  channelId: string,
  workingDirectory: string
): string | null {
  try {
    // Build path to airtable-snapshots directory
    const snapshotsDir = path.join(workingDirectory, 'airtable-snapshots');

    // Find snapshot directory matching pattern: appQlKIvpxd6byC5H-*
    const entries = fs.readdirSync(snapshotsDir);
    const snapshotDir = entries.find((entry) =>
      entry.startsWith('appQlKIvpxd6byC5H-')
    );

    if (!snapshotDir) {
      return null;
    }

    // Build path to Projects.json in records-simplified
    const projectsPath = path.join(
      snapshotsDir,
      snapshotDir,
      'records-simplified',
      'Projects.json'
    );

    // Check if the file exists
    if (!fs.existsSync(projectsPath)) {
      return null;
    }

    // Read and parse the Projects.json file
    const fileContent = fs.readFileSync(projectsPath, 'utf-8');
    const projectsData: ProjectsData = JSON.parse(fileContent);

    // Find project with matching Slack Channel ID
    const matchingProject = projectsData.records.find(
      (record) => record.fields['Slack Channel ID'] === channelId
    );

    if (!matchingProject) {
      return null;
    }

    // Build XML context
    const lines: string[] = ['<channel-project>'];

    if (matchingProject.fields.Name) {
      lines.push(`  <project-name>${matchingProject.fields.Name}</project-name>`);
    }

    lines.push(`  <airtable-project-id>${matchingProject.id}</airtable-project-id>`);

    if (matchingProject.fields['Google Drive Folder ID']) {
      lines.push(
        `  <google-drive-folder>${matchingProject.fields['Google Drive Folder ID']}</google-drive-folder>`
      );
    }

    lines.push('</channel-project>');

    return lines.join('\n');
  } catch {
    // Return null silently on any error (no logging)
    return null;
  }
}
