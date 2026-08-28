/**
 * Repo-wide guard: the CDK app inventory a local sandbox stands up.
 *
 * ## The defect this replaces
 *
 * The first version of this package globbed `**\/cdk.out/*.template.json` — whatever synthesised output
 * happened to be lying on disk. Run on 2026-08-27 it read **3 templates / 91 resources** and reported
 * `SERVICES=events,lambda,logs,sns` with no database at all. The repo demonstrably uses S3, SQS, SSM,
 * Secrets Manager, DynamoDB and Postgres in every service.
 *
 * It was not wrong by a little. It was reading three prod service templates that happened to be in
 * `./cdk.out` because someone had run `cdk synth` hours earlier for unrelated work. Synthesising the global
 * app alone yields **95 resources / 35 distinct types**, including the RDS instance, both SQS queues, both
 * S3 buckets, both Secrets and the DynamoDB table — every one of which that report omitted.
 *
 * So the failure mode was the worst available: a confident, plausible, paste-able `SERVICES=` line that
 * produces a LocalStack missing most of what the repo uses. A tool that answered "I don't know" would have
 * been strictly better.
 *
 * ## Why the inventory is derived from `cdk synth` SCRIPTS
 *
 * The authority on "what CDK apps exist" is the repo's own statement of how to synthesise them — the
 * `cdk synth --app '…'` scripts in each package. That cannot drift from reality, because it is the same
 * command CI and developers run. Globbing `infra/bin/app.ts` would find the files but not how to execute
 * them (tsx vs compiled `node dist/...`, which differ across this repo by design — ADR-0013).
 */
import { describe, expect, it } from 'vitest';

import { discoverApps, type PackageManifest } from '../discoverApps.js';

const manifest = (dir: string, name: string, scripts: Record<string, string>): PackageManifest => ({
    dir,
    json: { name, scripts },
});

describe('discoverApps', () => {
    it('finds an app from its cdk synth script and carries the command verbatim', () => {
        const apps = discoverApps([
            manifest('packages/services/food-service', '@kitchensink/food-service', {
                'infra:synth': "npm run bundle:lambda && cdk synth --app 'npx tsx infra/bin/app.ts'",
            }),
        ]);

        expect(apps).toEqual([
            {
                packageName: '@kitchensink/food-service',
                packageDir: 'packages/services/food-service',
                script: 'infra:synth',
                appCommand: 'npx tsx infra/bin/app.ts',
            },
        ]);
    });

    it('accepts the differently-named script the global package uses', () => {
        const apps = discoverApps([
            manifest('packages/infra/global', '@kitchensink/infra-global', {
                synth: "cdk synth --app 'npx tsx bin/app.ts'",
            }),
        ]);

        expect(apps.map((a) => a.script)).toEqual(['synth']);
    });

    it('ignores packages with no cdk synth script', () => {
        expect(
            discoverApps([manifest('packages/tools/vitest', '@kitchensink/vitest', { test: 'vitest run' })]),
        ).toEqual([]);
    });

    /**
     * ⛔ The failure that motivates the whole module. A script that mentions `cdk synth` but whose `--app`
     * cannot be read is NOT silently skipped: skipping is how an app drops out of the inventory unnoticed,
     * which is the exact class of bug this package exists to prevent. It is surfaced as a malformed entry so
     * the caller can fail on it.
     */
    it('reports a cdk synth script whose --app cannot be parsed, rather than dropping it', () => {
        const apps = discoverApps([
            manifest('packages/services/mystery', '@kitchensink/mystery', {
                'infra:synth': 'cdk synth --all',
            }),
        ]);

        expect(apps).toEqual([
            {
                packageName: '@kitchensink/mystery',
                packageDir: 'packages/services/mystery',
                script: 'infra:synth',
                appCommand: undefined,
            },
        ]);
    });

    it('is stable to diff — sorted by package name', () => {
        const apps = discoverApps([
            manifest('b', '@kitchensink/zebra', { synth: "cdk synth --app 'npx tsx b.ts'" }),
            manifest('a', '@kitchensink/alpha', { synth: "cdk synth --app 'npx tsx a.ts'" }),
        ]);

        expect(apps.map((a) => a.packageName)).toEqual(['@kitchensink/alpha', '@kitchensink/zebra']);
    });

    it('tolerates a manifest with no scripts block at all', () => {
        expect(discoverApps([{ dir: 'x', json: { name: '@x/y' } }])).toEqual([]);
    });

    it('takes the FIRST synth script when a package declares more than one', () => {
        // Deterministic rather than arbitrary: two synth scripts is a repo smell, and picking by insertion
        // order at least makes the choice reproducible and diffable.
        const apps = discoverApps([
            manifest('p', '@x/p', {
                synth: "cdk synth --app 'npx tsx first.ts'",
                'infra:synth': "cdk synth --app 'npx tsx second.ts'",
            }),
        ]);

        expect(apps).toHaveLength(1);
        expect(apps[0]?.appCommand).toBe('npx tsx first.ts');
    });
});
