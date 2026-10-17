/**
 * The two CloudFormation status lists every teardown and sweep shares (`cfnRestingStates.sh`: stacks to DELETE,
 * `cfnInProgressStates.sh`: stacks a teardown WAITS for) must partition the live statuses cleanly.
 *
 * `REVIEW_IN_PROGRESS` is a stack whose first change set was created and never executed. It holds no resources and can
 * create none, so it is not a deploy to wait for; and CloudFormation keeps it indefinitely, so if the teardown waits
 * on it and never deletes it, every teardown of that PR times out after 1800 s, fails, and records its database drop
 * as owed, forever. The midnight reclaim (`reclaim.ts`, ADR-0061 review N3) already reads it as deletable; the shell
 * lists must agree with it.
 *
 * DESIGN PATTERN: Specification over the real shell arrays, sourced under real bash.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';

const list = (file: string, variable: string): readonly string[] =>
    spawnSync(
        'bash',
        ['-c', `source "${path.join(repoRoot, '.github/scripts', file)}"; printf '%s\\n' "\${${variable}[@]}"`],
        { encoding: 'utf8' },
    )
        .stdout.split('\n')
        .filter((line) => line !== '');

const RESTING = list('cfnRestingStates.sh', 'CFN_RESTING_STATES');
const IN_PROGRESS = list('cfnInProgressStates.sh', 'CFN_IN_PROGRESS_STATES');

describe('the CloudFormation status lists the teardown shares', () => {
    it('are not vacuous', () => {
        expect(RESTING).toContain('UPDATE_ROLLBACK_FAILED');
        expect(IN_PROGRESS).toContain('UPDATE_IN_PROGRESS');
    });

    it('never name one status in both: a stack is waited for or deleted, not both', () => {
        expect(RESTING.filter((state) => IN_PROGRESS.includes(state))).toEqual([]);
    });

    it('treat REVIEW_IN_PROGRESS as deletable, not as a deploy to wait for', () => {
        expect(RESTING).toContain('REVIEW_IN_PROGRESS');
        expect(IN_PROGRESS).not.toContain('REVIEW_IN_PROGRESS');
    });
});
