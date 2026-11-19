/**
 * A container's compose label can name a checkout that no longer exists (a deleted worktree). That is still an owner,
 * so reading the label must not throw.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { canonicalPath } from '../canonicalPath.js';

const roots: string[] = [];

afterEach(() => {
    for (const root of roots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
});

function temp(): string {
    const root = mkdtempSync(path.join(tmpdir(), 'canon-'));
    roots.push(root);

    return realpathSync(root);
}

describe('canonicalPath', () => {
    it('resolves a symlink to its target', () => {
        const root = temp();
        mkdirSync(path.join(root, 'real'));
        symlinkSync(path.join(root, 'real'), path.join(root, 'link'));

        expect(canonicalPath(path.join(root, 'link'))).toBe(path.join(root, 'real'));
    });

    it('answers a path that no longer exists as itself, without throwing', () => {
        const gone = path.join(temp(), 'deleted', 'worktree');

        expect(canonicalPath(gone)).toBe(gone);
    });

    it('resolves the existing part of a missing path through a symlink', () => {
        const root = temp();
        mkdirSync(path.join(root, 'real'));
        symlinkSync(path.join(root, 'real'), path.join(root, 'link'));

        expect(canonicalPath(path.join(root, 'link', 'deleted'))).toBe(path.join(root, 'real', 'deleted'));
    });
});
