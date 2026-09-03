// @vitest-environment node
/**
 * Repo-wide guard: the AWS account id never appears in the corpus the documentation site PUBLISHES.
 *
 * ## Why this control exists, and what it replaced
 *
 * `.github/workflows/docs.yml` was built to publish `packages/tools/docs-site` behind Vercel
 * Authentication, and both the workflow and `docsSiteDeployGuards.test.ts` asserted that posture before
 * a single byte shipped. That protection turned out to be **unavailable on the team's Vercel plan** —
 * measured, not assumed: the API accepts `ssoProtection` and does not enforce it, and a preview
 * deployment served real content to an anonymous request. The owner's ruling is therefore that the site
 * is **public**, and that the account id must not be in it.
 *
 * So the confidentiality control moved from "nobody can read the site" to "there is nothing in the site
 * worth reading" — and that is only true while something enforces it. This file is that something. It is
 * the reason the workflow may publish at all, which is why its failure message is written for an author
 * who has just added a document rather than for whoever wrote the guard.
 *
 * ## Why the id is DERIVED and never written down here
 *
 * A guard that hardcodes the value it is protecting has published it one more time, in a file read far
 * more often than the document it was scrubbed out of. So `scripts/assertNoAwsAccountIds.mjs` DISCOVERS
 * the account ids this repository actually uses, out of the ARNs, SQS queue URLs and ECR hosts in its own
 * tracked sources (`docs/` excluded, so a leak cannot justify itself), and then asserts their absence.
 * Nothing in this file, in that script, or in either one's OUTPUT ever contains an account id: violations
 * are reported by `path:line`, and the report mode masks what it found.
 *
 * That derivation also makes the guard wider than its brief. It is not "the string `0406…` is absent"; it
 * is "no account id this repository is known to use is present", so a second account is covered on the
 * day it is first referenced, with no edit here.
 *
 * ## The second rule, which does not depend on discovery at all
 *
 * Discovery has one blind spot with teeth: an account id that appears ONLY in `docs/` is, by
 * construction, not discoverable from outside `docs/`. Rule 2 closes it from the other side — an ARN, a
 * queue URL or an ECR host carrying a LITERAL 12-digit account field is a violation whatever the digits
 * are. A scrubbed passage reading `arn:aws:sqs:us-east-1:<aws-account-id>:…` passes; one that pastes a
 * real ARN back in does not, even for an account nothing else in the tree mentions.
 *
 * ## Non-vacuity, which is the whole difficulty with an absence assertion
 *
 * Every assertion of the form "X is not there" passes when the search is broken, when the walk finds no
 * files, and when the pattern matches nothing. Three separate defences, all exercised below:
 *
 *  1. **The oracle must exist.** Discovery returning nothing is a FAILURE, not a pass — the script exits
 *     non-zero and says the control has lost its oracle. A tree with no ARNs in it cannot prove anything
 *     about account ids.
 *  2. **The walk must reach files.** A target that does not exist, or that holds no readable file, fails
 *     rather than reporting a clean sweep over nothing.
 *  3. **The detector must discriminate.** Proved END-TO-END, without this file ever naming an account
 *     id: the script reports which of its own tracked sources it derived ids FROM, one of those files is
 *     copied into a temp tree, and scanning that tree must flag it. If discovery were broken, or the
 *     matcher were, that assertion goes red. The negative controls in the same block pin the other side —
 *     an `<aws-account-id>` placeholder and a 12-digit TIMESTAMP (`docs/` really does contain one, in the
 *     pg18 execution record's snapshot name) must NOT be flagged.
 *
 * ## Mutation evidence — every one of these was APPLIED and watched fail
 *
 * Script mutations (`scripts/assertNoAwsAccountIds.mjs`), each restored and re-verified byte-identical
 * with `md5sum -c` before the next:
 *
 *  1. Rule 1 (`if (bounded.some(…))`) replaced with `if (false)` → red on `flags a plain occurrence of a
 *     known account id`. ⚠️ The end-to-end derivation test stays GREEN, because the file it copies also
 *     carries real ARNs and rule 2 still catches them. That is the honest reason both rules have their
 *     own fixture rather than one shared "it detects things" assertion.
 *  2. Rule 2 (`if (accountsIn(line).size > 0)`) replaced with `if (false)` → red on `flags a literal ARN
 *     even for an account nothing else in the repository mentions`.
 *  3. `discover` made to return no accounts and no sources → red on `derives at least one AWS account id,
 *     and masks it in the report`. The oracle is asserted before anything that depends on it.
 *  4. The directory walk made to return `[]` → red on `flags a real derived account id in a real
 *     repository file`. ⚠️ NOT on the "target holds no files" case, which still passes: a broken walk and
 *     an empty directory are indistinguishable to that fixture. The end-to-end test is what separates
 *     them, because it knows a specific file WAS there to find.
 *  5. Rule 1's digit-bounded regexes replaced with a bare `/(?<!\d)\d{12}(?!\d)/` → red on `does NOT flag
 *     a 12-digit number that is not an account id`.
 *  6. The `--accounts` validation (`if (malformed.length > 0)`) replaced with `if (false)` → red on
 *     `fails rather than sweeping when handed an oracle that cannot match anything`.
 *
 * Real-tree mutation, applied to the published corpus itself and reverted (`md5sum -c` clean afterwards):
 *
 *  7. `docs/architecture/decisions/0020-…md`'s `<aws-account-id>` placeholder replaced with a real
 *     account id — read out of an existing ARN by the harness, so the harness did not name one either →
 *     red on `names no AWS account id anywhere under docs/`, and the script reported
 *     `docs/architecture/decisions/0020-cloudfront-edge-and-internal-alb-hostnames.md:118 — names a known
 *     AWS account id`, with no account id anywhere in its output.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';

const SCRIPT = path.join(repoRoot, 'scripts/assertNoAwsAccountIds.mjs');

/** A placeholder account, used only to drive the scanner in the hermetic fixtures below. */
const FIXTURE_ACCOUNT = '123456789012';

