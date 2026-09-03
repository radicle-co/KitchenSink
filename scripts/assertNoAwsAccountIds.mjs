#!/usr/bin/env node
/**
 * ⛔ THE CONTROL THAT LETS THE DOCUMENTATION SITE BE PUBLIC.
 *
 * `.github/workflows/docs.yml` publishes `packages/tools/docs-site` — a rendering of an allowlisted slice
 * of `docs/**` — to the open internet. It was designed to publish PRIVATELY, behind Vercel
 * Authentication; that protection is not available on this team's Vercel plan, and the failure is silent
 * rather than loud: the API accepts an `ssoProtection` setting it does not enforce, and a preview
 * deployment was observed serving real content to an anonymous request. The owner's ruling is that the
 * site is public and that the AWS account id must not be in it.
 *
 * Confidentiality therefore no longer comes from access control. It comes from the corpus not containing
 * the thing, and this script is what makes that a checked property instead of a hope. It runs in two
 * places, for two different failure modes:
 *
 *   • over `docs/` from `packages/infra/global/__tests__/assertNoAwsAccountIds.test.ts`, so an author
 *     finds out at `npm run test` — before review, let alone before publication;
 *   • over the BUILT SITE in `docs.yml`, before the artifact is uploaded, so anything that reaches the
 *     rendered output by a route the source scan does not model (a generated section, a plugin's
 *     metadata, a copied asset) is still caught, and caught before a deploy exists.
 *
 * ── WHY THE ACCOUNT ID IS DISCOVERED AND NEVER WRITTEN DOWN ───────────────────────────────────────────
 *
 * The obvious spelling of this gate is `grep -r '<the account id>' docs/`. That publishes the value one
 * more time, into a file that is read far more often than the document it was scrubbed out of — and into
 * this gate's own failure output, i.e. into CI logs, at exactly the moment everyone is looking. So:
 *
 *   1. The ids are DERIVED, at run time, from the ARNs / SQS queue URLs / ECR hosts this repository's own
 *      tracked sources already contain. `docs/` is excluded from that derivation, so a leak inside the
 *      published corpus can never be the thing that justifies itself.
 *   2. Nothing this script prints contains an account id. Violations are reported as `path:line` with the
 *      RULE that fired; `--report` masks the derived ids to first-two/last-two.
 *
 * The derivation also makes the gate wider than its brief: it asserts that no account id this repository
 * is known to use appears in the corpus, so a second AWS account is covered from the day it is first
 * referenced, with no edit here.
 *
 * ── THE SECOND RULE, WHICH DOES NOT DEPEND ON DISCOVERY ───────────────────────────────────────────────
 *
 * Discovery has a blind spot with teeth: an account id present ONLY in the scanned corpus is, by
 * construction, not discoverable from outside it. Rule 2 closes it from the other side — an ARN, an SQS
 * queue URL or an ECR host carrying a LITERAL 12-digit account field is a violation whatever the digits
 * are. A scrubbed passage reading `arn:aws:sqs:us-east-1:<aws-account-id>:…` passes; one that pastes a
 * real ARN back in does not, even for an account nothing else in the tree mentions.
 *
 * ⛔ Rule 2 is deliberately ARN-SHAPED and not "any 12 digits". `docs/` legitimately contains a 12-digit
 * TIMESTAMP (`kitchensink-data-prod-pre-pg18-202608250618`, the pg18 rollback snapshot). A rule that
 * flagged any 12-digit run would fail that document permanently, and the pressure would be to weaken the
 * gate rather than to fix a document that has nothing wrong with it.
 *
 * ⚠️ ONE KNOWN FRICTION, stated so it is not mistaken for a bug. Discovery cannot tell a real account
 * from a synthetic one, so the ids it derives include the placeholders this repository's CDK fixtures
 * use — twelve zeros, and AWS's own canonical example `1234…`. A future document that writes AWS's
 * example account id verbatim will therefore be flagged. That is the right trade in both directions:
 * the alternative is an allowlist of "ids that are fine to publish", which is exactly where the real one
 * eventually gets hidden by mistake — and the fix for the flagged document is to use the same
 * `<aws-account-id>` placeholder as everything else, which reads better anyway.
 *
 * ── FAILING CLOSED, IN THREE PLACES ───────────────────────────────────────────────────────────────────
 *
 * An absence assertion passes when it is broken, which is the worst property a gate can have. This one
 * exits NON-ZERO, rather than reporting a clean sweep, when:
 *
 *   • discovery yields no account id at all (the control has lost its oracle);
 *   • a target path does not exist (a moved build directory would otherwise "pass");
 *   • a target holds no readable file (a walk that reached nothing proves nothing).
 *
 * ── USAGE ────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   node scripts/assertNoAwsAccountIds.mjs <target> [<target>…]
 *   node scripts/assertNoAwsAccountIds.mjs --accounts 123456789012,… <target>   # override discovery
 *   node scripts/assertNoAwsAccountIds.mjs --report                             # masked ids + sources
 *   node scripts/assertNoAwsAccountIds.mjs --root <dir> …                       # repository to derive from
 *
 * `--accounts` exists so the suite can exercise the scanner hermetically against placeholder ids, the way
 * `scripts/boundariesRatchet.mjs` takes `--stdin`: the alternative is a test that must know the real value
 * in order to check that the real value is absent.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The shapes in which an AWS account id appears VERBATIM in a resource identifier.
 *
 * Each is the account field of something AWS itself defines, which is what makes a 12-digit match here
 * evidence rather than coincidence:
 *  - an ARN's fifth colon-delimited field (`arn:aws:sqs:us-east-1:<account>:queue-name`),
 *  - an SQS queue URL's first path segment,
 *  - an ECR registry host's leading label.
 */
