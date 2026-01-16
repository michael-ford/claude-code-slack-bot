#!/usr/bin/env tsx
/**
 * submit_weekly_update.ts
 *
 * CLI script for submitting weekly updates to Airtable.
 * Called by Claude during weekly sync collection after user confirms their report.
 *
 * Usage: npm run submit-update -- --person-id "recXXX" --week-start "2026-01-13" --report '{...}'
 *
 * Output (stdout):
 * { "success": true, "weeklyUpdateId": "recZZZ", "segmentIds": ["rec1", "rec2"] }
 * or
 * { "success": false, "error": "error message" }
 */

// ============================================================================
// CRITICAL: Suppress ALL console output before any imports
// This prevents config.ts and dotenv from polluting stdout
// ============================================================================
const originalStdoutWrite = process.stdout.write.bind(process.stdout);
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

// Suppress everything except our explicit output
console.log = () => {};
console.warn = () => {};
console.error = () => {};

// Track our own output to allow it through
let allowOutput = false;

const suppressedStdoutWrite = (
  chunk: string | Uint8Array,
  encodingOrCallback?: BufferEncoding | ((err?: Error) => void),
  callback?: (err?: Error) => void
): boolean => {
  if (allowOutput) {
    return originalStdoutWrite(chunk, encodingOrCallback as BufferEncoding, callback);
  }
  // Silently ignore other output
  if (typeof encodingOrCallback === 'function') {
    encodingOrCallback();
  } else if (callback) {
    callback();
  }
  return true;
};

process.stdout.write = suppressedStdoutWrite as typeof process.stdout.write;

// Now import dependencies (their console output will be suppressed)
import Airtable from 'airtable';
import type { FieldSet, Record as AirtableRecord, Records } from 'airtable';

// ============================================================================
// Types
// ============================================================================

interface ProjectInput {
  projectId: string;
  projectName: string;
  workedOn: string[];
  comingUp: string[];
  blockers: string[];
  questions: string[];
}

interface SubmitUpdateInput {
  personId: string;
  weekStart: string;
  projects: ProjectInput[];
}

interface SubmitUpdateOutput {
  success: boolean;
  weeklyUpdateId?: string;
  segmentIds?: string[];
  error?: string;
}

interface UpdateSegment {
  projectId: string;
  projectName: string;
  content: string;
  workedOn: string[];
  comingUp: string[];
  blockers: string[];
  questions: string[];
  confidence: number;
}

// ============================================================================
// Output Helpers
// ============================================================================

function output(data: SubmitUpdateOutput): void {
  allowOutput = true;
  originalStdoutWrite(JSON.stringify(data) + '\n');
  allowOutput = false;
}

function outputSuccess(weeklyUpdateId: string, segmentIds: string[]): void {
  output({
    success: true,
    weeklyUpdateId,
    segmentIds,
  });
}

function outputError(message: string): void {
  // Only sanitize actual credential values, not the words themselves
  const sanitized = message
    .replace(/apiKey[:\s]+"[^"]+"/gi, 'apiKey: [REDACTED]')
    .replace(/token[:\s]+"[^"]+"/gi, 'token: [REDACTED]')
    .replace(/secret[:\s]+"[^"]+"/gi, 'secret: [REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/pat[A-Za-z0-9._-]{20,}/gi, '[REDACTED]');

  output({
    success: false,
    error: sanitized,
  });
}

// ============================================================================
// Argument Parsing
// ============================================================================

function parseArgs(): { personId: string | null; weekStart: string | null; report: string | null } {
  const args = process.argv.slice(2);
  let personId: string | null = null;
  let weekStart: string | null = null;
  let report: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--person-id' && i + 1 < args.length) {
      personId = args[i + 1];
      i++;
    } else if (args[i] === '--week-start' && i + 1 < args.length) {
      weekStart = args[i + 1];
      i++;
    } else if (args[i] === '--report' && i + 1 < args.length) {
      report = args[i + 1];
      i++;
    }
  }

  return { personId, weekStart, report };
}

// ============================================================================
// Validation
// ============================================================================

function validateDateFormat(dateStr: string): boolean {
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(dateStr)) {
    return false;
  }
  const date = new Date(dateStr);
  return !isNaN(date.getTime());
}

