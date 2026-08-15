#!/usr/bin/env node
/**
 * DRIFT LAYER 2 — the CORRECTNESS gate on the checked-in wire contracts (`docs/CODING_STANDARDS.md` §15.2.5).
 *
 * `packages/schemas/<service>` publishes each service's API contract as CHECKED-IN GENERATED artifacts: the
 * OpenAPI document, the zod, the `z.infer` types, and the two `contractHash` modules (schema package +
 * service). Committing generated output is a deliberate trade — a consumer reads the contract straight out of
 * the tree instead of having to run a generator — and it has exactly one failure mode: DRIFT. The source of
 * truth moves and the artifacts do not, or an artifact gets hand-edited.
 *
 * NOTHING ELSE IN THE PIPELINE CAN SEE THAT. Lint, typecheck and test all pass happily against a STALE
 * contract, because a stale contract is still valid TypeScript. What ships is a published document describing
 * a service that no longer exists, plus two hashes asserting they agree when they do not.
 *
 * So this gate has the same shape as the `format` gate: re-run the tool that OWNS the file, then require the
 * working tree to be unchanged. The regeneration is the caller's job (`npm run contract:verify` runs
 * `contract:generate` first, and fails the whole script if it fails); this file's job is to decide whether the
 * tree moved, and to say so in a way an author can act on.
 *
 * ── THE THREE THINGS THAT MAKE THIS GATE ACTUALLY WORK, EACH MEASURED AGAINST REAL GIT ──
 *
 *  1. **`git diff` alone is blind to a file the generator CREATED.** An untracked path is not in the index, so
 *     a brand-new artifact reads as "no drift" and the gate reports proof it never obtained. Registering every
 *     untracked, non-ignored path first is what makes it surface as an addition.
 *  2. **The `HEAD` anchor is load-bearing.** `git add` STAGES a deletion, so a bare `git diff --exit-code` —
 *     worktree against the INDEX — goes clean the moment the generator DELETES a committed artifact, and exits
 *     0 on real drift. Worse, in a run that both deletes and adds, the addition reds the step for the wrong
 *     reason and the deletion is never reported at all. Diffing against HEAD covers staged, unstaged and
 *     newly-registered in one comparison: modified, added, deleted and renamed all fail.
 *  3. **An artifact git cannot SEE has no gate at all**, and the way that happens is a `.gitignore` entry
 *     covering the generated tree. `git add` skips ignored paths, so such an artifact is invisible to the diff
 *     AND the run is green. That is checked FIRST and separately, so the failure names the cause instead of
 *     reporting a clean tree.
 *  4. **"No diff" only counts for a document something REGENERATED.** The count this gate reports used to be of
 *     TRACKED documents, which are the ones that exist rather than the ones that were rewritten — so a service
 *     that lost its `contract:generate` script dropped out of `npm run contract:generate` (which exits 0 having
 *     executed nothing), left no diff because nothing touched its document, and the gate printed "3 document(s)
 *     checked" over a stale contract. The expected set now comes from `scripts/contractOwners.mjs`, and a
 *     tracked document with no owner — or an owner correspondence that is broken in either direction — is a
 *     loud failure.
 *
 * ⚠️ **`--intent-to-add` IS NOT what makes the detection work, and the reason it is here is worth stating,
 * because the obvious justification for it is FALSE.** Measured: with the `HEAD` anchor above, plain
 * `git add --all` yields a byte-identical `--name-status` output — additions, deletions and modifications all
 * surface either way, and a mutant that drops the flag passes every drift case. What the flag actually buys is
 * that the gate does not MUTATE A CONTRIBUTOR'S INDEX: `--intent-to-add` records the path against an empty
 * blob (`git diff --cached --numstat` stays empty), whereas `git add --all` stages real content, so
 * `npm run contract:verify` run locally before a commit would silently sweep the developer's entire working
 * tree into their next commit. The gate is read-only with respect to content, and the suite asserts that.
 *
 * ── WHY THE ROOTS ARE DISCOVERED, NOT LISTED ──
 *
 * The artifact set is derived from whatever `packages/schemas/*` exists, plus every service's embedded stamp.
 * A hardcoded list would silently leave a NEW service's contract ungated — a gate that grows a hole every time
 * the repo does is worse than no gate, because everyone believes it is covering the new thing.
 *
 * `--stdin` drives the pure classification from fixture text so the suite can exercise the added/modified/
 * deleted/ignored paths hermetically, without constructing a repo state for each. Same pattern as
 * `scripts/boundariesRatchet.mjs`.
 *
 * ⚠️ KNOWN LIMITATION, stated because it will otherwise be mistaken for a bug. Drift is `git diff … HEAD` over
 * the WHOLE tree, so run locally on a dirty branch this reports the contributor's own uncommitted edits as
 * drift. In CI — the case it is built for — the tree is clean apart from regeneration, so the report is exactly
 * the generator's output. The `--all` scope is deliberate (a generator writing OUTSIDE its declared artifact set
 * is drift too), and narrowing it to the contract paths would give that up. The clean fix is to move the
 * regeneration INTO this script so it can snapshot `git status` before and after and report only what the
 * generator touched; that is a follow-up, not a thing to paper over with a path filter.
 *
 * @sideEffect Spawns git (read-only apart from `add --intent-to-add`, which touches only the index) and writes
 *   to stdout/stderr and `$GITHUB_STEP_SUMMARY`.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

import { discoverContractOwners, formatOwnershipReport } from './contractOwners.mjs';

/**
 * The COMMITTED wire-contract artifacts, as pathspecs. Every path under these must be visible to git.
 *
 * ⚠️ SCOPED TO THE COMMITTED SET, NOT TO `packages/schemas` WHOLESALE — measured, after the broad form failed
 * on the real repository. A schema package also contains `dist/` and `*.tsbuildinfo`, which are BUILD OUTPUT
 * and are `.gitignore`d for good reason; the broad spelling reported 121 "ignored contract artifacts" and would
 * have opened this gate permanently red the moment anything had been built. What the check is actually for is
 * an artifact that is SUPPOSED to be committed and has been hidden from git, so it names those paths.
 */
