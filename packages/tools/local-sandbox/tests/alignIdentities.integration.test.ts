/**
 * `bin/alignIdentities.ts` as a process. A bad `LOCAL_SANDBOX_PORT` is one R9 refusal line and exit 1, the line every
 * other door prints, and never a stack trace. A unit test of `stackOrRefusal` cannot see that this door asks it.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from '../bin/adapters.js';

describe('alignIdentities.ts with a port the stack cannot use', () => {
    it('prints the refusal line and exits 1, with no stack trace', () => {
        const result = spawnSync(path.join(REPO_ROOT, 'node_modules/.bin/tsx'), ['bin/alignIdentities.ts'], {
            cwd: path.join(REPO_ROOT, 'packages/tools/local-sandbox'),
            encoding: 'utf8',
            env: { ...process.env, CLERK_SECRET_KEY: 'sk_test_unused', LOCAL_SANDBOX_PORT: '80' },
        });

        expect(result.status).toBe(1);
        expect(result.stderr.trim()).toMatch(
            /^alignIdentities refused: LOCAL_SANDBOX_PORT=80 moves .+\. Pick another value/u,
        );
        expect(result.stderr).not.toContain('    at ');
    });
});
