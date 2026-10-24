/**
 * `ecrPushUnlessBuilt.sh`: build and push an image only when `ecrPushVerdict.sh` says so, and survive a race to push
 * the same immutable tag (ADR-0067, slice 1 review, should-fix 2).
 *
 * Two runs that compute the same content key (a Sandbox Up call and a pull-request push, which are in different
 * concurrency groups) can both hear `push`. The second push to an immutable tag then fails. When the verdict, asked
 * again after the failure, says `skip`, the image these inputs build is there and the run succeeds. Any other answer
 * keeps the build's own failure. The script never matches the registry's error text, which buildx does not promise.
 *
 * DESIGN PATTERN: Test double (a recording fake `aws` and a fake build command on PATH) over the script for real.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';

const SCRIPT = path.join(repoRoot, '.github/scripts/ecrPushUnlessBuilt.sh');
const CONTENT_TAG = `ck-${'cd'.repeat(32)}`;

/** `describe-images` answers from a list, one entry per call: the first ask, then the ask after a failed build. */
const FAKE_AWS = `#!/usr/bin/env bash
echo "aws $*" >> "$FAKE_LOG"
case "$1 $2" in
    "ecr describe-images")
        n=$(grep -c 'describe-images' "$FAKE_LOG")
        answer=$(echo "$FAKE_IMAGES" | cut -d' ' -f"$n")
        case "\${answer:-absent}" in
            present) echo '{"imageDetails":[{"imageDigest":"sha256:abc"}]}' ;;
            absent) echo 'An error occurred (ImageNotFoundException)' >&2; exit 254 ;;
            *) echo 'An error occurred (AccessDeniedException)' >&2; exit 254 ;;
        esac
        ;;
    "ecr describe-repositories")
        echo '{"repositories":[{"imageTagMutability":"IMMUTABLE_WITH_EXCLUSION","imageTagMutabilityExclusionFilters":[{"filterType":"WILDCARD","filter":"sandbox-*"}]}]}'
        ;;
esac
exit 0
`;

const FAKE_BUILD = `#!/usr/bin/env bash
echo "build $*" >> "$FAKE_LOG"
exit "\${FAKE_BUILD_EXIT:-0}"
`;

interface Run {
    readonly status: number | null;
    readonly stdout: string;
    readonly stderr: string;
    readonly calls: readonly string[];
}

function push(images: string, buildExit: number, args: readonly string[] = ['kitchensink-identity', CONTENT_TAG]): Run {
    const dir = mkdtempSync(path.join(tmpdir(), 'ecrPushUnlessBuilt-'));
    const bin = path.join(dir, 'bin');
    const log = path.join(dir, 'calls.log');

    mkdirSync(bin);
    writeFileSync(path.join(bin, 'aws'), FAKE_AWS);
    writeFileSync(path.join(bin, 'fakeBuild'), FAKE_BUILD);
    chmodSync(path.join(bin, 'aws'), 0o755);
    chmodSync(path.join(bin, 'fakeBuild'), 0o755);
    writeFileSync(log, '');

    const result = spawnSync('bash', [SCRIPT, ...args, 'fakeBuild', '--push', '.'], {
        encoding: 'utf8',
        env: {
            PATH: `${bin}:${process.env['PATH'] ?? ''}`,
            FAKE_LOG: log,
            FAKE_IMAGES: images,
            FAKE_BUILD_EXIT: String(buildExit),
        },
    });

    return {
        status: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
        calls: readFileSync(log, 'utf8').split('\n').filter(Boolean),
    };
}

const builds = (run: Run): readonly string[] => run.calls.filter((call) => call.startsWith('build '));

describe('ecrPushUnlessBuilt.sh', () => {
    it('does not build when the image these inputs build is already there', () => {
        const run = push('present', 0);

        expect(run.status, run.stderr).toBe(0);
        expect(builds(run)).toEqual([]);
    });

    it('builds once, passing the command its own arguments, when the image is absent', () => {
        const run = push('absent', 0);

        expect(run.status, run.stderr).toBe(0);
        expect(builds(run)).toEqual(['build --push .']);
    });

    // The race: another run pushed the same content between this run's verdict and its push.
    it('succeeds when the build fails but the verdict, asked again, finds the image built', () => {
        const run = push('absent present', 1);

        expect(run.status, run.stderr).toBe(0);
        expect(builds(run)).toHaveLength(1);
        expect(run.stderr).toContain('another run pushed');
    });

    it('keeps the build failure when the image is still absent after it', () => {
        const run = push('absent absent', 7);

        expect(run.status).toBe(7);
        expect(run.stderr).toContain('::error::');
    });

    it('keeps the build failure when the verdict cannot be asked again', () => {
        const run = push('absent denied', 7);

        expect(run.status).toBe(7);
    });

    it('fails, building nothing, when the first verdict cannot be read', () => {
        const run = push('denied', 0);

        expect(run.status).toBe(1);
        expect(builds(run)).toEqual([]);
    });

    it('refuses to run without a build command', () => {
        const result = spawnSync('bash', [SCRIPT, 'kitchensink-identity', CONTENT_TAG], { encoding: 'utf8' });

        expect(result.status).toBe(2);
    });
});