const GENERATED_ROOTS = [
    'packages/schemas/*/openapi.yaml',
    // ⚠️ `:(glob)` AND the `/**` SUFFIX ARE BOTH REQUIRED, and both were measured against real git rather
    // than reasoned about. Two separate traps:
    //
    //  1. `packages/schemas/*/src` (no suffix) matches the DIRECTORY and returns NOTHING for the files in it,
    //     so the check goes silently VACUOUS — the worst state a gate can be in, reporting green having looked
    //     at nothing.
    //  2. Without `:(glob)`, git's `*` uses fnmatch WITHOUT `FNM_PATHNAME`, so it happily crosses `/`:
    //     `packages/services/*/src/contract/**` also matched
    //     `packages/services/recipe-service/dist/src/contract/**`, i.e. BUILD OUTPUT, which is correctly
    //     `.gitignore`d — 24 false positives on the real repository. `:(glob)` restores the intuitive meaning
    //     (`*` within one path segment, `**` across segments).
    //
    // The `does NOT flag an ignored dist/` and `fails when a generated artifact is git-IGNORED` cases pin
    // both directions, so neither trap can be reintroduced quietly.
    ':(glob)packages/schemas/*/src/**',
    'packages/schemas/*/package.json',
    'packages/schemas/*/prod.package.json',
    ':(glob)packages/services/*/src/contract/**',
];

/** The command that rewrites the artifacts, quoted in every failure message. */
const REGENERATE_COMMAND = 'npm run contract:generate';

/**
 * Parse `git diff --name-status` output into the three ways an artifact can have drifted.
 *
 * Rename/copy statuses (`R100 old new`) are reported under their own bucket rather than folded into
 * modified: a generator that renames an artifact is a contract whose module name moved, and a reader needs to
 * see that rather than a bare "changed".
 *
 * @param {string} nameStatus - Raw `git diff --name-status HEAD` output.
 * @returns {{ added: string[], modified: string[], deleted: string[], renamed: string[] }} The classification.
 *   Pure.
 */