/** A different placeholder, never handed to `--accounts`, so only the ARN-shape rule can catch it. */
const UNKNOWN_ACCOUNT = '210987654321';

interface RunResult {
    readonly code: number;
    readonly out: string;
}

/** @sideEffect Executes the scrub script. Never mutates the repository. */
function run(...args: readonly string[]): RunResult {
    try {
        return {
            code: 0,
            out: execFileSync(process.execPath, [SCRIPT, ...args], {
                cwd: repoRoot,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
            }),
        };
    } catch (error) {
        const failure = error as { status?: number; stdout?: string; stderr?: string };

        return { code: failure.status ?? -1, out: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
    }
}

/**
 * A temp directory holding the given files.
 *
 * @sideEffect Writes to the OS temp directory.
 */
function tree(files: Readonly<Record<string, string>>): string {
    const root = mkdtempSync(path.join(tmpdir(), 'account-id-scrub-'));

    for (const [name, body] of Object.entries(files)) {
        const file = path.join(root, name);

        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, body);
    }

    return root;
}

interface Report {
    readonly accounts: readonly string[];
    readonly sources: readonly string[];
}

/** @sideEffect Runs the script's report mode against the real repository. */
function report(): Report {
    const result = run('--report');

    expect(result.code).toBe(0);

    return JSON.parse(result.out) as Report;
}

describe('the scrub guard has an oracle at all', () => {
    it('derives at least one AWS account id from the repository, and masks it in the report', () => {
        // ⛔ The premise of every absence assertion below. If this repository ever stops naming an
        // account id in an ARN anywhere outside `docs/`, this guard has no oracle and must say so
        // rather than reporting a clean sweep it never performed.
        const { accounts, sources } = report();

        expect(accounts.length).toBeGreaterThan(0);
        expect(sources.length).toBeGreaterThan(0);

        for (const masked of accounts) {
            // Masked, because this output lands in CI logs. Two digits either side is enough to tell
            // two accounts apart in a failure report and not enough to be the account id.
            expect(masked).toMatch(/^\d{2}\.{3}\d{2}$/);
        }
    });

    it('never derives an account id from `docs/`, so a leak cannot justify itself', () => {
        for (const source of report().sources) {
            expect(source.startsWith('docs/')).toBe(false);
        }
    });

    it('fails rather than sweeping when it has no account id to look for', () => {
        const result = run('--accounts', '', tree({ 'a.md': 'nothing here' }));

        expect(result.code).toBe(1);
        expect(result.out).toMatch(/no AWS account id/i);
    });

    it('fails rather than sweeping when handed an oracle that cannot match anything', () => {
        // ⛔ `--accounts` REPLACES discovery, so a typo there narrows the gate to a string no document
        // will ever contain — and the run then reports a pass over a corpus it never really searched.
        // That is the exact failure this whole script is shaped to refuse, so a malformed id is loud.
        const result = run('--accounts', 'not-an-account', tree({ 'a.md': 'nothing here' }));

        expect(result.code).toBe(1);
        expect(result.out).toMatch(/12-digit/);
    });

    it('fails rather than sweeping when the target does not exist', () => {
        const result = run('--accounts', FIXTURE_ACCOUNT, path.join(tmpdir(), 'account-id-scrub-absent'));

        expect(result.code).toBe(1);
        expect(result.out).toMatch(/does not exist/i);
    });

    it('fails rather than sweeping when the target holds no files', () => {
        const result = run('--accounts', FIXTURE_ACCOUNT, tree({}));

        expect(result.code).toBe(1);
        expect(result.out).toMatch(/no files/i);
    });
});

