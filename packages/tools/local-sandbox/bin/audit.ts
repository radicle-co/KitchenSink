/**
 * Audit what a LOCAL sandbox must run — derived by SYNTHESISING every CDK app in the repo.
 *
 * ⛔ This replaces a version that globbed `cdk.out`. That one's answer was a function of what a developer
 * had run that morning: on 2026-08-27 it read 3 of 8 apps and reported
 * `SERVICES=events,lambda,logs,sns` — no S3, no SQS, no SSM, no Secrets Manager, no DynamoDB, and no
 * database — while the repo uses every one of them. It exited 0.
 *
 * @sideEffect Spawns CDK for every app, writes to a temp directory and to stdout; exits non-zero on an
 * undecided resource type or an app that could not be synthesised.
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { discoverApps } from '../src/discoverApps.js';
import { discoverResources, summarizeRequirements, type DiscoveredResource } from '../src/discoverResources.js';
import { synthesizeAll } from '../src/synthesize.js';
import { readManifests, runCdkSynth } from './adapters.js';

async function main(): Promise<void> {
    const apps = discoverApps(readManifests());

    process.stdout.write(`CDK apps discovered : ${apps.length}\n`);
    for (const app of apps) {
        process.stdout.write(`  ${app.packageName}\n`);
    }
    process.stdout.write('\nsynthesising (this runs cdk once per app)…\n');

    const outcomes = await synthesizeAll(apps, runCdkSynth, {
        outRoot: mkdtempSync(path.join(tmpdir(), 'local-sandbox-')),
    });

    const resources: DiscoveredResource[] = outcomes
        .filter((outcome) => outcome.usable)
        .flatMap((outcome) =>
            outcome.templates.flatMap((file) => [
                ...discoverResources(
                    path.basename(file).replace(/\.template\.json$/u, ''),
                    JSON.parse(readFileSync(file, 'utf8')),
                ),
            ]),
        );
    const requirements = summarizeRequirements(resources);

    process.stdout.write('\n');
    for (const outcome of outcomes) {
        const state = outcome.usable ? (outcome.clean ? 'ok' : 'ok (with synth warnings)') : 'FAILED';
        process.stdout.write(
            `  ${state.padEnd(26)} ${outcome.app.packageName} — ${outcome.templates.length} template(s)\n`,
        );
    }

    process.stdout.write(`\nresources          : ${resources.length}\n`);
    process.stdout.write(`LocalStack SERVICES=${requirements.localstackServices.join(',')}\n`);
    process.stdout.write(`containers         : ${requirements.containers.join(', ')}\n\n`);

    if (requirements.unsupported.length > 0) {
        process.stdout.write('CANNOT be emulated locally — a local run does not cover these:\n');
        for (const entry of requirements.unsupported) {
            process.stdout.write(`  ${entry.type}\n      ${entry.why}\n`);
        }
        process.stdout.write('\n');
    }

    // ⛔ An app that produced nothing is a HOLE in the inventory, and a hole here is indistinguishable from
    // "that infrastructure does not exist" — which is exactly how the predecessor reported a repo with no
    // database. It fails the audit; it does not shrink the answer.
    const broken = outcomes.filter((outcome) => !outcome.usable);

    if (broken.length > 0) {
        process.stdout.write('APPS THAT COULD NOT BE SYNTHESISED — the inventory below is INCOMPLETE:\n');
        for (const outcome of broken) {
            process.stdout.write(
                `  ${outcome.app.packageName}\n      ${outcome.stderr.trim().split('\n').slice(-3).join('\n      ')}\n`,
            );
        }
        process.stdout.write('\n');
        process.exitCode = 1;
    }

    if (requirements.undecided.length > 0) {
        process.stdout.write('UNDECIDED — new infrastructure with no local-support decision:\n');
        for (const type of requirements.undecided) {
            process.stdout.write(`  ${type}\n`);
        }
        process.stdout.write('\nAdd each to LOCAL_SUPPORT in src/localSupport.ts, with a reason.\n');
        process.exitCode = 1;
    }
}

await main();