const ACCOUNT_BEARING_SHAPES = [
    { id: 'arn', pattern: /arn:aws[a-z0-9-]*:[a-z0-9-]+:[a-z0-9-]*:(\d{12}):/g },
    { id: 'sqs-url', pattern: /sqs\.[a-z0-9-]+\.amazonaws\.com\/(\d{12})\//g },
    { id: 'ecr-host', pattern: /(?<!\d)(\d{12})\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com/g },
];

/** Extensions whose bytes are not prose and would only add noise to a line-numbered report. */
const BINARY_EXTENSIONS = new Set([
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.ico',
    '.webp',
    '.avif',
    '.woff',
    '.woff2',
    '.ttf',
    '.otf',
    '.eot',
    '.pdf',
    '.zip',
    '.gz',
    '.tgz',
    '.mp4',
    '.webm',
    '.mp3',
]);

/** Directories never worth walking, in either a repository or a build output. */
const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules']);

/**
 * Every account id appearing in an account-bearing shape in `text`.
 *
 * Pure.
 */
function accountsIn(text) {
    const found = new Set();

    for (const { pattern } of ACCOUNT_BEARING_SHAPES) {
        // A `g` regex carries `lastIndex` across calls; a fresh one per invocation keeps this pure.
        for (const match of text.matchAll(new RegExp(pattern.source, 'g'))) {
            found.add(match[1]);
        }
    }

    return found;
}

/**
 * Every file under `target`, recursively.
 *
 * @sideEffect Reads the filesystem.
 */
function filesUnder(target) {
    const stats = statSync(target);

    if (!stats.isDirectory()) {
        return [target];
    }

    const collected = [];

    for (const entry of readdirSync(target, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!SKIPPED_DIRECTORIES.has(entry.name)) {
                collected.push(...filesUnder(path.join(target, entry.name)));
            }

            continue;
        }

        if (entry.isFile() && !BINARY_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
            collected.push(path.join(target, entry.name));
        }
    }

    return collected;
}

/**
 * The account ids this repository is known to use, and the tracked files they were derived from.
 *
 * `docs/` is excluded on purpose: the corpus under audit must not be able to supply its own oracle.
 *
 * @sideEffect Runs `git ls-files` and reads the tracked tree.
 */
function discover(root) {
    const listing = execFileSync('git', ['ls-files', '-z'], {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
    });
    const accounts = new Set();
    const sources = [];

    for (const relative of listing.split('\0')) {
        if (relative === '' || relative.startsWith('docs/')) {
            continue;
        }

        if (BINARY_EXTENSIONS.has(path.extname(relative).toLowerCase())) {
            continue;
        }

        const absolute = path.join(root, relative);

        // A tracked path can be absent from the worktree mid-operation; that is not this gate's business.
        if (!existsSync(absolute)) {
            continue;
        }

        const inFile = accountsIn(readFileSync(absolute, 'utf8'));

        if (inFile.size === 0) {
            continue;
        }

        sources.push(relative);

        for (const account of inFile) {
            accounts.add(account);
        }
    }

    return { accounts: [...accounts], sources };
}

/**
 * Every violation in `text`, as `{ line, rule }`.
 *
 * Pure. Rule 1 is "a known account id, in any form at all"; rule 2 is "an account-bearing shape carrying
 * literal digits", which holds for an account rule 1 has never heard of.
 */