describe('the scanner detects an account id and discriminates what is not one', () => {
    it('flags a real derived account id in a real repository file, without this test ever naming one', () => {
        // ⛔ THE END-TO-END NON-VACUITY PROOF. The script says which of its own sources it derived ids
        // from; one of those files is copied into a temp tree and must be flagged. Break discovery, or
        // break the matcher, and this goes red — while the real-`docs/` assertion below would happily
        // stay green. No account id is written here, printed, or read by this test.
        const source = report().sources[0];

        expect(source).toBeDefined();

        const root = tree({});
        const copy = path.join(root, 'copied', path.basename(source ?? ''));

        mkdirSync(path.dirname(copy), { recursive: true });
        copyFileSync(path.join(repoRoot, source ?? ''), copy);

        const result = run(root);

        expect(result.code).toBe(1);
        expect(result.out).toContain(path.basename(source ?? ''));
        // The report names the position and NOT the value — a failure log that printed the account id
        // would have leaked it into CI in order to announce that it must not leak.
        expect(result.out).not.toMatch(/\d{12}/);
    });

    it('flags a plain occurrence of a known account id', () => {
        const result = run('--accounts', FIXTURE_ACCOUNT, tree({ 'page.md': `run it in ${FIXTURE_ACCOUNT} today` }));

        expect(result.code).toBe(1);
        expect(result.out).toMatch(/page\.md:1/);
    });

    it('flags a literal ARN even for an account nothing else in the repository mentions', () => {
        // Rule 2, which closes discovery's blind spot: an id that appears ONLY in the scanned corpus is
        // by construction not discoverable from outside it.
        const result = run(
            '--accounts',
            FIXTURE_ACCOUNT,
            tree({ 'adr.md': `see \`arn:aws:sqs:us-east-1:${UNKNOWN_ACCOUNT}:queue\` for the shape` }),
        );

        expect(result.code).toBe(1);
        expect(result.out).toMatch(/adr\.md:1/);
    });

    it('flags a literal account id in an SQS queue URL', () => {
        const result = run(
            '--accounts',
            FIXTURE_ACCOUNT,
            tree({ 'q.md': `https://sqs.us-east-1.amazonaws.com/${UNKNOWN_ACCOUNT}/kitchensink-erasure-prod` }),
        );

        expect(result.code).toBe(1);
    });

    it('does NOT flag a named placeholder, which is what a scrubbed passage looks like', () => {
        const result = run(
            '--accounts',
            FIXTURE_ACCOUNT,
            tree({
                'adr.md': [
                    'Verified live against the project AWS account (`<aws-account-id>`).',
                    'See `arn:aws:sqs:us-east-1:<aws-account-id>:kitchensink-recipe-erasure-prod`.',
                ].join('\n'),
            }),
        );

        expect(result.code).toBe(0);
    });

    it('does NOT flag a 12-digit number that is not an account id', () => {
        // ⚠️ A REAL negative control, not a hypothetical: the pg18 execution record names the snapshot
        // `kitchensink-data-prod-pre-pg18-202608250618`, which is a 12-digit timestamp. A rule that
        // flagged any 12-digit run would fail that document forever, and the pressure would then be to
        // weaken the guard rather than the document.
        const result = run(
            '--accounts',
            FIXTURE_ACCOUNT,
            tree({ 'report.md': 'snapshot `kitchensink-data-prod-pre-pg18-202608250618` — available' }),
        );

        expect(result.code).toBe(0);
    });

    it('does NOT flag an account id that is merely a SUBSTRING of a longer number', () => {
        // ⚠️ FOUND BY RUNNING THIS GATE, not imagined. One of the ids it derives from the repository's own
        // CDK fixtures is twelve zeros, and `docs/architecture/decisions/0016-…md` discusses IEEE-754
        // round-tripping with the literal `10000000000000000`, which CONTAINS twelve zeros. The first
        // version of the matcher used `String.includes` and reported an ADR about JSON canonicalization as
        // an AWS credential leak. A gate that cries wolf on a correct document is a gate somebody deletes.
        const result = run(
            '--accounts',
            '000000000000',
            tree({ 'adr.md': "JSON's `10000000000000001` parses to `10000000000000000`, so canonicalizing…" }),
        );

        expect(result.code).toBe(0);
    });

    it('reports every offending line, not just the first', () => {
        const result = run(
            '--accounts',
            FIXTURE_ACCOUNT,
            tree({
                'a.md': `first ${FIXTURE_ACCOUNT}`,
                'b/c.md': `second ${FIXTURE_ACCOUNT}`,
            }),
        );

        expect(result.code).toBe(1);
        expect(result.out).toMatch(/a\.md:1/);
        expect(result.out).toMatch(/c\.md:1/);
    });
});

describe('the published corpus', () => {
    it('names no AWS account id anywhere under docs/', () => {
        // ⛔ THE ASSERTION THE OWNER'S RULING RESTS ON. The site is public; this is what makes that safe.
        const result = run('docs');

        expect(result.out).not.toMatch(/\d{12}/);
        expect(result.code).toBe(0);
    });
});
