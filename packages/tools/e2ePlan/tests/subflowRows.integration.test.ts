/**
 * The helper flows that branch, over the real tree. A helper with a row of its own is opaque to the branching check, so
 * its row must be complete: the guard reads what a static read can see, and the sign-in helpers must have rows.
 */
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadSubflowEntries } from '../src/narrowFlowRowsRepo.js';
import { registeredMobileScreens } from '../src/registeredMobileScreens.js';
import { subflowRowViolations } from '../src/subflowRows.js';

const repo = resolve(import.meta.dirname, '../../../..');

describe('the rowed helper flows', () => {
    it('give the sign-in helpers rows of their own, so a flow that signs in does not branch because of them', () => {
        const { rowed } = loadSubflowEntries(repo);

        for (const helper of [
            'auth/signinHome',
            'auth/signOutIfSignedIn',
            'auth/dismissSavePassword',
            'auth/launchCleared',
        ]) {
            expect(rowed.has(helper), `${helper} has no row`).toBe(true);
        }
    });

    it('have rows that hold what a static read finds them reaching', async () => {
        const { entries } = loadSubflowEntries(repo);

        expect(entries.length).toBeGreaterThan(3);
        expect(subflowRowViolations(entries, await registeredMobileScreens(repo))).toEqual([]);
    });
});
