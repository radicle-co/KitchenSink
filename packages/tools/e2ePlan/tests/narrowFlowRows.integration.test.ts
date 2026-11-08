/**
 * The facts `narrowRows` reads from the real tree: which flows branch, and which screens the sign-in flows supply.
 * Wrong facts here would narrow a row the rule meant to keep, so they are checked against the flow files themselves.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { isBranching } from '../src/branchingFlows.js';
import { narrowRows } from '../src/narrowFlowRows.js';
import { loadNarrowInput } from '../src/narrowFlowRowsRepo.js';

const repo = resolve(import.meta.dirname, '../../../..');
const FLOWS = 'packages/apps/commise/mobile/.maestro';
const { input } = loadNarrowInput(repo, new Map(), new Map());

describe('the facts read from the tree', () => {
    it('marks a flow as branching when its own file does, and when a sign-in flow it runs does', () => {
        const topLevel = [...input.table.keys()].filter((id) => !input.subflows.has(id));

        expect(topLevel.length).toBeGreaterThan(50);

        for (const id of topLevel) {
            const text = readFileSync(`${repo}/${FLOWS}/${id}.yaml`, 'utf8');

            if (isBranching(text)) {
                expect(input.branching.has(id), `${id} branches in its own file`).toBe(true);
            }

            // auth/signinHome has a when:, so a flow that runs it branches too (one run takes one branch of the sign-in).
            if (/signinHome\.yaml/u.test(text)) {
                expect(input.branching.has(id), `${id} runs auth/signinHome`).toBe(true);
            }
        }
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
