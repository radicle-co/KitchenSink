/**
 * The duration table the lanes are balanced by, and the split of the listed tests across lanes.
 */
import { readFileSync } from 'node:fs';

import { packLanes } from '@kitchensink/e2e-plan/packLanes';
import { z } from 'zod';

import { DURATIONS_FILE } from './e2ePaths';
import { flattenReport, type PlaywrightReport, type ReportedTest } from './e2eReport';
import { testListText } from './e2eSelection';

/** What a test with no recorded duration is assumed to take when the table is empty too. */
const FALLBACK_TEST_MS = 3000;

/**
 * The middle duration of a table: what a test that is not in it is assumed to take.
 *
 * @param table - Duration per test id, in milliseconds.
 * @returns The median, or a fixed fallback for an empty table.
 */
export function medianMs(table: Readonly<Record<string, number>>): number {
    const sorted = Object.values(table).sort((a, b) => a - b);

    return sorted[Math.floor(sorted.length / 2)] ?? FALLBACK_TEST_MS;
}

/**
 * The duration table from run reports: each test's time averaged over the reports, retries included, `setup` left out.
 *
 * @param reports - Merged or single-run JSON reports.
 * @returns Whole milliseconds per test id, keys sorted so the committed file diffs cleanly.
 */
export function durationTable(reports: readonly PlaywrightReport[]): Record<string, number> {
    const seen = new Map<string, number[]>();

    for (const test of reports.flatMap((entry) => flattenReport(entry))) {
        if (test.project !== 'setup') {
            seen.set(test.id, [...(seen.get(test.id) ?? []), test.durationMs]);
        }
    }

    return Object.fromEntries(
        [...seen.entries()]
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([id, all]) => [id, Math.round(all.reduce((sum, ms) => sum + ms, 0) / all.length)]),
    );
}

/**
 * Splits the listed tests into one `--test-list` text per lane, balanced by recorded duration.
 *
 * `setup` is not packed: Playwright runs it in every lane that holds a test needing the shared session.
 *
 * @param tests - The tests of a `--list` report.
 * @param durations - The committed duration table.
 * @param laneCount - How many lanes the planner allows; fewer come back when there are fewer tests.
 * @param defaultMs - The assumed duration of a test with no recorded one.
 * @returns A list text per lane, their estimated durations, and the ids that had no recorded duration.
 */
export function laneLists(
    tests: readonly ReportedTest[],
    durations: Readonly<Record<string, number>>,
    laneCount: number,
    defaultMs: number,
): {
    readonly texts: readonly string[];
    readonly estimateMs: readonly number[];
    readonly defaulted: readonly string[];
} {
    const own = tests.filter((test) => test.project !== 'setup');
    const packing = packLanes({ ids: own.map((test) => test.id), durations, laneCount, defaultMs });

    return {
        texts: packing.lanes.map((ids) => testListText(own.filter((test) => ids.includes(test.id)))),
        estimateMs: packing.estimateMs,
        defaulted: packing.defaulted,
    };
}

/** @sideEffect Reads the table; an absent or unreadable one is an empty table, so the lanes balance by count. */
export function loadDurations(): Record<string, number> {
    try {
        return z.record(z.string(), z.number()).parse(JSON.parse(readFileSync(DURATIONS_FILE, 'utf8')));
    } catch {
        return {};
    }
}
