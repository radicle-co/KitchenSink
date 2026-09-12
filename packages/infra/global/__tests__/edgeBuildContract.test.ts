/**
 * The build contract of the Lambda@Edge verifier (ADR-0020 trap 6): the identifiers `esbuild.mjs` substitutes and
 * `handler.ts` declares, the `prod-deploy.yml` steps that supply their values in the right order, and the step that
 * proves the deployed edge answers its `401` with CORS headers (plan 002 C1).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import {
    EDGE_AUTHORIZED_PARTIES_GLOBAL,
    EDGE_JWT_KEY_GLOBAL,
    EDGE_SENTRY_DSN_GLOBAL,
} from '../src/edge-verifier/edgeBuildContract.js';

/** One step of the `Deploy Production` job, as these assertions read it. */
interface DeployStep {
    readonly name?: string;
    readonly if?: string;
    readonly run?: string;
    /** Where the step runs — how a package outside the npm workspace is addressed. */
    readonly 'working-directory'?: string;
}

/**
 * The `Deploy Production` job's steps, in file order.
 *
 * @returns The steps.
 * @sideEffect Reads the workflow.
 */
function prodDeploySteps(): readonly DeployStep[] {
    const doc = parse(
        readFileSync(fileURLToPath(new URL('../../../../.github/workflows/prod-deploy.yml', import.meta.url)), 'utf8'),
    ) as { jobs: Record<string, { steps?: DeployStep[] }> };

    return Object.values(doc.jobs)[0]?.steps ?? [];
}

/** The absolute path of the bundler script. */
const BUNDLER = fileURLToPath(new URL('../esbuild.mjs', import.meta.url));

describe('the build-time key contract cannot be spelled apart', () => {
    it('defines exactly the identifier the handler declares', () => {
        // `esbuild.mjs` is a build script in `.mjs` and `handler.ts` is bundled source; neither can import
        // the other, so the identifier is a contract kept by two files agreeing on a string. A typo is not a
        // build error — it leaves the `declare`d global un-substituted, which is a ReferenceError at the
        // edge, on every request, in production only.
        const bundler = readFileSync(fileURLToPath(new URL('../esbuild.mjs', import.meta.url)), 'utf8');

        // ⚠️ The `define` block became MULTI-LINE when plan U20 compiled the Sentry DSN in beside the key,
        // so the assertion matches the pair rather than the whole single-line literal it used to. The claim
        // is unchanged: this exact identifier is defined, from that exact value.
        expect(bundler).toContain(`${EDGE_JWT_KEY_GLOBAL}: JSON.stringify(edgeJwtKey)`);
    });

    /**
     * ⛔ The SAME contract for the DSN (plan U20) — two files agreeing on a string, with no import between
     * them. ⚠️ And the asymmetry is deliberate: an absent Clerk key is FATAL (a verifier without one rejects
     * every request), while an absent DSN is not (a verifier without one simply reports nothing, exactly as
     * it behaved before). Making the DSN fatal would break every local bundle.
     */
    it('defines the Sentry DSN identifier too, and tolerates its absence', () => {
        const bundler = readFileSync(fileURLToPath(new URL('../esbuild.mjs', import.meta.url)), 'utf8');

        expect(bundler).toContain(`${EDGE_SENTRY_DSN_GLOBAL}: JSON.stringify(`);
        expect(bundler).toMatch(/SENTRY_EDGE_DSN'\] \?\? ''/u);
    });

    /**
     * The authorized parties are compiled in for the same reason the key is, so the edge's `401` admits the origins
     * the origins admit (ADR-0047). The bundler defines them from the TRIMMED value, the value `EdgeStack` checks the
     * bundle against; trimming on one side only would turn a trailing space in SSM into a stale-bundle refusal.
     */
    it('defines the authorized-parties identifier from the trimmed parties', () => {
        const bundler = readFileSync(BUNDLER, 'utf8');

        expect(bundler).toContain(`${EDGE_AUTHORIZED_PARTIES_GLOBAL}: JSON.stringify(edgeAuthorizedParties)`);
        expect(bundler).toMatch(
            /edgeAuthorizedParties = \(process\.env\['CLERK_AUTHORIZED_PARTIES'\] \?\? ''\)\.trim\(\)/u,
        );
    });

    it('declares that same identifier in the handler, and reads nothing from process.env', () => {
        // Lambda@Edge rejects environment variables outright, so a handler that grew a `process.env` read
        // would fail at association time — long after review.
        const handler = readFileSync(
            fileURLToPath(new URL('../src/edge-verifier/handler.ts', import.meta.url)),
            'utf8',
        );
        // Comments are stripped first: the docblock EXPLAINS why `process.env` cannot be used here, so a
        // naive substring check fires on its own rationale.
        const code = handler.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '');

        expect(handler).toContain(`declare const ${EDGE_JWT_KEY_GLOBAL}: string;`);
        expect(handler).toContain(`declare const ${EDGE_AUTHORIZED_PARTIES_GLOBAL}: string;`);
        expect(code).not.toContain('process.env');
    });
});

