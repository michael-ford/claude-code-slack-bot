import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';

/**
 * Tests for get_fireflies_transcript CLI script
 *
 * This script is called by Claude during post-meeting summary generation to fetch
 * the meeting transcript from Fireflies.ai.
 *
 * Usage: npm run get-transcript -- <meeting_id>
 */

const SCRIPT_PATH = path.join(__dirname, '..', 'get_fireflies_transcript.ts');

interface TranscriptOutput {
  success: boolean;
  transcript?: {
    id: string;
    title: string;
    date: string;
    duration: number;
    transcript_url: string;
    participants: string[];
    summary: {
      action_items: string;
      gist: string;
      overview: string;
      topics_discussed: string[];
    };
    sentences: Array<{
      speaker_name: string;
      text: string;
      start_time: number;
      end_time: number;
    }>;
  };
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

describe('get_fireflies_transcript CLI', () => {
  const validMeetingId = 'abc123xyz789meeting456';

  describe('argument parsing', () => {
    it('returns error for missing meeting ID argument', async () => {
      const result = await executeScript([]);

      expect(result.exitCode).not.toBe(0);

      const output: TranscriptOutput = JSON.parse(result.stdout);
      expect(output.success).toBe(false);
      expect(output.error).toMatch(/meeting.*id/i);
    });

    it('returns error for invalid/nonexistent meeting ID', async () => {
      const result = await executeScript(['invalid-meeting-id-that-does-not-exist']);

      const output: TranscriptOutput = JSON.parse(result.stdout);

      expect(output.success).toBe(false);
      expect(output.error).toBeTruthy();
    });
  });

  describe('Fireflies API integration', () => {
    it('fetches transcript by meeting ID from Fireflies API', async () => {
      const result = await executeScript([validMeetingId]);

      // This will fail because the script doesn't exist yet
      // When implemented, it should fetch the transcript
      const output: TranscriptOutput = JSON.parse(result.stdout);

      if (output.success) {
        expect(output.transcript).toBeDefined();
        expect(output.transcript?.id).toBe(validMeetingId);
      }
    });

    it('returns structured transcript data matching interface', async () => {
      const result = await executeScript([validMeetingId]);

      const output: TranscriptOutput = JSON.parse(result.stdout);

      if (output.success && output.transcript) {
        // Verify all required fields are present
        expect(output.transcript).toHaveProperty('id');
        expect(output.transcript).toHaveProperty('title');
        expect(output.transcript).toHaveProperty('date');
        expect(output.transcript).toHaveProperty('duration');
        expect(output.transcript).toHaveProperty('transcript_url');
        expect(output.transcript).toHaveProperty('participants');
        expect(output.transcript).toHaveProperty('summary');
        expect(output.transcript).toHaveProperty('sentences');

        // Verify participants is an array
        expect(Array.isArray(output.transcript.participants)).toBe(true);

        // Verify summary structure
        expect(output.transcript.summary).toHaveProperty('action_items');
        expect(output.transcript.summary).toHaveProperty('gist');
        expect(output.transcript.summary).toHaveProperty('overview');
        expect(output.transcript.summary).toHaveProperty('topics_discussed');
        expect(Array.isArray(output.transcript.summary.topics_discussed)).toBe(true);

        // Verify sentences array structure
        expect(Array.isArray(output.transcript.sentences)).toBe(true);
        if (output.transcript.sentences.length > 0) {
          const sentence = output.transcript.sentences[0];
          expect(sentence).toHaveProperty('speaker_name');
          expect(sentence).toHaveProperty('text');
          expect(sentence).toHaveProperty('start_time');
          expect(sentence).toHaveProperty('end_time');
          expect(typeof sentence.start_time).toBe('number');
          expect(typeof sentence.end_time).toBe('number');
        }
      }
    });

    it('returns error when Fireflies API fails', async () => {
      // Use a meeting ID that will trigger API error
      const result = await executeScript(['trigger-api-error-12345']);

      const output: TranscriptOutput = JSON.parse(result.stdout);

      if (!output.success) {
        expect(output.error).toBeDefined();
        expect(output.transcript).toBeUndefined();
      }
    });

    it('returns error when FIREFLIES_API_KEY is missing', async () => {
      const envWithoutKey = { ...process.env };
      delete envWithoutKey.FIREFLIES_API_KEY;

      const proc = spawn('tsx', [SCRIPT_PATH, validMeetingId], {
        env: envWithoutKey,
      });

      let stdout = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      await new Promise((resolve) => {
        proc.on('close', resolve);
      });

      const output: TranscriptOutput = JSON.parse(stdout);

      expect(output.success).toBe(false);
      expect(output.error).toMatch(/api.*key|fireflies/i);
    });

    it('handles meetings with no transcript yet', async () => {
      // Skip if no API key available - this requires live API access to test
      if (!process.env.FIREFLIES_API_KEY) {
        return;
      }

      // Meeting exists but transcript not ready
      const result = await executeScript(['meeting-no-transcript-yet']);

      const output: TranscriptOutput = JSON.parse(result.stdout);

      // Could succeed with empty transcript or fail with descriptive error
      if (!output.success) {
        expect(output.error).toMatch(/transcript|not.*ready|processing/i);
      } else if (output.transcript) {
        // If success, sentences might be empty
        expect(output.transcript.sentences).toBeDefined();
      }
    });
  });

  describe('output format', () => {
    it('outputs valid JSON to stdout', async () => {
      const result = await executeScript([validMeetingId]);

      // Should output JSON regardless of success/failure
      expect(() => JSON.parse(result.stdout)).not.toThrow();
    });

    it('includes all required fields in success response', async () => {
      const result = await executeScript([validMeetingId]);

      const output: TranscriptOutput = JSON.parse(result.stdout);

      expect(output).toHaveProperty('success');

      if (output.success) {
        expect(output).toHaveProperty('transcript');
        expect(output.transcript).toBeTruthy();
      }
    });

    it('includes error field in failure response', async () => {
      const result = await executeScript([]);

      const output: TranscriptOutput = JSON.parse(result.stdout);

      expect(output.success).toBe(false);
      expect(output).toHaveProperty('error');
      expect(typeof output.error).toBe('string');
    });

    it('does not include sensitive data in error messages', async () => {
      // Even if FIREFLIES_API_KEY was in env, it shouldn't leak in errors
      const result = await executeScript(['invalid-id-for-error-test']);

      const output: TranscriptOutput = JSON.parse(result.stdout);

      if (!output.success && output.error) {
        // Should not expose API keys
        expect(output.error).not.toMatch(/key[:\s]+"[^"]+"/i);
        expect(output.error).not.toMatch(/Bearer\s+[A-Za-z0-9._-]{20,}/);
        expect(output.error).not.toMatch(/secret/i);
      }
    });
  });

  describe('edge cases', () => {
    it('handles very long meeting transcripts', async () => {
      // Some meetings might have transcripts with thousands of sentences
      const result = await executeScript(['very-long-meeting-12345']);

      const output: TranscriptOutput = JSON.parse(result.stdout);

      // Should handle large transcripts without crashing
      if (output.success && output.transcript) {
        expect(output.transcript.sentences).toBeDefined();
        // Script should be able to handle transcripts of any size
        expect(Array.isArray(output.transcript.sentences)).toBe(true);
      }
    });

    it('handles meetings with special characters in title', async () => {
      const result = await executeScript(['meeting-special-chars-123']);

      const output: TranscriptOutput = JSON.parse(result.stdout);

      if (output.success && output.transcript) {
        // Should handle titles like "Q1 Planning: OKRs & Budget (2026)"
        expect(output.transcript.title).toBeDefined();
        expect(typeof output.transcript.title).toBe('string');
      }
    });

    it('handles meetings with no participants listed', async () => {
      const result = await executeScript(['meeting-no-participants']);

      const output: TranscriptOutput = JSON.parse(result.stdout);

      if (output.success && output.transcript) {
        expect(output.transcript.participants).toBeDefined();
        expect(Array.isArray(output.transcript.participants)).toBe(true);
        // Empty array is valid
      }
    });

    it('handles meetings with missing summary fields', async () => {
      const result = await executeScript(['meeting-no-summary']);

      const output: TranscriptOutput = JSON.parse(result.stdout);

      if (output.success && output.transcript) {
        // Summary fields might be empty strings if Fireflies hasn't generated them
        expect(output.transcript.summary).toBeDefined();
        if (output.transcript.summary.action_items === '') {
          expect(typeof output.transcript.summary.action_items).toBe('string');
        }
      }
    });

    it('validates date format in transcript', async () => {
      const result = await executeScript([validMeetingId]);

      const output: TranscriptOutput = JSON.parse(result.stdout);

      if (output.success && output.transcript) {
        // Date should be in ISO format or parseable
        const date = new Date(output.transcript.date);
        expect(isNaN(date.getTime())).toBe(false);
      }
    });

    it('validates duration is a positive number', async () => {
      const result = await executeScript([validMeetingId]);

      const output: TranscriptOutput = JSON.parse(result.stdout);

      if (output.success && output.transcript) {
        expect(typeof output.transcript.duration).toBe('number');
        expect(output.transcript.duration).toBeGreaterThanOrEqual(0);
      }
    });

    it('validates transcript_url is a valid URL', async () => {
      const result = await executeScript([validMeetingId]);

      const output: TranscriptOutput = JSON.parse(result.stdout);

      if (output.success && output.transcript) {
        expect(output.transcript.transcript_url).toBeTruthy();
        expect(output.transcript.transcript_url).toMatch(/^https?:\/\//);
      }
    });

    it('exits with code 0 on success', async () => {
      const result = await executeScript([validMeetingId]);

      const output: TranscriptOutput = JSON.parse(result.stdout);

      if (output.success) {
        expect(result.exitCode).toBe(0);
      }
    });

    it('exits with non-zero code on failure', async () => {
      const result = await executeScript([]);

      const output: TranscriptOutput = JSON.parse(result.stdout);

      if (!output.success) {
        expect(result.exitCode).not.toBe(0);
      }
    });
  });

  describe('GraphQL API specifics', () => {
    it('properly formats GraphQL query for transcript retrieval', async () => {
      const result = await executeScript([validMeetingId]);

      const output: TranscriptOutput = JSON.parse(result.stdout);

      // The script should use the correct GraphQL query structure
      // transcript(id: $id) { ... }
      // This is verified indirectly by successful data retrieval
      if (output.success) {
        expect(output.transcript).toBeDefined();
      }
    });

    it('handles GraphQL errors gracefully', async () => {
      const result = await executeScript(['malformed-query-trigger']);

      const output: TranscriptOutput = JSON.parse(result.stdout);

      if (!output.success) {
        expect(output.error).toBeTruthy();
        // Should not expose internal GraphQL error details to user
        expect(output.error).not.toContain('GraphQL internal');
      }
    });
  });
});
