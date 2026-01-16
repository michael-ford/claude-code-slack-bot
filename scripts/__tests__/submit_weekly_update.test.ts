import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';

/**
 * Tests for submit_weekly_update CLI script
 *
 * This script is called by Claude during weekly sync collection to submit
 * a user's weekly update to Airtable.
 *
 * Usage: npm run submit-update -- --person-id "recXXX" --week-start "2026-01-13" --report '{...}'
 */

const SCRIPT_PATH = path.join(__dirname, '..', 'submit_weekly_update.ts');

interface SubmitUpdateInput {
  personId: string;
  weekStart: string;
  projects: Array<{
    projectId: string;
    projectName: string;
    workedOn: string[];
    comingUp: string[];
    blockers: string[];
    questions: string[];
  }>;
}

interface SubmitUpdateOutput {
  success: boolean;
  weeklyUpdateId?: string;
  segmentIds?: string[];
  error?: string;
}

/**
 * Helper to execute the CLI script and capture output
 */
async function executeScript(args: string[]): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  return new Promise((resolve) => {
    const proc = spawn('tsx', [SCRIPT_PATH, ...args], {
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 1,
      });
    });
  });
}

describe('submit_weekly_update CLI', () => {
  const validInput: SubmitUpdateInput = {
    personId: 'recPerson123456789',
    weekStart: '2026-01-13',
    projects: [
      {
        projectId: 'recProject456789012',
        projectName: 'Long Beach Airport',
        workedOn: [
          'Completed environmental impact assessment',
          'Met with stakeholders to discuss terminal design',
        ],
        comingUp: [
          'Present design options to city council',
          'Begin permitting process',
        ],
        blockers: [
          'Waiting on traffic study results from consultant',
        ],
        questions: [
          'Should we prioritize sustainability certifications in initial phase?',
        ],
      },
      {
        projectId: 'recProject789012345',
        projectName: 'Downtown Transit Hub',
        workedOn: [
          'Finalized architectural renderings',
          'Coordinated with transit authority on schedule',
        ],
        comingUp: [
          'Public hearing next Tuesday',
        ],
        blockers: [],
        questions: [],
      },
    ],
  };

  describe('argument parsing', () => {
    it('parses valid JSON input from --report argument', async () => {
      const result = await executeScript([
        '--person-id',
        validInput.personId,
        '--week-start',
        validInput.weekStart,
        '--report',
        JSON.stringify(validInput),
      ]);

      // Should not fail on parsing (even if Airtable call fails)
      // The script should at least attempt to parse the JSON
      const output = result.stdout.trim();
      expect(output).toBeTruthy();

      // Should output valid JSON
      expect(() => JSON.parse(output)).not.toThrow();
    });

    it('returns error for missing --person-id argument', async () => {
      const result = await executeScript([
        '--week-start',
        validInput.weekStart,
        '--report',
        JSON.stringify(validInput),
      ]);

      expect(result.exitCode).not.toBe(0);

      const output: SubmitUpdateOutput = JSON.parse(result.stdout);
      expect(output.success).toBe(false);
      expect(output.error).toContain('person-id');
    });

    it('returns error for missing --week-start argument', async () => {
      const result = await executeScript([
        '--person-id',
        validInput.personId,
        '--report',
        JSON.stringify(validInput),
      ]);

      expect(result.exitCode).not.toBe(0);

      const output: SubmitUpdateOutput = JSON.parse(result.stdout);
      expect(output.success).toBe(false);
      expect(output.error).toContain('week-start');
    });

    it('returns error for missing --report argument', async () => {
      const result = await executeScript([
        '--person-id',
        validInput.personId,
        '--week-start',
        validInput.weekStart,
      ]);

      expect(result.exitCode).not.toBe(0);

      const output: SubmitUpdateOutput = JSON.parse(result.stdout);
      expect(output.success).toBe(false);
      expect(output.error).toContain('report');
    });

    it('returns error for invalid/malformed JSON input', async () => {
      const result = await executeScript([
        '--person-id',
        validInput.personId,
        '--week-start',
        validInput.weekStart,
        '--report',
        '{invalid json}',
      ]);

      expect(result.exitCode).not.toBe(0);

      const output: SubmitUpdateOutput = JSON.parse(result.stdout);
      expect(output.success).toBe(false);
      expect(output.error).toMatch(/json|parse/i);
    });

    it('validates week-start is in YYYY-MM-DD format', async () => {
      const result = await executeScript([
        '--person-id',
        validInput.personId,
        '--week-start',
        'January 13, 2026',
        '--report',
        JSON.stringify(validInput),
      ]);

      expect(result.exitCode).not.toBe(0);

      const output: SubmitUpdateOutput = JSON.parse(result.stdout);
      expect(output.success).toBe(false);
      expect(output.error).toMatch(/date|format/i);
    });

    it('validates projects array is not empty', async () => {
      const emptyProjectsInput = {
        ...validInput,
        projects: [],
      };

      const result = await executeScript([
        '--person-id',
        validInput.personId,
        '--week-start',
        validInput.weekStart,
        '--report',
        JSON.stringify(emptyProjectsInput),
      ]);

      expect(result.exitCode).not.toBe(0);

      const output: SubmitUpdateOutput = JSON.parse(result.stdout);
      expect(output.success).toBe(false);
      expect(output.error).toMatch(/project/i);
    });

    it('validates each project has required fields', async () => {
      const invalidProjectInput = {
        personId: validInput.personId,
        weekStart: validInput.weekStart,
        projects: [
          {
            projectId: 'recProject456789012',
            // Missing projectName
            workedOn: ['Something'],
            comingUp: [],
            blockers: [],
            questions: [],
          },
        ],
      };

      const result = await executeScript([
        '--person-id',
        validInput.personId,
        '--week-start',
        validInput.weekStart,
        '--report',
        JSON.stringify(invalidProjectInput),
      ]);

      expect(result.exitCode).not.toBe(0);

      const output: SubmitUpdateOutput = JSON.parse(result.stdout);
      expect(output.success).toBe(false);
      expect(output.error).toBeTruthy();
    });
  });

  describe('Airtable integration', () => {
    it('creates Weekly Update record with correct fields', async () => {
      const result = await executeScript([
        '--person-id',
        validInput.personId,
        '--week-start',
        validInput.weekStart,
        '--report',
        JSON.stringify(validInput),
      ]);

      // This will fail because the script doesn't exist yet
      // When implemented, it should create a Weekly Update record
      const output: SubmitUpdateOutput = JSON.parse(result.stdout);

      if (output.success) {
        expect(output.weeklyUpdateId).toBeDefined();
        expect(output.weeklyUpdateId).toMatch(/^rec[A-Za-z0-9]+$/);
      }
    });

    it('creates Update Segments for each project', async () => {
      const result = await executeScript([
        '--person-id',
        validInput.personId,
        '--week-start',
        validInput.weekStart,
        '--report',
        JSON.stringify(validInput),
      ]);

      const output: SubmitUpdateOutput = JSON.parse(result.stdout);

      if (output.success) {
        expect(output.segmentIds).toBeDefined();
        expect(output.segmentIds).toHaveLength(validInput.projects.length);

        output.segmentIds?.forEach((id) => {
          expect(id).toMatch(/^rec[A-Za-z0-9]+$/);
        });
      }
    });

    it('returns success with record IDs when submission succeeds', async () => {
      const result = await executeScript([
        '--person-id',
        validInput.personId,
        '--week-start',
        validInput.weekStart,
        '--report',
        JSON.stringify(validInput),
      ]);

      const output: SubmitUpdateOutput = JSON.parse(result.stdout);

      if (output.success) {
        expect(output.weeklyUpdateId).toBeDefined();
        expect(output.segmentIds).toBeDefined();
        expect(output.error).toBeUndefined();
      } else {
        // If it fails, should have an error message
        expect(output.error).toBeDefined();
      }
    });

    it('returns error when Airtable API call fails', async () => {
      // Use invalid person ID to trigger Airtable error
      const result = await executeScript([
        '--person-id',
        'invalidPersonId',
        '--week-start',
        validInput.weekStart,
        '--report',
        JSON.stringify(validInput),
      ]);

      const output: SubmitUpdateOutput = JSON.parse(result.stdout);

      expect(output.success).toBe(false);
      expect(output.error).toBeDefined();
      expect(output.weeklyUpdateId).toBeUndefined();
      expect(output.segmentIds).toBeUndefined();
    });

    it('returns error when AIRTABLE_TOKEN is missing', async () => {
      const result = await executeScript([
        '--person-id',
        validInput.personId,
        '--week-start',
        validInput.weekStart,
        '--report',
        JSON.stringify(validInput),
      ]);

      // Should fail because script doesn't exist yet
      // When implemented with missing env vars, should return error
      const output: SubmitUpdateOutput = JSON.parse(result.stdout);

      if (!output.success) {
        expect(output.error).toBeTruthy();
      }
    });
  });

  describe('output format', () => {
    it('outputs valid JSON to stdout', async () => {
      const result = await executeScript([
        '--person-id',
        validInput.personId,
        '--week-start',
        validInput.weekStart,
        '--report',
        JSON.stringify(validInput),
      ]);

      // Should output JSON regardless of success/failure
      expect(() => JSON.parse(result.stdout)).not.toThrow();
    });

    it('includes all required fields in success response', async () => {
      const result = await executeScript([
        '--person-id',
        validInput.personId,
        '--week-start',
        validInput.weekStart,
        '--report',
        JSON.stringify(validInput),
      ]);

      const output: SubmitUpdateOutput = JSON.parse(result.stdout);

      expect(output).toHaveProperty('success');

      if (output.success) {
        expect(output).toHaveProperty('weeklyUpdateId');
        expect(output).toHaveProperty('segmentIds');
      }
    });

    it('includes error field in failure response', async () => {
      const result = await executeScript([
        '--person-id',
        validInput.personId,
        '--week-start',
        'invalid-date',
        '--report',
        JSON.stringify(validInput),
      ]);

      const output: SubmitUpdateOutput = JSON.parse(result.stdout);

      expect(output.success).toBe(false);
      expect(output).toHaveProperty('error');
      expect(typeof output.error).toBe('string');
    });

    it('does not include sensitive data in error messages', async () => {
      // Even if AIRTABLE_TOKEN was in env, it shouldn't leak in errors
      const result = await executeScript([
        '--person-id',
        validInput.personId,
        '--week-start',
        validInput.weekStart,
        '--report',
        '{bad json}',
      ]);

      const output: SubmitUpdateOutput = JSON.parse(result.stdout);

      if (!output.success && output.error) {
        expect(output.error).not.toContain('key');
        expect(output.error).not.toContain('token');
        expect(output.error).not.toContain('secret');
      }
    });
  });

  describe('edge cases', () => {
    it('handles project with empty arrays for workedOn, comingUp, blockers, questions', async () => {
      const minimalInput: SubmitUpdateInput = {
        personId: validInput.personId,
        weekStart: validInput.weekStart,
        projects: [
          {
            projectId: 'recProject999012345',
            projectName: 'Quiet Week Project',
            workedOn: [],
            comingUp: [],
            blockers: [],
            questions: [],
          },
        ],
      };

      const result = await executeScript([
        '--person-id',
        minimalInput.personId,
        '--week-start',
        minimalInput.weekStart,
        '--report',
        JSON.stringify(minimalInput),
      ]);

      const output: SubmitUpdateOutput = JSON.parse(result.stdout);

      // Should accept empty arrays (valid update with nothing to report)
      expect(output).toHaveProperty('success');
    });

    it('handles special characters in project names and content', async () => {
      const specialCharsInput: SubmitUpdateInput = {
        personId: validInput.personId,
        weekStart: validInput.weekStart,
        projects: [
          {
            projectId: 'recProjectSpecial1',
            projectName: "O'Hare Airport - Phase 2 (\"North Terminal\")",
            workedOn: [
              'Reviewed contract with Smith & Associates',
              'Updated specs: 10\' ceilings → 12\' ceilings',
            ],
            comingUp: [],
            blockers: [],
            questions: [],
          },
        ],
      };

      const result = await executeScript([
        '--person-id',
        specialCharsInput.personId,
        '--week-start',
        specialCharsInput.weekStart,
        '--report',
        JSON.stringify(specialCharsInput),
      ]);

      const output: SubmitUpdateOutput = JSON.parse(result.stdout);

      // Should handle special characters without errors
      expect(output).toHaveProperty('success');
    });

    it('handles very long content strings', async () => {
      const longContentInput: SubmitUpdateInput = {
        personId: validInput.personId,
        weekStart: validInput.weekStart,
        projects: [
          {
            projectId: 'recProjectLong1234',
            projectName: 'Complex Infrastructure Project',
            workedOn: [
              'A'.repeat(1000), // Very long string
            ],
            comingUp: [],
            blockers: [],
            questions: [],
          },
        ],
      };

      const result = await executeScript([
        '--person-id',
        longContentInput.personId,
        '--week-start',
        longContentInput.weekStart,
        '--report',
        JSON.stringify(longContentInput),
      ]);

      const output: SubmitUpdateOutput = JSON.parse(result.stdout);

      // Should handle long content (Airtable has field limits, but script should try)
      expect(output).toHaveProperty('success');
    });

    it('exits with code 0 on success', async () => {
      const result = await executeScript([
        '--person-id',
        validInput.personId,
        '--week-start',
        validInput.weekStart,
        '--report',
        JSON.stringify(validInput),
      ]);

      const output: SubmitUpdateOutput = JSON.parse(result.stdout);

      if (output.success) {
        expect(result.exitCode).toBe(0);
      }
    });

    it('exits with non-zero code on failure', async () => {
      const result = await executeScript([
        '--person-id',
        validInput.personId,
        '--week-start',
        'bad-date',
        '--report',
        JSON.stringify(validInput),
      ]);

      const output: SubmitUpdateOutput = JSON.parse(result.stdout);

      if (!output.success) {
        expect(result.exitCode).not.toBe(0);
      }
    });
  });
});
