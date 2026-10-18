// @vitest-environment node
/**
 * `imageTag.sh` and `ecrImagePresent.sh`: the two facts the build job and the deploy job must agree on once the image
 * is no longer built inside the deploy (see `imageBuildOffCriticalPath.test.ts`).
 *
 * - the TAG is one definition, so the stack can never reference a tag the builder did not push;
 * - the deploy refuses to proceed unless that tag exists, and tells "not pushed" apart from "could not read".
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';

const SCRIPTS = path.join(repoRoot, '.github', 'scripts');

describe('imageTag.sh', () => {
    const tag = (...args: string[]) =>
        spawnSync('bash', [path.join(SCRIPTS, 'imageTag.sh'), ...args], { encoding: 'utf8' });

    it.each([
        ['pr-73', 'abc123', 'pr-73-abc123'],
        ['sandbox', 'deadbeef', 'sandbox-deadbeef'],
        ['prod', '0123', 'prod-0123'],
    ])('names %s at %s as %s, and prints nothing else', (stage, sha, expected) => {
        const result = tag(stage, sha);

        expect(result.status).toBe(0);
        expect(result.stdout).toBe(`${expected}\n`);
    });

    it.each([[[]], [['pr-1']], [['', 'sha']], [['pr-1', '']]])('refuses %j with the usage status', (args) => {
        expect(tag(...args).status).toBe(2);
    });
});

describe('ecrImagePresent.sh', () => {
    const FAKE_AWS = `#!/usr/bin/env bash
case "\${FAKE_IMAGE:-absent}" in
    present) echo '{"imageDetails":[{"imageDigest":"sha256:abc"}]}' ;;
    absent) echo 'An error occurred (ImageNotFoundException) when calling the DescribeImages operation' >&2; exit 254 ;;
    *) echo 'An error occurred (AccessDeniedException) when calling the DescribeImages operation' >&2; exit 254 ;;
esac
`;

    const present = (image: string, args: readonly string[] = ['kitchensink-food', 'pr-1-abc']) => {
        const dir = mkdtempSync(path.join(tmpdir(), 'ecrImagePresent-'));

        mkdirSync(path.join(dir, 'bin'));
        writeFileSync(path.join(dir, 'bin', 'aws'), FAKE_AWS);
        chmodSync(path.join(dir, 'bin', 'aws'), 0o755);

        return spawnSync('bash', [path.join(SCRIPTS, 'ecrImagePresent.sh'), ...args], {
            encoding: 'utf8',
            env: { PATH: `${path.join(dir, 'bin')}:${process.env['PATH'] ?? ''}`, FAKE_IMAGE: image },
        });
    };

    it('passes when the tag exists', () => {
        const result = present('present');

        expect(result.status).toBe(0);
        expect(result.stdout).toContain('sha256:abc');
    });

    it('fails, naming the missing tag, when it was not pushed', () => {
        const result = present('absent');

        expect(result.status).toBe(1);
        expect(result.stderr).toContain('kitchensink-food:pr-1-abc does not exist');
    });

    it('fails differently when ECR could not be READ, so an outage is not blamed on the push', () => {
        const result = present('denied');

        expect(result.status).toBe(1);
        expect(result.stderr).toContain('could not read');
        expect(result.stderr).not.toContain('does not exist');
    });

    it('refuses missing arguments with the usage status', () => {
        expect(present('present', ['kitchensink-food']).status).toBe(2);
    });
});