/**
 * ⛔ A verifier built with the key and no parties would answer every `401` with no `Allow-Origin`, which is the defect
 * this build input exists to end. The bundler refuses BEFORE it bundles anything; with no key it still skips the edge
 * bundle, because sandbox and every local `bundle:lambda` run it with no Clerk key in scope.
 */
describe('esbuild.mjs refuses to build the edge verifier without authorized parties', () => {
    it.each<[string, string | undefined]>([
        ['unset', undefined],
        ['empty', ''],
        ['blank', '   '],
    ])('exits non-zero, naming the variable, when the parties are %s', (_label, parties) => {
        // An empty working directory: a bundler that got past its input check would fail differently (no entry
        // points), and would leave a `dist-lambda/` behind.
        const cwd = mkdtempSync(path.join(tmpdir(), 'edge-bundler-inputs-'));

        try {
            const result = spawnSync(process.execPath, [BUNDLER], {
                cwd,
                encoding: 'utf8',
                env: {
                    PATH: process.env['PATH'] ?? '',
                    CLERK_JWT_KEY: 'a-key',
                    ...(parties === undefined ? {} : { CLERK_AUTHORIZED_PARTIES: parties }),
                },
            });

            expect(result.status).not.toBe(0);
            expect(result.stderr).toContain('CLERK_AUTHORIZED_PARTIES');
            expect(existsSync(path.join(cwd, 'dist-lambda'))).toBe(false);
        } finally {
            rmSync(cwd, { recursive: true, force: true });
        }
    });
});

