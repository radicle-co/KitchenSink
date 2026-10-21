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
 *  - the build goes through `ecrPushUnlessBuilt.sh`, which asks `ecrPushVerdict.sh` first, so an image already built is
 *    never rebuilt.
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
    readonly uses?: string;
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

    // `--require-clean` proves the tree is the revision only BEFORE anything writes to it, so the key step is the step
    // right after checkout: a build or an install ahead of it would make the check pass over a tree it then changes.
    it('runs immediately after the checkout, before any step can write to the tree', () => {
        const index = all.findIndex((step) => step.id === 'content');

        expect(index).toBeGreaterThan(0);
        expect(all[index - 1]?.uses ?? '').toMatch(/^actions\/checkout@/u);
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

    // `ecrPushUnlessBuilt.sh` asks the verdict, builds only on `push`, and asks again after a failed push, so a run that
    // races another to the same immutable tag succeeds on the image the other pushed.
    it('builds through ecrPushUnlessBuilt.sh, which asks the push verdict first', () => {
        const build = all.find((step) => (step.run ?? '').includes('docker buildx build'));
        const body = build?.run ?? '';

        expect(body).toMatch(
            /bash \.github\/scripts\/ecrPushUnlessBuilt\.sh kitchensink-identity "\$\{IMAGE_TAG\}" \\\s+docker buildx build /u,
        );
        expect(body).not.toContain('ecrPushVerdict.sh');
    });
});

/**
 * THE PER-STACK GATE (ADR-0067): a leg that runs judges each stack against what is deployed (`stackCurrency.sh`) and
 * deploys only the STALE ones. Before this, every running leg deployed every stack: run 39627231419 updated all 10
 * global stacks, the VPC, the NAT instance and the RDS instance among them, for a change to none of them.
 *
 * Each app's currency step must judge EXACTLY what its deploy would deploy: the same `--app` string, the same stack
 * list (`deployGate.sh stacks-for`, the one authority), and the same environment, or it would compare a template the
 * deploy never builds. A dispatch or a Sandbox Up call (any event but `pull_request`) is forced and deploys everything.
 */
describe('sandbox-identity-deploy.yml deploys only the stacks that changed', () => {
    const FORCED = "${{ github.event_name != 'pull_request' }}";
    const byId = (id: string): Step | undefined => all.find((step) => step.id === id);
    const byName = (name: string): Step | undefined => all.find((step) => step.name === name);
    const appOf = (run: string | undefined): string => /--app "([^"]+)"/u.exec(String(run ?? ''))?.[1] ?? '<none>';
    const ifOf = (step: Step | undefined): string => String((step as { if?: string } | undefined)?.if ?? '');

    const apps = [
        {
            currency: 'global-currency',
            entry: 'packages/infra/global/bin/app.ts',
            deploy: 'CDK Deploy (global infra)',
        },
        {
            currency: 'identity-currency',
            entry: 'packages/services/identity/infra/bin/app.ts',
            deploy: 'CDK Deploy (identity service)',
        },
        {
            currency: 'webhooks-currency',
            entry: 'packages/services/identity-webhooks/infra/bin/app.ts',
            deploy: 'CDK Deploy (identity-webhooks)',
        },
    ] as const;

    it.each(apps)('$currency judges the stacks $deploy would deploy', ({ currency, entry, deploy }) => {
        const gate = byId(currency);
        const body = String(gate?.run ?? '');

        expect(body).toContain(`deployGate.sh stacks-for ${entry}`);
        expect(body).toContain('stackCurrency.sh evaluate');
        expect(body).toContain(`"${appOf(byName(deploy)?.run)}"`);
        expect(gate?.env?.['FORCED']).toBe(FORCED);
    });

    it.each(apps)('$currency synthesizes with the environment $deploy uses', ({ currency, deploy }) => {
        const deployEnv = { ...byName(deploy)?.env };

        delete deployEnv['STALE'];

        for (const [name, value] of Object.entries(deployEnv)) {
            expect(byId(currency)?.env?.[name], name).toBe(value);
        }
    });

    it('deploys only the stale global stacks, and only when one is stale', () => {
        const deploy = byName('CDK Deploy (global infra)');

        expect(ifOf(deploy)).toContain("steps.global-currency.outputs.stale != ''");
        expect(deploy?.env?.['STALE']).toBe('${{ steps.global-currency.outputs.stale }}');
        expect(String(deploy?.run)).toContain('--exclusively ${STALE}');
        expect(String(deploy?.run)).not.toContain('--all');
    });

    // `contains` over an ARRAY matches whole elements, so one stack name inside another cannot match, and no whitespace
    // has to survive `$GITHUB_OUTPUT`. `|| '[]'` keeps `fromJSON` from failing on a judge that did not run.
    it('deploys the identity schema and the service each only when that stack is stale', () => {
        const schema = byName('CDK Deploy (identity schema — before anything reads it)');
        const service = byName('CDK Deploy (identity service)');

        expect(ifOf(schema)).toContain(
            "contains(fromJSON(steps.identity-currency.outputs.stale_json || '[]'), format('kitchensink-identity-schema-{0}', env.STAGE))",
        );
        expect(ifOf(service)).toContain(
            "contains(fromJSON(steps.identity-currency.outputs.stale_json || '[]'), format('kitchensink-identity-service-{0}', env.STAGE))",
        );
        expect(ifOf(schema) + ifOf(service)).not.toContain('stale_names');
        expect(String(service?.run)).toContain('"kitchensink-identity-service-${STAGE}" --exclusively');
        expect(String(service?.run)).not.toContain('--all');
    });

    it('deploys only the stale webhooks stacks, and only when one is stale', () => {
        const deploy = byName('CDK Deploy (identity-webhooks)');

        expect(ifOf(deploy)).toContain("steps.webhooks-currency.outputs.stale != ''");
        expect(deploy?.env?.['STALE']).toBe('${{ steps.webhooks-currency.outputs.stale }}');
        expect(String(deploy?.run)).toContain('--exclusively ${STALE}');
        expect(String(deploy?.run)).not.toContain('--all');
    });

    it('still runs the migrations on every run while the sandbox is up (ADR-0035), whatever the gate says', () => {
        expect(ifOf(byName('Run identity DB migrations (before the service that reads them)'))).toBe(
            "steps.tier.outputs.up == 'true'",
        );
    });
});
