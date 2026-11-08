/**
 * The facts `narrowRows` reads from the real tree: which flows branch, and which screens the sign-in flows supply.
 * Wrong facts here would narrow a row the rule meant to keep, so they are checked against the flow files themselves.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { narrowRows } from '../src/narrowFlowRows.js';
import { loadNarrowInput } from '../src/narrowFlowRowsRepo.js';

const repo = resolve(import.meta.dirname, '../../../..');
const FLOWS = 'packages/apps/commise/mobile/.maestro';
const { input } = loadNarrowInput(repo, new Map(), new Map());
const hasWhen = (id: string): boolean => /^\s*when:/mu.test(readFileSync(`${repo}/${FLOWS}/${id}.yaml`, 'utf8'));

describe('the facts read from the tree', () => {
    it('marks a flow as branching exactly when its own file has a when:', () => {
        const topLevel = [...input.table.keys()].filter((id) => !input.subflows.has(id));

        expect(topLevel.length).toBeGreaterThan(50);

        for (const id of topLevel) {
            expect(input.branching.has(id), id).toBe(hasWhen(id));
        }

        expect(topLevel.some((id) => input.branching.has(id))).toBe(true);
        expect(topLevel.some((id) => !input.branching.has(id))).toBe(true);
    });

    it('treats the two sign-in sub-flows as sub-flows, never as flows to narrow', () => {
        expect(input.subflows).toEqual(new Set(['auth/signin', 'auth/signinHome']));
    });

    it('lets a flow that signs in keep the screens the sign-in flow supplies', () => {
        const signsIn = [...input.table.keys()].find(
            (id) => !input.subflows.has(id) && input.suppliedBySubflows(id).has('login'),
        );

        expect(signsIn).toBeDefined();
        expect(input.suppliedBySubflows(signsIn ?? '').has('HomeScreen')).toBe(true);
    });

    it('removes nothing when no platform has evidence', () => {
        expect(narrowRows(input).removed).toEqual([]);
    });
});