function validateProject(project: unknown, index: number): string | null {
  if (!project || typeof project !== 'object') {
    return `Project at index ${index} is not an object`;
  }

  const p = project as Record<string, unknown>;

  if (typeof p.projectId !== 'string' || !p.projectId) {
    return `Project at index ${index} is missing projectId`;
  }

  if (!p.projectId.match(/^rec[A-Za-z0-9]{14,17}$/)) {
    return `Project at index ${index} has invalid projectId format (expected Airtable record ID)`;
  }

  if (typeof p.projectName !== 'string' || !p.projectName) {
    return `Project at index ${index} is missing projectName`;
  }

  if (!Array.isArray(p.workedOn)) {
    return `Project at index ${index} is missing workedOn array`;
  }

  if (!Array.isArray(p.comingUp)) {
    return `Project at index ${index} is missing comingUp array`;
  }

  if (!Array.isArray(p.blockers)) {
    return `Project at index ${index} is missing blockers array`;
  }

  if (!Array.isArray(p.questions)) {
    return `Project at index ${index} is missing questions array`;
  }

  return null;
}

function validateInput(input: unknown): { valid: true; data: SubmitUpdateInput } | { valid: false; error: string } {
  if (!input || typeof input !== 'object') {
    return { valid: false, error: 'Input must be an object' };
  }

  const data = input as Record<string, unknown>;

  if (!Array.isArray(data.projects)) {
    return { valid: false, error: 'Missing projects array' };
  }

  if (data.projects.length === 0) {
    return { valid: false, error: 'Projects array cannot be empty' };
  }

  for (let i = 0; i < data.projects.length; i++) {
    const error = validateProject(data.projects[i], i);
    if (error) {
      return { valid: false, error };
    }
  }

  return { valid: true, data: data as unknown as SubmitUpdateInput };
}

// ============================================================================
// Airtable Client (inline to avoid config import)
// ============================================================================

const BATCH_SIZE = 10;
const MAX_RETRIES = 3;
const RATE_LIMIT_RETRY_DELAY = 30000;

const TABLES = {
  WEEKLY_UPDATES: 'Weekly Updates',
  UPDATE_SEGMENTS: 'Update Segments',
} as const;

class SimpleAirtableClient {
  private base: Airtable.Base;

  constructor(token: string, baseId: string) {
    this.base = new Airtable({ apiKey: token }).base(baseId);
  }

  private async withRetry<T>(operation: () => Promise<T>, timeoutMs: number = 30000): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        // Add timeout wrapper
        const result = await Promise.race([
          operation(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Operation timed out after ' + timeoutMs + 'ms')), timeoutMs)
          )
        ]);
        return result;
      } catch (error) {
        lastError = error as Error;
        if (this.isRateLimitError(error)) {
          await this.sleep(RATE_LIMIT_RETRY_DELAY);
          continue;
        }
        throw error;
      }
    }

    throw lastError || new Error('Max retries exceeded');
  }

  private isRateLimitError(error: unknown): boolean {
    if (error && typeof error === 'object') {
      const err = error as { statusCode?: number; error?: string };
      return err.statusCode === 429 || err.error === 'RATE_LIMIT_REACHED';
    }
    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async createWeeklyUpdate(data: {
    weekStart: string;
    personId: string;
    syncCycleId: string;
    dmStatus: string;
  }): Promise<string> {
    const fields = {
      'Week Start': data.weekStart,
      Person: [{ id: data.personId }],
      'Response Status': 'Pending',
      'DM Status': data.dmStatus,
      'Parsing Status': 'Pending',
      'Sync Cycle ID': data.syncCycleId,
      'Created At': new Date().toISOString(),
    };

    const record = await this.withRetry(() =>
      this.base(TABLES.WEEKLY_UPDATES).create(fields as unknown as FieldSet)
    );

    return record.id;
  }

  async updateWeeklyUpdateResponse(
    recordId: string,
    response: string,
    _slackTs: string,
    isLate: boolean = false
  ): Promise<void> {
    await this.withRetry(() =>
      this.base(TABLES.WEEKLY_UPDATES).update(recordId, {
        'Raw Response': response,
        'Submitted At': new Date().toISOString(),
        'Response Status': isLate ? 'Late' : 'Submitted',
      } as Partial<FieldSet>)
    );
  }

  async updateWeeklyUpdateParsingStatus(
    recordId: string,
    status: string
  ): Promise<void> {
    await this.withRetry(() =>
      this.base(TABLES.WEEKLY_UPDATES).update(recordId, {
        'Parsing Status': status,
      } as Partial<FieldSet>)
    );
  }

  async createUpdateSegments(
    weeklyUpdateId: string,
    segments: UpdateSegment[]
  ): Promise<string[]> {
    if (segments.length === 0) {
      return [];
    }

    const recordsToCreate = segments.map((segment) => ({
      fields: {
        'Weekly Update': [{ id: weeklyUpdateId }],
        Project: [{ id: segment.projectId }],
        Content: segment.content,
        'Worked On': JSON.stringify(segment.workedOn),
        'Coming Up': JSON.stringify(segment.comingUp),
        Blockers: JSON.stringify(segment.blockers),
        Questions: JSON.stringify(segment.questions),
        'Confidence Score': Math.round(segment.confidence * 100),
        'Posted To Channel': false,
      },
    }));

    const createdIds: string[] = [];

    for (let i = 0; i < recordsToCreate.length; i += BATCH_SIZE) {
      const batch = recordsToCreate.slice(i, i + BATCH_SIZE);
      const created = await this.withRetry(async () => {
        const result = await this.base(TABLES.UPDATE_SEGMENTS).create(
          batch as unknown as Partial<FieldSet>[]
        );
        return result as unknown as Records<FieldSet>;
      });

      if (Array.isArray(created)) {
        createdIds.push(...created.map((r: AirtableRecord<FieldSet>) => r.id));
      } else {
        createdIds.push((created as unknown as AirtableRecord<FieldSet>).id);
      }
    }

    return createdIds;
  }
}

