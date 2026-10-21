// @vitest-environment node
/**
 * THE SANDBOX IDENTITY DEPLOY NAMES WHAT IT BUILDS BY CONTENT, NEVER BY COMMIT (ADR-0067).
 *
 * Before this, `sandbox-identity-deploy.yml` tagged the image `sandbox-${{ github.sha }}` and set the webhooks'
 * `SENTRY_RELEASE` to the commit, so EVERY push rebuilt and pushed the image, wrote a new ECS task definition and
 * rolled the service, and changed the webhooks template — even a push that changed nothing identity is built from.
 * Measured on run 39627231419 (a fix to the ingredient parser only): identity-service 303 s of ECS rollout for nothing.
 *
 * So, in that workflow:
 *  - a `content` step computes both keys with `deployKey.sh … --require-clean` and the tag with `imageTag.sh content`;
 *  - no `github.sha` reaches an image tag, `SENTRY_RELEASE`, or a `docker` tag;
 *  - every `IDENTITY_IMAGE_TAG`, the build's `IMAGE_TAG` and the CURRENT smoke's `EXPECTED_IMAGE_TAG` are one value;
 *  - the build asks `ecrPushVerdict.sh` first and pushes only on `push`, so an image already built is never rebuilt.
 *
 * The content step's own bash is RUN, at the repository root, so its outputs are the real keys of HEAD.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { repoRoot } from './serviceSources.js';

const WORKFLOW = path.join(repoRoot, '.github/workflows/sandbox-identity-deploy.yml');

interface Step {
    readonly id?: string;
    readonly name?: string;
    readonly run?: string;
    readonly env?: Readonly<Record<string, string>>;
}

const steps = (source: string): readonly Step[] => {
    const document = parse(source) as { jobs: Record<string, { steps?: Step[] }> };

    return Object.values(document.jobs).flatMap((job) => job.steps ?? []);
};

/** Every env value or `run:` line in which a per-commit value names an image, a release or a docker tag. Pure. */
export function commitNamedArtifacts(source: string): readonly string[] {
    const found: string[] = [];

    for (const step of steps(source)) {
        for (const [name, value] of Object.entries(step.env ?? {})) {
            if (/(IMAGE_TAG|SENTRY_RELEASE)$/u.test(name) && String(value).includes('github.sha')) {
                found.push(`${step.name ?? '?'}: ${name}=${String(value)}`);
            }
        }

        for (const line of String(step.run ?? '').split('\n')) {
            if (/docker\b.*\s-t\s/u.test(line) && line.includes('github.sha')) {
                found.push(`${step.name ?? '?'}: ${line.trim()}`);
            }
        }
    }

    return found;
}

const source = readFileSync(WORKFLOW, 'utf8');
const all = steps(source);

describe('commitNamedArtifacts (the rule, on inline workflows)', () => {
    const workflow = (env: string, run = 'true'): string =>
        `jobs:\n  deploy:\n    steps:\n      - name: s\n        env:\n          ${env}\n        run: ${run}\n`;

    it('refuses a commit in an image tag, a release, or a docker tag', () => {
        expect(commitNamedArtifacts(workflow('IDENTITY_IMAGE_TAG: sandbox-${{ github.sha }}'))).toHaveLength(1);
        expect(commitNamedArtifacts(workflow('SENTRY_RELEASE: ${{ github.sha }}'))).toHaveLength(1);
        expect(
            commitNamedArtifacts(workflow('A: b', 'docker buildx build -t repo:${{ github.sha }} --push .')),
        ).toHaveLength(1);
    });

    it('allows the content key in those places', () => {
        expect(commitNamedArtifacts(workflow('IDENTITY_IMAGE_TAG: ${{ steps.content.outputs.image_tag }}'))).toEqual(
            [],
        );
    });
});

describe('sandbox-identity-deploy.yml names its image and releases by content', () => {
    it('lets no commit name an image tag, a release or a docker tag', () => {
        expect(commitNamedArtifacts(source)).toEqual([]);
    });

    const content = all.find((step) => step.id === 'content');

    it('computes both keys and the tag in one content step, refusing a dirty closure', () => {
        expect(content?.run).toMatch(/deployKey\.sh key identity-service HEAD --require-clean/u);
        expect(content?.run).toMatch(/deployKey\.sh key identity-webhooks HEAD --require-clean/u);
        expect(content?.run).toMatch(/imageTag\.sh content /u);
    });

    it('produces the real keys of HEAD when its bash runs', () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'contentStep-'));
        const output = path.join(dir, 'output');

        try {
            writeFileSync(output, '');
            const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', content?.run ?? 'exit 9'], {
                cwd: repoRoot,
                encoding: 'utf8',
                env: { ...process.env, GITHUB_OUTPUT: output },
            });
            const written = readFileSync(output, 'utf8');
            const expected = spawnSync('bash', ['.github/scripts/deployKey.sh', 'key', 'identity-service', 'HEAD'], {
                cwd: repoRoot,
                encoding: 'utf8',
            }).stdout.trim();

            expect(result.status, result.stderr).toBe(0);
            expect(written).toContain(`image_tag=ck-${expected}\n`);
            expect(written).toMatch(/^webhooks_release=[0-9a-f]{64}$/mu);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('gives every deploy, the build and the CURRENT smoke the same image tag', () => {
        const values = all.flatMap((step) =>
            Object.entries(step.env ?? {})
                .filter(([name]) => /^(IDENTITY_IMAGE_TAG|IMAGE_TAG|EXPECTED_IMAGE_TAG)$/u.test(name))
                .map(([, value]) => String(value)),
        );

        expect(values.length).toBeGreaterThanOrEqual(5);
        expect(new Set(values)).toEqual(new Set(['${{ steps.content.outputs.image_tag }}']));
    });

    it('names the webhooks release by the webhooks key', () => {
        const releases = all.flatMap((step) =>
            Object.entries(step.env ?? {})
                .filter(([name]) => name === 'SENTRY_RELEASE')
                .map(([, value]) => String(value)),
        );

        expect(releases.length).toBeGreaterThanOrEqual(2);
        expect(new Set(releases)).toEqual(new Set(['${{ steps.content.outputs.webhooks_release }}']));
    });

    it('asks the push verdict before building, and builds only on push', () => {
        const build = all.find((step) => (step.run ?? '').includes('docker buildx build'));
        const body = build?.run ?? '';

        expect(body).toMatch(/ecrPushVerdict\.sh kitchensink-identity "\$\{IMAGE_TAG\}"/u);
        expect(body.indexOf('ecrPushVerdict.sh')).toBeLessThan(body.indexOf('docker buildx build'));
        expect(body).toMatch(/if \[ "\$verdict" = push \]; then/u);
    });
});
