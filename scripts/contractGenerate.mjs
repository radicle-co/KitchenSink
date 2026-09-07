#!/usr/bin/env node
/**
 * REGENERATE EVERY WIRE CONTRACT, AND PROVE IT (`docs/CODING_STANDARDS.md` §15.2.5).
 *
 * This replaces the bare `turbo run contract:generate --filter='./packages/services/*'` that `contract:verify`
 * used to lead with. That command has a measured failure mode which is silent in exactly the situation the gate
 * exists for: a filter that matches packages but no TASK prints
 *
 *     WARNING  No tasks were executed as part of this run.
 *
 * and exits **0**. So a service that lost or renamed its `contract:generate` script dropped out of the pipeline,
 * `contract:verify` found no diff for it — nothing had rewritten it — and the run went green over a stale
 * published contract.
 *
 * Three things make the claim honest here, and they are ordered so that each is checked before it is relied on:
 *
 *  1. **The expected set is derived and cross-checked** ({@link discoverContractOwners}), so it cannot shrink
 *     quietly. A break in the correspondence is a failure, not a smaller expectation.
 *  2. **Each owner is filtered BY NAME**, not by a path glob. A glob is what allowed "matched a package, ran no
 *     task"; naming the package means turbo is asked for precisely the tasks that must run.
 *  3. **Every document must have been REWRITTEN by this run.** Its mtime is compared against a marker file
 *     stamped before turbo starts. This is the assertion that a zero exit cannot fake: `contract:generate` is
 *     `cache: false` and the generator writes `openapi.yaml` unconditionally, so a document whose mtime did not
 *     move was not generated, whatever turbo reported.
 *
 * @sideEffect Spawns turbo (which WRITES the generated contract packages), writes a temp marker file, and sets
 *   the exit code.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { discoverContractOwners, formatOwnershipReport } from './contractOwners.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Emit a report to the step summary (when running in Actions) and an `::error::` annotation.
 *
 * @param {string} report - Markdown report body.
 * @param {string} annotation - One-line error annotation.
 * @sideEffect Writes to `$GITHUB_STEP_SUMMARY` and stdout.
 */
function reportFailure(report, annotation) {
    const summaryPath = process.env['GITHUB_STEP_SUMMARY'];

    if (summaryPath !== undefined && summaryPath !== '') {
        appendFileSync(summaryPath, `${report}\n`);
    }

    process.stdout.write(`${report}\n`);
    process.stdout.write(`::error::${annotation}\n`);
}

/**
 * A filesystem timestamp taken from the filesystem itself.
 *
 * Read off a file this process just wrote, rather than from `Date.now()`: the comparison is against file mtimes,
 * and a clock/filesystem-resolution mismatch would make the check either vacuous or flaky.
 *
 * @returns {number} Milliseconds, on the same scale as the mtimes being compared.
 * @sideEffect Creates a temp file.
 */
export function filesystemNow() {
    const marker = path.join(mkdtempSync(path.join(tmpdir(), 'contract-generate-')), 'marker');

    writeFileSync(marker, '');

    return statSync(marker).mtimeMs;
}

/**
 * Documents that were NOT rewritten by the run.
 *
 * THIS is the assertion a zero exit cannot fake. `contract:generate` is `cache: false` and the generator writes
 * `openapi.yaml` unconditionally, so a document whose mtime did not move past the pre-run reference was not
 * generated — whatever turbo reported.
 *
 * @param {readonly import('./contractOwners.mjs').ContractOwner[]} owners - The expected owners.
 * @param {number} since - The reference timestamp taken before generation.
 * @param {string} [root] - Repository root the document paths are relative to.
 * @returns {string[]} One message per document that is missing or stale.
 * @sideEffect Stats the generated documents.
 */
export function documentsNotRegenerated(owners, since, root = repoRoot) {
    return owners.flatMap((owner) => {
        try {
            const { mtimeMs } = statSync(path.join(root, owner.documentPath));

            if (mtimeMs >= since) {
                return [];
            }

            return [`${owner.documentPath} was not rewritten by ${owner.serviceName} (its mtime did not move)`];
        } catch {
            return [`${owner.documentPath} does not exist after ${owner.serviceName} ran`];
        }
    });
}

/**
 * The runner.
 *
 * @sideEffect Runs the generators and sets the exit code.
 */
function main() {
    const { owners, problems } = discoverContractOwners(repoRoot);

    if (problems.length > 0) {
        reportFailure(
            formatOwnershipReport(problems),
            `${problems.length} break(s) in the wire-contract ownership correspondence — see the report above.`,
        );
        process.exitCode = 1;

        return;
    }

    // A pipeline with nothing to regenerate is decoration, and every downstream count would be 0 of 0.
    if (owners.length === 0) {
        reportFailure(
            formatOwnershipReport(['No packages/schemas/* package declares a generator at all.']),
            'No wire contract to regenerate — the generation step would be a no-op.',
        );
        process.exitCode = 1;

        return;
    }

    const since = filesystemNow();
    const filters = owners.map((owner) => `--filter=${owner.serviceName}`);

    process.stdout.write(`contract:generate — ${owners.length} contract(s): ${filters.join(' ')}\n`);

    try {
        execFileSync(path.join(repoRoot, 'node_modules/.bin/turbo'), ['run', 'contract:generate', ...filters], {
            cwd: repoRoot,
            stdio: 'inherit',
        });
    } catch {
        reportFailure(
            ['### A wire-contract generator failed', '', 'See the generator output above.'].join('\n'),
            'contract:generate failed — the generated contract packages were not fully rewritten.',
        );
        process.exitCode = 1;

        return;
    }

    const stale = documentsNotRegenerated(owners, since);

    if (stale.length > 0) {
        reportFailure(
            [
                '### The generation step did not regenerate every contract',
                '',
                'turbo exited 0, but these documents were not rewritten. `turbo run` exits 0 when a filter',
                'matches no TASK ("No tasks were executed"), so a zero exit is not evidence that anything ran:',
                '',
                '```',
                ...stale.sort(),
                '```',
                '',
                'Check the named service still declares a `contract:generate` script and that it writes its',
                'package.',
            ].join('\n'),
            `${stale.length} of ${owners.length} contract document(s) were not regenerated despite a zero exit.`,
        );
        process.exitCode = 1;

        return;
    }

    process.stdout.write(`contract:generate — regenerated ${owners.length} of ${owners.length} contract(s).\n`);
}

// `import.meta.main` is Node 24; the suite imports the helpers without running the generators, which would WRITE
// into the repository from a test and silently repair a genuinely-drifted checkout.
if (import.meta.main) {
    main();
}