export function classifyDrift(nameStatus) {
    const added = [];
    const modified = [];
    const deleted = [];
    const renamed = [];

    for (const line of nameStatus.split('\n')) {
        if (line.trim() === '') {
            continue;
        }

        const [status, ...rest] = line.split('\t');
        const paths = rest.join(' → ');
        const code = (status ?? '').charAt(0);

        if (code === 'A') {
            added.push(paths);
        } else if (code === 'D') {
            deleted.push(paths);
        } else if (code === 'R' || code === 'C') {
            renamed.push(paths);
        } else {
            modified.push(paths);
        }
    }

    return {
        added: added.sort(),
        modified: modified.sort(),
        deleted: deleted.sort(),
        renamed: renamed.sort(),
    };
}

/**
 * Whether a classification represents any drift at all.
 *
 * @param {ReturnType<typeof classifyDrift>} drift - The classification.
 * @returns {boolean} True when anything moved. Pure.
 */
export function hasDrift(drift) {
    return drift.added.length + drift.modified.length + drift.deleted.length + drift.renamed.length > 0;
}

/**
 * Render the operator-facing drift report.
 *
 * Each bucket gets its own heading with its own diagnosis, because the three mean different mistakes: a
 * MODIFIED artifact is a stale commit, an ADDED one is a generator output nobody committed, and a DELETED one
 * is a contract the service stopped serving while the published package went on advertising it.
 *
 * @param {ReturnType<typeof classifyDrift>} drift - The classification.
 * @returns {string} The report body, in Markdown. Pure.
 */
export function formatDriftReport(drift) {
    const sections = [
        ['Stale — committed content differs from the generator output', drift.modified],
        ['Uncommitted — the generator wrote these and the commit does not contain them', drift.added],
        [
            'Orphaned — committed but no longer produced, so the package publishes a shape the service dropped',
            drift.deleted,
        ],
        ['Renamed by the generator', drift.renamed],
    ].filter(([, paths]) => paths.length > 0);

    const lines = ['### Contract drift detected', ''];

    lines.push('The checked-in contract artifacts are NOT what `' + REGENERATE_COMMAND + '` produces from the');
    lines.push('current source. Fix it locally, then commit the regenerated files:');
    lines.push('', '```bash', REGENERATE_COMMAND, '```', '');

    for (const [heading, paths] of sections) {
        lines.push(`**${heading}**`, '');
        lines.push('```');
        lines.push(...paths);
        lines.push('```', '');
    }

    lines.push(
        'Do NOT hand-edit them. If the change to a `contractHash.ts` is a surprise, the API contract itself',
        'moved — say so in the PR description.',
    );

    return lines.join('\n');
}

/**
 * Render the failure for generated artifacts git has been told to ignore.
 *
 * @param {readonly string[]} ignored - Ignored paths under the generated roots.
 * @returns {string} The report body. Pure.
 */
export function formatIgnoredReport(ignored) {
    return [
        '### Generated contract artifacts are git-IGNORED',
        '',
        'The whole gate is a `git diff`, and an ignored path is invisible to it — so these artifacts have no',
        'drift gate at all, and the run would have been green having checked nothing:',
        '',
        '```',
        ...[...ignored].sort(),
        '```',
        '',
        'Un-ignore them. A generated artifact that is committed is gated; one that is ignored is a fork.',
    ].join('\n');
}

/**
 * Run a git command and return its trimmed stdout.
 *
 * @param {readonly string[]} args - Arguments after `git`.
 * @returns {string} Trimmed stdout.
 * @sideEffect Spawns a process.
 */
function git(args) {
    return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
}

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
 * The gate.
 *
 * @sideEffect Reads the repository through git, writes reports, and sets the exit code.
 */