// ============================================================================
// Formatters
// ============================================================================

function formatSection(parts: string[], label: string, items: string[]): void {
  if (items.length === 0) {
    return;
  }
  parts.push(`**${label}:**`);
  for (const item of items) {
    parts.push(`- ${item}`);
  }
  parts.push('');
}

function formatRawResponse(projects: ProjectInput[]): string {
  const parts: string[] = [];

  for (const project of projects) {
    parts.push(`## ${project.projectName}`);
    parts.push('');
    formatSection(parts, 'Worked On', project.workedOn);
    formatSection(parts, 'Coming Up', project.comingUp);
    formatSection(parts, 'Blockers', project.blockers);
    formatSection(parts, 'Questions', project.questions);
  }

  return parts.join('\n');
}

function formatProjectContent(project: ProjectInput): string {
  const sections: Array<{ label: string; items: string[] }> = [
    { label: 'Worked on', items: project.workedOn },
    { label: 'Coming up', items: project.comingUp },
    { label: 'Blockers', items: project.blockers },
    { label: 'Questions', items: project.questions },
  ];

  return sections
    .filter((section) => section.items.length > 0)
    .map((section) => `${section.label}: ${section.items.join(', ')}`)
    .join('\n');
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const { personId, weekStart, report } = parseArgs();

  if (!personId) {
    outputError('Missing required argument: --person-id');
    process.exit(1);
  }

  if (!personId.match(/^rec[A-Za-z0-9]{14,17}$/)) {
    outputError('Invalid person-id format. Expected Airtable record ID (e.g., recXXXXXXXXXXXXXX).');
    process.exit(1);
  }

  if (!weekStart) {
    outputError('Missing required argument: --week-start');
    process.exit(1);
  }

  if (!report) {
    outputError('Missing required argument: --report');
    process.exit(1);
  }

  if (!validateDateFormat(weekStart)) {
    outputError('Invalid date format for --week-start. Expected YYYY-MM-DD format.');
    process.exit(1);
  }

  let parsedReport: unknown;
  try {
    parsedReport = JSON.parse(report);
  } catch {
    outputError('Failed to parse --report JSON. Please provide valid JSON.');
    process.exit(1);
  }

  const validation = validateInput(parsedReport);
  if (!validation.valid) {
    outputError(validation.error);
    process.exit(1);
  }

  const input = validation.data;

  // Get Airtable config from environment
  const airtableToken = process.env.AIRTABLE_TOKEN;
  const airtableBaseId = process.env.AIRTABLE_BASE_ID;

  if (!airtableToken || !airtableBaseId) {
    outputError('Airtable configuration missing. Set AIRTABLE_TOKEN and AIRTABLE_BASE_ID environment variables.');
    process.exit(1);
  }

  const client = new SimpleAirtableClient(airtableToken, airtableBaseId);

  // Use 'cli' prefix to distinguish manual/Claude-initiated submissions from
  // automated Friday DM flow. This allows tracking submission source.
  const syncCycleId = `sync-${weekStart}-cli-${Date.now()}`;

  try {
    const weeklyUpdateId = await client.createWeeklyUpdate({
      weekStart,
      personId,
      syncCycleId,
      dmStatus: 'Sent',
    });

    const rawResponse = formatRawResponse(input.projects);
    await client.updateWeeklyUpdateResponse(weeklyUpdateId, rawResponse, '', false);

    const segments: UpdateSegment[] = input.projects.map((project) => ({
      projectId: project.projectId,
      projectName: project.projectName,
      content: formatProjectContent(project),
      workedOn: project.workedOn,
      comingUp: project.comingUp,
      blockers: project.blockers,
      questions: project.questions,
      confidence: 1.0,
    }));

    const segmentIds = await client.createUpdateSegments(weeklyUpdateId, segments);

    await client.updateWeeklyUpdateParsingStatus(weeklyUpdateId, 'Parsed');

    outputSuccess(weeklyUpdateId, segmentIds);
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    outputError(`Airtable API error: ${message}`);
    process.exit(1);
  }
}

main();
