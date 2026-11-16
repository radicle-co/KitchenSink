// @vitest-environment node
/**
 * Unit tests for the pure parts of `scripts/worktreeAdd.mjs`: the install key, the prune decision and the parse of
 * `git worktree list --porcelain`. The add flow itself is `tests/worktreeAdd.integration.test.ts`.
 *
 * The prune decision deletes a developer's installs, so the cases that matter are the ones that must NOT delete: the
 * newest three, and any install whose lockfile a live worktree still has.
 */
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { installsToPrune, lockfileHash, worktreePaths } from '../../../../scripts/worktreeAdd.mjs';

const install = (hash: string, mtimeMs: number) => ({ hash, mtimeMs });

describe('lockfileHash', () => {
    it('is the sha256 hex of the lockfile bytes', () => {
        expect(lockfileHash(Buffer.from('{"lockfileVersion":3}'))).toBe(
            createHash('sha256').update('{"lockfileVersion":3}').digest('hex'),
        );
    });

    it('differs when one byte differs', () => {
        expect(lockfileHash(Buffer.from('a'))).not.toBe(lockfileHash(Buffer.from('b')));
    });
});

describe('installsToPrune', () => {
    const five = [install('a', 5), install('b', 4), install('c', 3), install('d', 2), install('e', 1)];

    it('keeps the newest three by modification time and deletes the rest', () => {
        expect(installsToPrune(five, 3, new Set())).toEqual(['d', 'e']);
    });

    it('orders by time, not by the order given', () => {
        expect(installsToPrune([...five].reverse(), 3, new Set())).toEqual(['d', 'e']);
    });

    it('never deletes an install a current worktree`s lockfile hashes to', () => {
        expect(installsToPrune(five, 3, new Set(['e']))).toEqual(['d']);
    });

    it('deletes nothing when there are no more than the limit', () => {
        expect(installsToPrune(five.slice(0, 3), 3, new Set())).toEqual([]);
    });

    it('keeps a protected install without letting it use up a kept slot', () => {
        expect(installsToPrune(five, 3, new Set(['a', 'b', 'c', 'd', 'e']))).toEqual([]);
    });
});

describe('worktreePaths', () => {
    it('reads every worktree path from `git worktree list --porcelain`', () => {
        const porcelain = [
            'worktree /repo',
            'HEAD abc',
            'branch refs/heads/main',
            '',
            'worktree /repo wt/with space',
            'HEAD def',
            'detached',
            '',
        ].join('\n');

        expect(worktreePaths(porcelain)).toEqual(['/repo', '/repo wt/with space']);
    });
});
