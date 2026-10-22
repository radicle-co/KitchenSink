/**
 * A SCREEN IS LEFT AFTER A DELETE ONLY ONCE THE CONFIRM DIALOG HAS CLOSED.
 *
 * Leaving in the same tick as the delete's success restyles the dialog's busy confirm on a screen react-native-screens
 * is already removing; `useLeaveWhenClosed` says why that crashed Android, and why the order still holds now that the
 * shared Button keeps its node. Recipe delete used to call `nav.onDeleted()` from the mutation's `onSuccess` (CI run
 * 39668114177).
 *
 * The rule, over the app packages' source: every `nav.onDeleted` is handed to `useLeaveWhenClosed`, never called.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';

/** Every `nav.onDeleted` in a source text that is not the leave argument of `useLeaveWhenClosed`. Pure. */
export function leavesOutsideTheClose(file: string, source: string): readonly string[] {
    return source
        .split('\n')
        .map((line, index) => ({ line, number: index + 1 }))
        .filter(
            ({ line }) => line.includes('nav.onDeleted') && !/useLeaveWhenClosed\([^)]*nav\.onDeleted\)/u.test(line),
        )
        .map(({ number }) => `${file}:${number}`);
}

describe('leavesOutsideTheClose (the rule, on inline sources)', () => {
    it('refuses a leave called from a mutation', () => {
        expect(
            leavesOutsideTheClose('a.ts', 'deleteRecipe.mutate(id, { onSuccess: () => nav.onDeleted() });\n'),
        ).toEqual(['a.ts:1']);
    });

    it('allows the leave handed to useLeaveWhenClosed', () => {
        expect(
            leavesOutsideTheClose('a.ts', 'useLeaveWhenClosed(del.isSuccess, deleteOpen, nav.onDeleted);\n'),
        ).toEqual([]);
    });
});

describe('the app packages leave after a delete only through useLeaveWhenClosed', () => {
    const files = execFileSync('git', ['ls-files', 'packages/apps/commise/**/*.ts', 'packages/apps/commise/**/*.tsx'], {
        cwd: repoRoot,
        encoding: 'utf8',
    })
        .split('\n')
        .filter((file) => file.length > 0 && !/\/(__tests__|tests)\//u.test(file));
    const uses = files.filter((file) => readFileSync(join(repoRoot, file), 'utf8').includes('nav.onDeleted'));

    it('finds the delete flows', () => {
        expect(uses.length).toBeGreaterThanOrEqual(2);
    });

    it('never calls nav.onDeleted outside useLeaveWhenClosed', () => {
        expect(uses.flatMap((file) => leavesOutsideTheClose(file, readFileSync(join(repoRoot, file), 'utf8')))).toEqual(
            [],
        );
    });
});
