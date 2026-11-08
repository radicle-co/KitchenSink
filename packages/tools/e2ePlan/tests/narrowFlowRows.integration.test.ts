/**
 * The facts `narrowRows` reads from the real tree: which flows branch, and which screens the sign-in flows supply.
 * Wrong facts here would narrow a row the rule meant to keep, so they are checked against the flow files themselves.
 */
import { readFileSync } from 'node:fs';
import { posix, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { isBranching } from '../src/branchingFlows.js';
import { flowReferences } from '../src/maestroFlows.js';
import { narrowRows } from '../src/narrowFlowRows.js';
import { loadNarrowInput, loadSubflowEntries } from '../src/narrowFlowRowsRepo.js';

const repo = resolve(import.meta.dirname, '../../../..');
const FLOWS = 'packages/apps/commise/mobile/.maestro';
const { input } = loadNarrowInput(repo, new Map(), new Map());

describe('the facts read from the tree', () => {
    it('marks a flow as branching when its own file does, and not when it runs only helpers that have rows', () => {
        const topLevel = [...input.table.keys()].filter((id) => !input.subflows.has(id));
        const idOfRun = (id: string, reference: string): string =>
            posix
                .normalize(posix.join(posix.dirname(`${FLOWS}/${id}.yaml`), reference))
                .slice(`${FLOWS}/`.length)
                .replace(/\.ya?ml$/u, '');
        let onlyRowedHelpers = 0;

        for (const id of topLevel) {
            const text = readFileSync(`${repo}/${FLOWS}/${id}.yaml`, 'utf8');

            if (isBranching(text)) {
                expect(input.branching.has(id), `${id} branches in its own file`).toBe(true);
            } else if (flowReferences(text).every((reference) => input.subflows.has(idOfRun(id, reference)))) {
                expect(input.branching.has(id), `${id} runs only helpers that have rows`).toBe(false);
                onlyRowedHelpers += 1;
            }
        }

        expect(topLevel.length).toBeGreaterThan(50);
        expect(onlyRowedHelpers).toBeGreaterThan(0);
    });

    it('treats every helper with a row as a sub-flow, never as a flow to narrow', () => {
        expect(input.subflows).toEqual(loadSubflowEntries(repo).rowed);
        expect(input.subflows.has('auth/signinHome')).toBe(true);
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
