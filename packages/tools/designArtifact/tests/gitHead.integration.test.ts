/**
 * The git adapter against the real repository. It runs `git status --porcelain` over the whole work tree, which takes
 * seconds on a cold CI runner, so it lives in this tier and not beside the scripted-git unit tests.
 */
import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from '../src/config.js';
import { execGitHead } from '../src/sources/gitHead.js';

describe('execGitHead', () => {
    it('reads the real repository HEAD', async () => {
        const head = await execGitHead(REPO_ROOT)();

        expect(head.sha).toMatch(/^[0-9a-f]{40}$/u);
        expect(Number.isNaN(Date.parse(head.date))).toBe(false);
        expect(typeof head.dirty).toBe('boolean');
    });
});