function violationsIn(text, accounts) {
    const found = [];
    // ⚠️ DIGIT-BOUNDED, not `includes`. Found by running this gate: one of the ids it derives from the
    // repository's own CDK fixtures is twelve zeros, and `docs/architecture/decisions/0016-…md` discusses
    // IEEE-754 round-tripping using the literal `10000000000000000` — which CONTAINS twelve zeros. A
    // substring match reported an ADR about JSON canonicalization as an AWS credential leak. A gate that
    // cries wolf on a correct document is a gate somebody eventually deletes.
    const bounded = accounts.map((account) => new RegExp(`(?<!\\d)${account}(?!\\d)`));

    text.split('\n').forEach((line, index) => {
        if (bounded.some((pattern) => pattern.test(line))) {
            found.push({ line: index + 1, rule: 'names a known AWS account id' });

            return;
        }

        if (accountsIn(line).size > 0) {
            found.push({ line: index + 1, rule: 'embeds a literal 12-digit account id in an AWS identifier' });
        }
    });

    return found;
}

/** First two and last two digits, which distinguishes two accounts without restating either. */
function mask(account) {
    return `${account.slice(0, 2)}...${account.slice(-2)}`;
}

function fail(message) {
    console.error(`::error title=AWS account id guard::${message}`);
    process.exit(1);
}

function main(argv) {
    let root = DEFAULT_ROOT;
    let overriddenAccounts;
    let wantsReport = false;
    const targets = [];

    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];

        if (argument === '--report') {
            wantsReport = true;
        } else if (argument === '--root') {
            index += 1;
            root = path.resolve(argv[index] ?? '');
        } else if (argument === '--accounts') {
            index += 1;
            overriddenAccounts = (argv[index] ?? '').split(',').filter((value) => value !== '');

            // ⛔ VALIDATED, because this option REPLACES the oracle. A typo that reaches here silently
            // narrows the gate to a string nothing will ever match, and the run then reports a pass —
            // the one failure mode this whole script is shaped to refuse.
            const malformed = overriddenAccounts.filter((value) => !/^\d{12}$/.test(value));

            if (malformed.length > 0) {
                fail(
                    `--accounts takes 12-digit ids; ${malformed.length} entr(y|ies) are not, so the gate would search for something that cannot exist.`,
                );
            }
        } else if (argument.startsWith('--')) {
            fail(`unknown option ${argument}. See the header of scripts/assertNoAwsAccountIds.mjs.`);
        } else {
            targets.push(argument);
        }
    }

    const discovered =
        overriddenAccounts === undefined ? discover(root) : { accounts: overriddenAccounts, sources: [] };

    if (wantsReport) {
        console.log(JSON.stringify({ accounts: discovered.accounts.map(mask), sources: discovered.sources }));

        return;
    }

    // ⛔ FAIL CLOSED #1 — no oracle. A sweep for nothing finds nothing and looks identical to a pass.
    if (discovered.accounts.length === 0) {
        fail(
            'derived no AWS account id from the repository, so this check would have swept for nothing and ' +
                'reported a pass it never earned. Either the tracked sources no longer contain an ARN, an SQS ' +
                'queue URL or an ECR host, or --root points somewhere that is not this repository.',
        );
    }

    if (targets.length === 0) {
        fail('no target given. Usage: node scripts/assertNoAwsAccountIds.mjs <target> [<target>…]');
    }

    const files = [];

    for (const target of targets) {
        const absolute = path.resolve(root, target);

        // ⛔ FAIL CLOSED #2 — a target that moved. Skipping it would report a clean sweep over nothing.
        if (!existsSync(absolute)) {
            fail(`target does not exist: ${target}. Refusing to report a pass over a path that is not there.`);
        }

        files.push(...filesUnder(absolute).map((file) => ({ absolute: file, label: path.relative(root, file) })));
    }

    // ⛔ FAIL CLOSED #3 — the walk reached nothing.
    if (files.length === 0) {
        fail(`the target holds no files to scan (${targets.join(', ')}), so this check proved nothing.`);
    }

    const violations = [];

    for (const file of files) {
        for (const { line, rule } of violationsIn(readFileSync(file.absolute, 'utf8'), discovered.accounts)) {
            violations.push(`  ${file.label}:${line} — ${rule}`);
        }
    }

    if (violations.length > 0) {
        // Positions, never values: a failure log that printed the account id would leak it into CI in
        // order to announce that it must not leak.
        console.error(
            `::error title=AWS account id in the published corpus::${violations.length} occurrence(s). The ` +
                'documentation site is PUBLIC (docs.yml header), so an AWS account id in it is published. ' +
                'Replace each with the placeholder `<aws-account-id>` and keep the surrounding prose meaningful.',
        );
        console.error(violations.join('\n'));
        process.exit(1);
    }

    console.log(
        `no AWS account id in ${files.length} file(s) under ${targets.join(', ')} ` +
            `(${discovered.accounts.length} account id(s) searched for)`,
    );
}

main(process.argv.slice(2));
