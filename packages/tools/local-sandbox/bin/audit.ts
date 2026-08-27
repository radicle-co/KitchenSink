/**
 * Audit what a LOCAL sandbox must run, derived from the synthesised CDK.
 *
 * ⛔ READS TEMPLATES, DOES NOT SYNTH THEM. Synthesising here would mean bundling every Lambda asset first
 * (`npm run bundle:lambda`, per package), which is minutes of work to answer a question about resource
 * TYPES. The caller points this at whatever `cdk.out` directories already exist — the ones `infra:synth`
 * and the stack suites produce — so the audit is fast enough to run on every change.
 *
 * ⚠️ Consequently it reports on what has been synthesised, not on what COULD be. A stack nobody has
 * synthesised is invisible here, and the exit line says so rather than implying full coverage.
 *
 * @sideEffect Reads the filesystem and writes stdout; exits non-zero on an undecided resource type.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { globSync } from 'glob';

import { discoverResources, summarizeRequirements, type DiscoveredResource } from '../src/index.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');

function templates(): readonly string[] {
    return globSync('**/cdk.out/*.template.json', {
        cwd: REPO_ROOT,
        ignore: ['**/node_modules/**', '.worktrees/**'],
    }).sort();
}

function main(): void {
    const found = templates();

    if (found.length === 0) {
        process.stdout.write(
            'No synthesised templates found. Run `npm run infra:synth --workspace=<package>` first —\n' +
                'this audit reads `cdk.out`, it does not synthesise (see the module docstring).\n',
        );
        process.exitCode = 1;

        return;
    }

    const resources: DiscoveredResource[] = found.flatMap((file) => {
        const stack = path.basename(file).replace(/\.template\.json$/u, '');

        return [...discoverResources(stack, JSON.parse(readFileSync(path.join(REPO_ROOT, file), 'utf8')))];
    });
    const requirements = summarizeRequirements(resources);

    process.stdout.write(`templates read : ${found.length}\n`);
    process.stdout.write(`resources      : ${resources.length}\n\n`);
    process.stdout.write(`LocalStack SERVICES=${requirements.localstackServices.join(',')}\n`);
    process.stdout.write(`containers     : ${requirements.containers.join(', ')}\n\n`);

    if (requirements.unsupported.length > 0) {
        process.stdout.write('CANNOT be emulated locally — a local run does not cover these:\n');
        for (const entry of requirements.unsupported) {
            process.stdout.write(`  ${entry.type}\n      ${entry.why}\n`);
        }
        process.stdout.write('\n');
    }

    if (requirements.undecided.length > 0) {
        // ⛔ NON-ZERO. An undecided type means infrastructure landed that nobody has decided how to run
        // locally — the drift this whole package exists to make visible. Exiting green would defer it
        // forever.
        process.stdout.write('UNDECIDED — new infrastructure with no local-support decision:\n');
        for (const type of requirements.undecided) {
            process.stdout.write(`  ${type}\n`);
        }
        process.stdout.write('\nAdd each to LOCAL_SUPPORT in src/localSupport.ts, with a reason.\n');
        process.exitCode = 1;
    }
}

main();
