/**
 * Integration test for Fireflies webhook route wiring in index.ts
 *
 * This test verifies that the main application entry point (index.ts) has:
 * 1. Import for FirefliesHandler from webhooks/fireflies-handler
 * 2. The /webhooks/fireflies route code EXISTS (ready to enable)
 * 3. The route is currently DISABLED (commented out or behind feature flag)
 *
 * Per Phase 7 requirement: Feature should be implemented but DISABLED until
 * Fireflies integration is fully tested and approved.
 *
 * Test will FAIL until index.ts includes the webhook route (in disabled state).
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('index.ts - Fireflies Webhook Integration', () => {
  const indexPath = path.join(__dirname, '../index.ts');
  const indexContent = fs.readFileSync(indexPath, 'utf-8');

  it('imports FirefliesHandler from webhooks/fireflies-handler', () => {
    // ASSERTION: index.ts should import FirefliesHandler
    const hasImport = indexContent.includes('FirefliesHandler') &&
      (indexContent.includes("from './webhooks/fireflies-handler") ||
       indexContent.includes('from "./webhooks/fireflies-handler'));

    expect(hasImport).toBe(true);
  });

  it('imports express types for webhook route', () => {
    // ASSERTION: index.ts should have express types for Request/Response
    // This can be from existing imports or the express import itself
    const hasExpressTypes =
      indexContent.includes('express') ||
      indexContent.includes('Request') ||
      indexContent.includes('Response');

    expect(hasExpressTypes).toBe(true);
  });

  it('creates FirefliesHandler instance with required dependencies', () => {
    // ASSERTION: index.ts should instantiate FirefliesHandler with config
    const createsHandler = indexContent.includes('new FirefliesHandler');

    expect(createsHandler).toBe(true);
  });

  it('passes WeeklySyncAirtableClient to FirefliesHandler', () => {
    // ASSERTION: FirefliesHandler needs airtableClient
    // Look for FirefliesHandler constructor with airtableClient parameter
    const passesAirtableClient =
      indexContent.includes('airtableClient') &&
      indexContent.includes('FirefliesHandler');

    expect(passesAirtableClient).toBe(true);
  });

  it('passes ThreadTracker to FirefliesHandler', () => {
    // ASSERTION: FirefliesHandler needs threadTracker
    const passesThreadTracker =
      indexContent.includes('threadTracker') &&
      indexContent.includes('FirefliesHandler');

    expect(passesThreadTracker).toBe(true);
  });

  it('passes Slack client to FirefliesHandler', () => {
    // ASSERTION: FirefliesHandler needs slackClient
    const passesSlackClient =
      indexContent.includes('slackClient') &&
      indexContent.includes('FirefliesHandler');

    expect(passesSlackClient).toBe(true);
  });

  it('passes working directory to FirefliesHandler', () => {
    // ASSERTION: FirefliesHandler needs workingDirectory
    const passesWorkingDir =
      indexContent.includes('workingDirectory') &&
      indexContent.includes('FirefliesHandler');

    expect(passesWorkingDir).toBe(true);
  });

  it('has webhook route code for /webhooks/fireflies path', () => {
    // ASSERTION: Route code must exist (even if commented out)
    // Look for the route path string
    const hasRouteCode = indexContent.includes('/webhooks/fireflies');

    expect(hasRouteCode).toBe(true);
  });

  it('has app.post handler for the webhook route', () => {
    // ASSERTION: Should have Express POST route definition
    // Even if commented out, the code pattern should exist
    const hasPostHandler =
      indexContent.includes('app.post') &&
      indexContent.includes('/webhooks/fireflies');

    expect(hasPostHandler).toBe(true);
  });

  it('calls firefliesHandler.handleWebhook in route', () => {
    // ASSERTION: Route should call the handler's handleWebhook method
    const callsHandleWebhook =
      indexContent.includes('firefliesHandler.handleWebhook') ||
      indexContent.includes('.handleWebhook(req, res)');

    expect(callsHandleWebhook).toBe(true);
  });

  it('webhook route is currently DISABLED (commented or feature-flagged)', () => {
    // ASSERTION: Route must be disabled for safety
    // Look for comment markers around the route or feature flag check

    // Search for the webhook route definition
    const routeMatch = indexContent.match(/app\.post\(['"]\/webhooks\/fireflies['"][\s\S]*?handleWebhook/);

    if (!routeMatch) {
      // Route doesn't exist at all - fail
      expect(false).toBe(true);
      return;
    }

    const routeCode = routeMatch[0];
    const routeStartIndex = indexContent.indexOf(routeCode);

    // Check if route is commented out
    // Look backwards from route to find comment markers
    const precedingContent = indexContent.substring(Math.max(0, routeStartIndex - 200), routeStartIndex);
    const isCommented =
      precedingContent.includes('//') ||
      precedingContent.includes('/*') ||
      routeCode.includes('//') ||
      routeCode.includes('/*');

    // Check if route is behind a feature flag
    const isFeatureFlagged =
      precedingContent.includes('if') &&
      (precedingContent.includes('FIREFLIES') ||
       precedingContent.includes('WEBHOOK') ||
       precedingContent.includes('FEATURE') ||
       precedingContent.includes('ENABLE') ||
       precedingContent.includes('false'));

    // Route must be either commented OR feature-flagged
    expect(isCommented || isFeatureFlagged).toBe(true);
  });

  it('has express app available in scope (from Slack bolt)', () => {
    // ASSERTION: Need Express app instance to add routes
    // Slack Bolt App doesn't expose Express directly, so this test checks
    // if there's Express integration or custom Express server
    const hasExpressApp =
      indexContent.includes('express()') ||
      indexContent.includes('const app') ||
      indexContent.includes('let app');

    expect(hasExpressApp).toBe(true);
  });
});
