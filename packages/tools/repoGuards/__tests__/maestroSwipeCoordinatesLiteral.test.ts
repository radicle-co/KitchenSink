/**
 * A Maestro `swipe` coordinate is parsed as a point WHEN THE FLOW FILE IS LOADED, so it cannot hold a `${...}`
 * expression: the file fails with `Parsing Failed at ...` before a single step runs.
 *
 * `common/scrollOpenList.yaml` put a ternary in `start:`/`end:` (commit 453e5abb5). In CI run 39062953201 every flow that
 * calls it failed at load, on both platforms: 17 flows, none of which got as far as its first step. Measured with
 * `maestro check-syntax` 2.6.1: a literal `"50%, 35%"` parses, `"50%, ${X ? '35%' : '55%'}"` does not. Pick between two
 * swipes with `runFlow: when: true: ${...}`, which evaluates at run time.
 *
 * The scan reads every `.maestro` flow through a real YAML parser, so a spelling a regex would miss still counts.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { glob } from 'glob';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';

const MAESTRO_DIR = path.join(repoRoot, 'packages/apps/commise/mobile/.maestro');

/** Every `swipe` command's `start`/`end`, wherever it nests (repeat, runFlow, when). */
export function swipeCoordinates(node: unknown): readonly string[] {
    if (Array.isArray(node)) {
        return node.flatMap(swipeCoordinates);
    }
    if (node === null || typeof node !== 'object') {
        return [];
    }
    const record = node as Record<string, unknown>;
    const own: string[] = [];
    const swipe = record['swipe'];
    if (swipe !== null && typeof swipe === 'object') {
        for (const key of ['start', 'end'] as const) {
            const value = (swipe as Record<string, unknown>)[key];
            if (typeof value === 'string') {
                own.push(value);
            }
        }
    }
    return [...own, ...Object.values(record).flatMap(swipeCoordinates)];
}

function flowDocuments(file: string): readonly unknown[] {
    return file
        .split(/^---\s*$/m)
        .slice(1)
        .map((part) => parse(part) as unknown);
}

describe('Maestro swipe coordinates are literal', () => {
    const files = glob.sync('**/*.yaml', { cwd: MAESTRO_DIR, absolute: true });

    it('finds its subjects (non-vacuity)', () => {
        expect(files.length).toBeGreaterThan(20);
        const all = files.flatMap((f) => flowDocuments(readFileSync(f, 'utf8')).flatMap(swipeCoordinates));
        expect(all.length).toBeGreaterThan(0);
    });

    it('detector fires on a nested expression (positive control)', () => {
        const doc = flowDocuments(
            "appId: x\n---\n- repeat:\n    commands:\n      - swipe:\n          start: \"50%, ${A ? '1%' : '2%'}\"\n",
        );
        expect(doc.flatMap(swipeCoordinates).some((c) => c.includes('${'))).toBe(true);
    });

    it.each(glob.sync('**/*.yaml', { cwd: MAESTRO_DIR }).sort())('⛔ %s swipes between literal points', (rel) => {
        const coordinates = flowDocuments(readFileSync(path.join(MAESTRO_DIR, rel), 'utf8')).flatMap(swipeCoordinates);

        expect(coordinates.filter((c) => c.includes('${'))).toEqual([]);
    });
});