function main() {
    const args = process.argv.slice(2);
    const stdinIndex = args.indexOf('--stdin');

    // Hermetic mode: classify fixture text, report, exit. No git, no repository state.
    if (stdinIndex !== -1) {
        const drift = classifyDrift(readFileSync(0, 'utf8'));

        if (!hasDrift(drift)) {
            process.stdout.write('Committed contract artifacts are byte-identical to freshly generated output.\n');

            return;
        }

        reportFailure(
            formatDriftReport(drift),
            `Contract drift: ${drift.modified.length} stale, ${drift.added.length} uncommitted, ` +
                `${drift.deleted.length} orphaned, ${drift.renamed.length} renamed. Run '${REGENERATE_COMMAND}' ` +
                'and commit the regenerated files.',
        );
        process.exitCode = 1;

        return;
    }

    const ignored = git(['ls-files', '--others', '--ignored', '--exclude-standard', '--', ...GENERATED_ROOTS])
        .split('\n')
        .filter((path) => path !== '');

    if (ignored.length > 0) {
        reportFailure(
            formatIgnoredReport(ignored),
            `${ignored.length} generated contract artifact(s) are git-ignored, so the drift check cannot see ` +
                'them. Un-ignore them.',
        );
        process.exitCode = 1;

        return;
    }

    // Non-vacuity: if there is no contract to gate, this gate is decoration. Say so rather than pass.
    const trackedContracts = git(['ls-files', '--', 'packages/schemas/*/openapi.yaml'])
        .split('\n')
        .filter((path) => path !== '');

    if (trackedContracts.length === 0) {
        reportFailure(
            [
                '### No committed contract to gate',
                '',
                'No `packages/schemas/*/openapi.yaml` is tracked, so this check would pass without examining',
                'anything. Either a generated package lost its document, or the gate is pointed at the wrong',
                'path.',
            ].join('\n'),
            'Contract drift gate found nothing to check — no tracked packages/schemas/*/openapi.yaml.',
        );
        process.exitCode = 1;

        return;
    }

    // ⚠️ THE COUNT MUST MEAN WHAT IT SAYS. The tracked documents above are the ones that EXIST; the owners below
    // are the ones something actually regenerates. When those two sets diverge — a service that lost or renamed
    // its `contract:generate` script is the measured case — this gate finds no diff for the orphan, because
    // nothing rewrote it, and would otherwise print "N document(s) checked" over a contract it never verified.
    const expected = discoverContractOwners(git(['rev-parse', '--show-toplevel']));
    const unowned = trackedContracts.filter(
        (document) => !expected.owners.some((owner) => owner.documentPath === document),
    );

    if (expected.problems.length > 0 || unowned.length > 0) {
        reportFailure(
            formatOwnershipReport([
                ...expected.problems,
                ...unowned.map(
                    (document) =>
                        `${document} is tracked but no service regenerates it, so "no diff" for it is not ` +
                        'evidence of anything.',
                ),
            ]),
            `Contract drift gate cannot account for ${unowned.length + expected.problems.length} contract(s): ` +
                'a tracked document that nothing regenerates would pass this gate without being checked.',
        );
        process.exitCode = 1;

        return;
    }

    // `--all`, rather than only the artifact paths: a generator writing OUTSIDE its declared artifact set is
    // drift too, and the report names the paths either way. `--intent-to-add` keeps this read-only with respect
    // to CONTENT — see the header note, and do not "simplify" it to a plain `git add`.
    git(['add', '--intent-to-add', '--all']);

    const drift = classifyDrift(git(['diff', '--name-status', 'HEAD']));

    if (!hasDrift(drift)) {
        process.stdout.write(
            `Committed contract artifacts are byte-identical to freshly generated output ` +
                `(${trackedContracts.length} document(s) checked, each regenerated by its owning service: ` +
                `${expected.owners.map((owner) => owner.serviceName).join(', ')}).\n`,
        );

        return;
    }

    reportFailure(
        formatDriftReport(drift),
        `Contract drift: ${drift.modified.length} stale, ${drift.added.length} uncommitted, ` +
            `${drift.deleted.length} orphaned, ${drift.renamed.length} renamed. Run '${REGENERATE_COMMAND}' and ` +
            'commit the regenerated files. The full patch is below and in this run’s summary.',
    );
    process.stdout.write('Full patch — the generator output that is missing from the commit:\n');
    process.stdout.write(`${git(['--no-pager', 'diff', 'HEAD'])}\n`);
    process.exitCode = 1;
}

// `import.meta.main` is Node 24; the suite imports the pure helpers without running the gate.
if (import.meta.main) {
    main();
}
