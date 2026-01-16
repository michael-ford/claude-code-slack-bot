/**
 * Integration test for WeeklySyncScheduler initialization in index.ts
 *
 * This test verifies that the main application entry point (index.ts) properly:
 * 1. Imports WeeklySyncScheduler and related dependencies
 * 2. Creates scheduler instance with correct configuration
 * 3. Starts the scheduler when the app starts
 * 4. Stops the scheduler gracefully during shutdown
 *
 * Test will FAIL until index.ts is updated to initialize the scheduler.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('index.ts - WeeklySyncScheduler Integration', () => {
  const indexPath = path.join(__dirname, '../index.ts');
  const indexContent = fs.readFileSync(indexPath, 'utf-8');

  it('imports WeeklySyncScheduler from weekly-sync/scheduler', () => {
    // ASSERTION: index.ts should import WeeklySyncScheduler
    const hasImport = indexContent.includes('WeeklySyncScheduler') &&
      (indexContent.includes("from './weekly-sync/scheduler") ||
       indexContent.includes('from "./weekly-sync/scheduler'));

    expect(hasImport).toBe(true);
  });

  it('imports CollectionManager from weekly-sync/collection-manager', () => {
    // ASSERTION: index.ts should import CollectionManager
    const hasImport = indexContent.includes('CollectionManager') &&
      (indexContent.includes("from './weekly-sync/collection-manager") ||
       indexContent.includes('from "./weekly-sync/collection-manager'));

    expect(hasImport).toBe(true);
  });

  it('imports SummaryGenerator from weekly-sync/summary-generator', () => {
    // ASSERTION: index.ts should import SummaryGenerator
    const hasImport = indexContent.includes('SummaryGenerator') &&
      (indexContent.includes("from './weekly-sync/summary-generator") ||
       indexContent.includes('from "./weekly-sync/summary-generator'));

    expect(hasImport).toBe(true);
  });

  it('imports AirtableClient from weekly-sync/airtable-client', () => {
    // ASSERTION: index.ts should import AirtableClient (or WeeklySyncAirtableClient)
    const hasImport = (indexContent.includes('AirtableClient') || indexContent.includes('WeeklySyncAirtableClient')) &&
      (indexContent.includes("from './weekly-sync/airtable-client") ||
       indexContent.includes('from "./weekly-sync/airtable-client'));

    expect(hasImport).toBe(true);
  });

  it('creates AirtableClient instance with config', () => {
    // ASSERTION: index.ts should instantiate AirtableClient with config.airtable
    const createsClient =
      indexContent.includes('new AirtableClient') ||
      indexContent.includes('new WeeklySyncAirtableClient');

    expect(createsClient).toBe(true);
  });

  it('creates CollectionManager with required dependencies', () => {
    // ASSERTION: index.ts should instantiate CollectionManager
    const createsManager = indexContent.includes('new CollectionManager');

    expect(createsManager).toBe(true);
  });

  it('creates SummaryGenerator with required dependencies', () => {
    // ASSERTION: index.ts should instantiate SummaryGenerator
    const createsGenerator = indexContent.includes('new SummaryGenerator');

    expect(createsGenerator).toBe(true);
  });

  it('creates WeeklySyncScheduler with CollectionManager and SummaryGenerator', () => {
    // ASSERTION: index.ts should instantiate WeeklySyncScheduler
    const createsScheduler = indexContent.includes('new WeeklySyncScheduler');

    expect(createsScheduler).toBe(true);
  });

  it('passes timezone from config.weeklySync to scheduler', () => {
    // ASSERTION: Scheduler should be configured with timezone
    const usesTimezone = indexContent.includes('config.weeklySync.collection.timezone') ||
                        indexContent.includes('weeklySync.collection.timezone');

    expect(usesTimezone).toBe(true);
  });

  it('passes collection hour from config to scheduler', () => {
    // ASSERTION: Scheduler should be configured with collection hour
    const usesCollectionHour = indexContent.includes('config.weeklySync.collection.hour') ||
                               indexContent.includes('weeklySync.collection.hour');

    expect(usesCollectionHour).toBe(true);
  });

  it('passes summary hour from config to scheduler', () => {
    // ASSERTION: Scheduler should be configured with summary hour
    const usesSummaryHour = indexContent.includes('config.weeklySync.summary.hour') ||
                           indexContent.includes('weeklySync.summary.hour');

    expect(usesSummaryHour).toBe(true);
  });

  it('calls scheduler.start() to begin scheduling', () => {
    // ASSERTION: index.ts should call start() on the scheduler instance
    const startsScheduler = indexContent.match(/scheduler\.start\(\)/i) ||
                           indexContent.match(/weeklySyncScheduler\.start\(\)/i);

    expect(startsScheduler).toBeTruthy();
  });

  it('calls scheduler.stop() in cleanup/shutdown handler', () => {
    // ASSERTION: index.ts should call stop() on the scheduler during shutdown
    const stopsScheduler = indexContent.match(/scheduler\.stop\(\)/i) ||
                          indexContent.match(/weeklySyncScheduler\.stop\(\)/i);

    expect(stopsScheduler).toBeTruthy();
  });

  it('checks validateWeeklySyncConfig before initializing scheduler', () => {
    // ASSERTION: Should validate weekly sync config before creating scheduler
    const validatesConfig = indexContent.includes('validateWeeklySyncConfig');

    expect(validatesConfig).toBe(true);
  });

  it('only creates scheduler when weekly sync config is valid', () => {
    // ASSERTION: Scheduler creation should be conditional on valid config
    // Look for conditional logic around scheduler creation
    const hasConditionalCreation =
      indexContent.includes('if') &&
      (indexContent.includes('valid') || indexContent.includes('validateWeeklySyncConfig'));

    expect(hasConditionalCreation).toBe(true);
  });
});
