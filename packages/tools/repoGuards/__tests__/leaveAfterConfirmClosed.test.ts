/**
 * A SCREEN IS LEFT AFTER A DELETE ONLY ONCE THE CONFIRM DIALOG HAS CLOSED.
 *
 * A confirm dialog is a window of its own on native. Leaving its screen while it is still open makes react-native-screens
 * mark the leaving screen's views as transitioning, and Android then cannot move a view out of one: `addViewAt ... The
 * specified child already has a parent`, a process crash. Collection delete hit it first and was fixed with
 * `useLeaveWhenClosed` (the request arms the leave, the close commits, then the leave runs). Recipe delete kept calling
 * `nav.onDeleted()` from the mutation's `onSuccess` and crashed in CI (run 39668114177) and in 1 of 10 local runs of
 * `recipes/delete`.
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
