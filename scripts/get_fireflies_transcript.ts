#!/usr/bin/env tsx
/**
 * get_fireflies_transcript.ts
 *
 * CLI script for fetching meeting transcripts from Fireflies.ai.
 * Called by Claude during post-meeting summary generation.
 *
 * Usage: npm run get-transcript -- <meeting_id>
 *
 * Output (stdout):
 * { "success": true, "transcript": {...} }
 * or
 * { "success": false, "error": "error message" }
 */

// ============================================================================
// Types
// ============================================================================

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

interface FirefliesTranscriptResponse {
  data?: {
    transcript?: {
      id: string;
      title: string;
      date: string;
      duration: number;
      transcript_url: string;
      participants: string[];
      summary?: {
        action_items?: string;
        gist?: string;
        overview?: string;
        keywords?: string[];
      };
      sentences?: Array<{
        speaker_name: string;
        text: string;
        start_time: number;
        end_time: number;
      }>;
    };
  };
  errors?: Array<{ message: string }>;
}

// ============================================================================
// Output Helpers
// ============================================================================

function output(data: TranscriptOutput): void {
  process.stdout.write(JSON.stringify(data) + '\n');
}

function outputSuccess(transcript: TranscriptOutput['transcript']): void {
  output({
    success: true,
    transcript,
  });
}

function outputError(message: string): void {
  // Sanitize sensitive data from error messages
  const sanitized = message
    .replace(/apiKey[:\s]+"[^"]+"/gi, 'apiKey: [REDACTED]')
    .replace(/token[:\s]+"[^"]+"/gi, 'token: [REDACTED]')
    .replace(/secret[:\s]+"[^"]+"/gi, 'secret: [REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._-]{20,}/gi, 'Bearer [REDACTED]')
    .replace(/key[:\s]+"[A-Za-z0-9._-]{20,}"/gi, 'key: [REDACTED]');

  output({
    success: false,
    error: sanitized,
  });
}

// ============================================================================
// GraphQL Query
// ============================================================================

const TRANSCRIPT_QUERY = `
query Transcript($transcriptId: String!) {
  transcript(id: $transcriptId) {
    id
    title
    date
    duration
    transcript_url
    participants
    summary {
      action_items
      gist
      overview
      keywords
    }
    sentences {
      speaker_name
      text
      start_time
      end_time
    }
  }
}
`;

// ============================================================================
// Fireflies API Client
// ============================================================================

async function fetchTranscript(
  meetingId: string,
  apiKey: string
): Promise<TranscriptOutput['transcript']> {
  const response = await fetch('https://api.fireflies.ai/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query: TRANSCRIPT_QUERY,
      variables: { transcriptId: meetingId },
    }),
  });

  let result: FirefliesTranscriptResponse;

  try {
    result = (await response.json()) as FirefliesTranscriptResponse;
  } catch (parseError) {
    if (!response.ok) {
      throw new Error(`Failed to retrieve transcript: API returned status ${response.status}`);
    }
    // Provide more context about parse failures
    throw new Error(
      `Failed to retrieve transcript: Invalid response format (status ${response.status})`
    );
  }

  if (!response.ok) {
    // Try to extract error message from response
    if (result.errors && result.errors.length > 0) {
      throw new Error(`Failed to retrieve transcript: ${result.errors[0].message}`);
    }
    throw new Error(`Failed to retrieve transcript: API returned status ${response.status}`);
  }

  if (result.errors && result.errors.length > 0) {
    throw new Error(result.errors[0].message);
  }

  if (!result.data?.transcript) {
    throw new Error('Transcript not found or not ready for processing');
  }

  const t = result.data.transcript;

  // Validate required fields
  if (!t.title || !t.date || !t.transcript_url) {
    throw new Error('Transcript missing required fields (title, date, or URL)');
  }

  // Transform response to match output interface
  return {
    id: t.id,
    title: t.title || '',
    date: t.date || '',
    duration: t.duration || 0,
    transcript_url: t.transcript_url || '',
    participants: t.participants || [],
    summary: {
      action_items: t.summary?.action_items || '',
      gist: t.summary?.gist || '',
      overview: t.summary?.overview || '',
      topics_discussed: t.summary?.keywords || [],
    },
    sentences: (t.sentences || []).map((s) => ({
      speaker_name: s.speaker_name || '',
      text: s.text || '',
      start_time: s.start_time || 0,
      end_time: s.end_time || 0,
    })),
  };
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const meetingId = process.argv[2];

  // Validate meeting ID argument
  if (!meetingId) {
    outputError('Missing required argument: meeting ID');
    process.exit(1);
  }

  // Check for API key
  const apiKey = process.env.FIREFLIES_API_KEY;
  if (!apiKey) {
    outputError('Missing FIREFLIES_API_KEY environment variable');
    process.exit(1);
  }

  try {
    const transcript = await fetchTranscript(meetingId, apiKey);
    outputSuccess(transcript);
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    outputError(`Fireflies API error: ${message}`);
    process.exit(1);
  }
}

main();
