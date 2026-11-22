// @vitest-environment node
/**
 * Repo guard: the staging folder of one-off Maestro flows (`maestro:lanes --one-off`) is ignored by git and holds no
 * committed file.
 *
 * The door copies an uncommitted flow into `.maestro/oneOff/<runId>/` for the length of a run. Git ignoring that folder
 * is what keeps the copy out of every list built from `git ls-files` (the flow inventory, the impact selector), and
 * what means the copy can never overwrite or shadow a committed flow. A committed file under it would be deleted by the
 * door's sweep at the start of the next run.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(import.meta.dirname, '../../../..');
const ONE_OFF_ROOT = 'packages/apps/commise/mobile/.maestro/oneOff';

/** Absolute, so the guard does not depend on which `git` a writable PATH folder offers. */
const GIT = '/usr/bin/git';

const git = (...args: string[]): string => execFileSync(GIT, args, { cwd: REPO_ROOT, encoding: 'utf8' });

describe('the one-off flow staging folder', () => {
    it('is ignored by git, at any depth, so a staged flow is never listed or committed by accident', () => {
        const staged = `${ONE_OFF_ROOT}/someRun/shots.yaml`;

        expect(git('check-ignore', '--no-index', staged).trim()).toBe(staged);
    });

    it('holds no committed file, because the door deletes the folder at the start of a run', () => {
        expect(git('ls-files', '--', ONE_OFF_ROOT).trim()).toBe('');
    });
});