describe('prod-deploy.yml supplies the build-time key, in the right order', () => {
    const indexOf = (predicate: (run: string) => boolean): number =>
        prodDeploySteps().findIndex((step) => predicate(step.run ?? ''));

    /**
     * The index of the step that bundles the global package's lambda handlers.
     *
     * ⚠️ The package may be named by `working-directory:` rather than inside the command. `infra-global`
     * installs outside the npm workspace so `aws-cdk-lib` never reaches the root tree, which means npm can no
     * longer address it as `--workspace=packages/infra/global` — the step is now a bare `bundle:lambda` run
     * from that directory. Reading `run:` alone returned -1 and failed the ordering assertions below against
     * a workflow that is correctly ordered.
     *
     * @returns The step's index, or -1. Impure (reads the workflow).
     */
    const globalBundleIndex = (): number =>
        prodDeploySteps().findIndex(
            (step) =>
                /bundle:lambda/u.test(step.run ?? '') &&
                /packages\/infra\/global/u.test(`${step.run ?? ''}\n${step['working-directory'] ?? ''}`),
        );

    it('reads the key from SSM rather than carrying a copy in repo configuration', () => {
        // One source of truth: the same parameter the identity, food and recipe task definitions resolve.
        // A GitHub variable would be a second representation of a key that rotates.
        const exporter = prodDeploySteps().find((step) => (step.run ?? '').includes('CLERK_JWT_KEY'));

        expect(exporter?.run).toContain('aws ssm get-parameter');
        expect(exporter?.run).toContain('clerk/jwt-public-key');
    });

    it('exports it BEFORE the bundle step that inlines it', () => {
        // Lambda@Edge cannot read environment variables, so the key is a BUILD-time input. Exported after
        // the bundle, `esbuild.mjs` skips the edge verifier entirely and the synth then fails on a missing
        // bundle — loud, but one deploy wasted for a fixable ordering mistake.
        const exportIndex = indexOf((run) => run.includes('CLERK_JWT_KEY'));
        const bundleIndex = globalBundleIndex();

        expect(exportIndex).toBeGreaterThanOrEqual(0);
        expect(bundleIndex).toBeGreaterThan(exportIndex);
    });

    it('exports it after AWS credentials exist, or the SSM read cannot authenticate', () => {
        const credentialsIndex = prodDeploySteps().findIndex((step) =>
            /Configure AWS credentials/iu.test(step.name ?? ''),
        );

        expect(credentialsIndex).toBeGreaterThanOrEqual(0);
        expect(indexOf((run) => run.includes('CLERK_JWT_KEY'))).toBeGreaterThan(credentialsIndex);
    });

    it('reads the authorized parties from the SSM parameter the origins read, and exports them', () => {
        // `/kitchensink/prod/clerk/authorized-parties` is what `clerkAuthEnvironment` hands every prod origin, so the
        // edge's CORS list and the origins' cannot come from two sources.
        const exporter = prodDeploySteps().find((step) => (step.run ?? '').includes('clerk/authorized-parties'));

        expect(exporter?.run).toContain('aws ssm get-parameter');
        expect(exporter?.run).toContain('CLERK_AUTHORIZED_PARTIES');
    });

    it('exports the parties after AWS credentials exist and BEFORE the bundle step that inlines them', () => {
        const credentialsIndex = prodDeploySteps().findIndex((step) =>
            /Configure AWS credentials/iu.test(step.name ?? ''),
        );
        const exportIndex = indexOf((run) => run.includes('clerk/authorized-parties'));

        expect(credentialsIndex).toBeGreaterThanOrEqual(0);
        expect(exportIndex).toBeGreaterThan(credentialsIndex);
        expect(globalBundleIndex()).toBeGreaterThan(exportIndex);
    });

    it('still bundles before the dev-dependency prune deletes esbuild', () => {
        // The prune is a one-way door: `esbuild` is a devDependency, so a bundle step moved past it dies
        // with exit 127 — the same trap `prodDeployBuildOrder.test.ts` records for `nest build`.
        const bundleIndex = globalBundleIndex();

        expect(indexOf((run) => run.includes('npm prune'))).toBeGreaterThan(bundleIndex);
    });
});

/**
 * The DEPLOYED check (ADR-0032, a DEPLOYED target: prod, no token, writes nothing). A green unit and integration tier
 * proves the code; only a probe of the real distribution proves the version CloudFront serves carries the headers.
 */
describe("prod-deploy.yml proves the deployed edge's 401 carries CORS headers", () => {
    const steps = prodDeploySteps();
    const edgeSmokeIndex = steps.findIndex(
        (step) => /deployedSmoke\.ts/u.test(step.run ?? '') && /--edge-unauthorized-path/u.test(step.run ?? ''),
    );
    const edgeSmoke = steps[edgeSmokeIndex];

    it('runs a smoke that probes the edge without a token', () => {
        expect(edgeSmokeIndex).toBeGreaterThanOrEqual(0);
        expect(edgeSmoke?.run).toContain('--web-origin');
    });

    it('runs it after the global deploy, and only when the global app was deployed', () => {
        const globalDeployIndex = steps.findIndex(
            (step) =>
                /cdk deploy/u.test(step.run ?? '') && /packages\/infra\/global\/bin\/app\.ts/u.test(step.run ?? ''),
        );

        expect(globalDeployIndex).toBeGreaterThanOrEqual(0);
        expect(edgeSmokeIndex).toBeGreaterThan(globalDeployIndex);
        expect(edgeSmoke?.if).toMatch(/steps\.flags\.outputs\.deploy_global == 'true'/u);
    });

    it('probes every cut-over host, read from EDGE_CUTOVER_SERVICES rather than listed', () => {
        expect(edgeSmoke?.run).toContain('EDGE_CUTOVER_SERVICES');
        expect(edgeSmoke?.run).not.toMatch(/https:\/\/(?:food|recipe|identity)\./u);
    });

    it('polls, bounded, while the new edge version propagates', () => {
        expect(edgeSmoke?.run).toMatch(/\bsleep\b/u);
        expect(edgeSmoke?.run).toMatch(/exit 1/u);
    });
});
