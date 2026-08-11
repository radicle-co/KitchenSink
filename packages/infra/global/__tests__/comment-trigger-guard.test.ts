// @vitest-environment node
/**
 * Repo-wide guard: a PRIVILEGED job reachable from a COMMENT-shaped trigger must be gated on the
 * commenter's `author_association`, on the payload path that trigger actually uses.
 *
 * ## The failure this exists to make impossible
 *
 * This repository is PUBLIC. `issue_comment`, `pull_request_review_comment`, `pull_request_review`,
 * `issues`, `discussion` and `discussion_comment` are NOT `pull_request`: GitHub runs them in the BASE
 * repository's context on the DEFAULT branch, and it hands them the full `secrets` context no matter who
 * the actor is. (`pull_request` from a fork is structurally safe by comparison — GitHub withholds secrets
 * and downgrades the token — which is exactly why it is not in the set below.) So an unguarded
 * comment-triggered job with a secret in it is a job any GitHub user on the internet can start: it leaks
 * a long-lived credential into whatever action holds it, spends this account's quota and Actions minutes
 * on demand, and feeds attacker-authored prose to an agent that has a checkout.
 *
 * `.github/workflows/claude.yml` shipped in exactly that state and was caught in review, not by a tool.
 * Nothing in the toolchain models this class: `actionlint` validates syntax and contexts; CodeQL's
 * `actions` pack looks for injection and untrusted checkout; and **zizmor 1.29.0 has no audit for it** —
 * `dangerous-triggers` covers only `pull_request_target` and `workflow_run`, and the nearest thing,
 * `secrets-outside-env`, is `auditor`-persona-only, so `zizmor.yml`'s gate — now `--persona pedantic`
 * with no severity floor — still never sees it (persona and severity are ORTHOGONAL filters; raising the
 * floor alone changed nothing here). And even at `auditor` it would not have caught THIS bug:
 * `secrets-outside-env` asserts "no GitHub Environment scopes this secret", not "any stranger can trigger
 * this job" — it points at the same LINE for an unrelated reason. That is why the invariant lives here.
 *
 * ## Why it checks REACHABILITY rather than looking for a guard
 *
 * The interesting bug is not "no guard anywhere" — it is "a guard on three of the four branches", or "a
 * guard reading `github.event.issue.author_association` on an `issue_comment` event", where the path is
 * wrong so the expression yields `''`, which is falsy, so the branch it was meant to protect silently
 * never fires while the others stay open. Grepping for the string `author_association` passes both.
 *
 * So the question asked of every (job, event) pair is behavioural: **force the association atom for THAT
 * event's payload path to false, and the job must become unreachable.** A guard on the wrong path leaves
 * the atom unmatched, the `if` resolves to `unknown`, and the pair is reported. The evaluator is the
 * shared one in `./workflow-expression.ts` (see its header for why the atom resolver is a parameter);
 * this file supplies the policy, and its policy is "anything I do not model is UNKNOWN, i.e. it might let
 * the job run" — so the guard never invents a violation, it only ever misses one.
 *
 * A job may also be protected by a `needs` ancestor whose own `if` blocks the event, which is a legitimate
 * design (a cheap gate job in front of an expensive privileged one). That counts, unless the dependent
 * opts out of the implicit `success()` with `always()` / `!cancelled()` / `!failure()`, in which case a
 * skipped gate does not skip it. A STEP-level `if` deliberately does NOT count: the runner is provisioned,
 * the checkout happens and the action installs regardless, so two of the three risks land anyway.
 *
 * ## The second invariant: the allowed SET
 *
 * Reachability says nothing about *which* associations are admitted, so the membership expression is also
 * checked textually. `CONTRIBUTOR` only means "has had a commit merged" — permanent, reachable by anyone
 * whose typo fix was accepted, and not a grant of access to anything; `FIRST_TIME_CONTRIBUTOR`,
 * `FIRST_TIMER`, `MANNEQUIN` and `NONE` are strangers. And the test must be an ARRAY membership
 * (`contains(fromJSON('[…]'), …)`): `contains('OWNER MEMBER COLLABORATOR', x)` is a SUBSTRING match —
 * zizmor's `unsound-contains` class — which admits any value that happens to be a substring of the list.
 *
 * ## Mutation evidence (every assertion here has been watched fail)
 *
 * Fixtures carry the permanent proof, because a `toEqual([])` against a tree that happens to be clean
 * passes just as well when the analyzer is broken. Positive fixtures: no guard at all; a guard on three of
 * four branches; a guard on the WRONG payload path; a privileged-by-`permissions: write` job with no
 * guard; a `CONTRIBUTOR`-admitting set; a substring membership test. Negative controls that must stay
 * clean: the correct four-branch guard; a comment-triggered job with no secret and no write grant; a
 * secret job gated behind a guarded `needs` ancestor. Recorded analyzer mutations: stubbing
 * `findUnguardedPrivilegedJobs` to `[]` reds all four positive fixtures; deleting the wrong-path
 * distinction (resolving ANY `author_association` atom to false) makes `wrong-path.yml` pass; deleting the
 * `needs`-ancestor branch turns `gated-by-need.yml` into a false positive; deleting the `isSkipTolerant`
 * term makes `tolerant-need.yml` pass. Real tree: removing the association check from the
 * `pull_request_review` branch of `claude.yml` produced
 * `claude.yml::claude::pull_request_review` — which is the exact mutation the review comment described.
 */
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import { type Truth, closingParen, evaluateCondition, isSkipTolerant } from './workflow-expression.js';

const WORKFLOW_DIR = fileURLToPath(new URL('../../../../.github/workflows/', import.meta.url));

interface WorkflowJob {
    readonly needs?: string | readonly string[];
    readonly if?: string;
    readonly permissions?: Readonly<Record<string, string>> | string;
    readonly secrets?: unknown;
    readonly steps?: readonly unknown[];
    readonly with?: Readonly<Record<string, unknown>>;
    readonly env?: Readonly<Record<string, unknown>>;
}

interface WorkflowDocument {
    readonly on?: Readonly<Record<string, unknown>> | readonly string[] | string;
    readonly permissions?: Readonly<Record<string, string>> | string;
    readonly jobs?: Readonly<Record<string, WorkflowJob>>;
}

interface Workflow {
    readonly file: string;
    readonly doc: WorkflowDocument;
}

/**
 * Triggers that run in the BASE repository with the full `secrets` context while being fireable by an
 * arbitrary actor, mapped to the payload path carrying THAT event's author association.
 *
 * `pull_request` is deliberately absent: a fork PR gets no secrets and a read-only token, so the trust
 * boundary is enforced by GitHub rather than by an `if`. `workflow_dispatch` is absent because dispatching
 * already requires write access. `pull_request_target` / `workflow_run` are absent because they are a
 * different and worse class that zizmor's `dangerous-triggers` audit does cover.
 */
const UNTRUSTED_ACTOR_EVENTS: Readonly<Record<string, string>> = {
    issue_comment: 'github.event.comment.author_association',
    pull_request_review_comment: 'github.event.comment.author_association',
    pull_request_review: 'github.event.review.author_association',
    issues: 'github.event.issue.author_association',
    discussion: 'github.event.discussion.author_association',
    discussion_comment: 'github.event.comment.author_association',
};

/** Associations that are NOT a grant of repository access, and must never appear in an allowed set. */
const UNTRUSTED_ASSOCIATIONS: readonly string[] = [
    'CONTRIBUTOR',
    'FIRST_TIME_CONTRIBUTOR',
    'FIRST_TIMER',
    'MANNEQUIN',
    'NONE',
];

/** Parse every workflow in a directory, in filename order. */
function load(directory: string): readonly Workflow[] {
    return readdirSync(directory)
        .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
        .sort()
        .map((file) => ({ file, doc: parse(readFileSync(join(directory, file), 'utf8')) as WorkflowDocument }));
}

/** The real `.github/workflows/` tree. */
function realWorkflows(): readonly Workflow[] {
    return load(WORKFLOW_DIR);
}

/**
 * Write the given YAML bodies into a throwaway directory and parse them as a workflow tree.
 *
 * @sideEffect Creates a temp directory. Real workflow files are never touched.
 */
function fixture(files: Readonly<Record<string, string>>): readonly Workflow[] {
    const directory = mkdtempSync(join(tmpdir(), 'comment-trigger-guard-'));

    for (const [name, body] of Object.entries(files)) {
        writeFileSync(join(directory, name), body);
    }

    return load(directory);
}

/** The event names a workflow triggers on, however `on:` is written. */
function triggerEvents(doc: WorkflowDocument): readonly string[] {
    const on = doc.on;

    if (typeof on === 'string') {
        return [on];
    }

    if (Array.isArray(on)) {
        return on;
    }

    return Object.keys(on ?? {});
}

/** `needs:` normalised to a list. */
function needsOf(job: WorkflowJob): readonly string[] {
    if (job.needs === undefined) {
        return [];
    }

    return typeof job.needs === 'string' ? [job.needs] : job.needs;
}

/**
 * Whether a job carries privilege worth gating: it names a secret (directly or by forwarding the whole
 * context to a reusable workflow), or it holds any `write` permission on the automatic token.
 *
 * Serialised rather than walked field-by-field, because a secret can appear in a step's `with:`, a step's
 * `env:`, a job-level `env:`, a container's credentials, or a `secrets:` block on a `uses:` job — and a
 * walker that enumerates today's locations quietly stops covering tomorrow's.
 */
function isPrivileged(job: WorkflowJob, doc: WorkflowDocument): boolean {
    const body = JSON.stringify(job);

    if (/secrets\s*\.\s*[A-Za-z_]/.test(body) || /"secrets"\s*:/.test(body)) {
        return true;
    }

    const permissions = job.permissions ?? doc.permissions;

    if (typeof permissions === 'string') {
        return permissions === 'write-all';
    }

    return Object.values(permissions ?? {}).includes('write');
}

/**
 * Resolve one opaque `if` atom for the question "under event `event`, with the author association on
 * `associationPath` NOT in the allowed set, can this job still run?".
 *
 * Only two atom shapes are modelled — the event-name comparison and the association test. Everything else
 * is UNKNOWN, which propagates as "might be true", so an unmodelled term can only cost a finding, never
 * fabricate one.
 */
function guardAtomTruth(atom: string, event: string, associationPath: string): Truth {
    const trimmed = atom.trim();
    // Both operand orders occur in the wild (`github.event_name == 'x'` and `'x' == github.event_name`).
    const comparison =
        /^github\.event_name\s*(==|!=)\s*'([^']*)'$/.exec(trimmed) ??
        /^'([^']*)'\s*(==|!=)\s*github\.event_name$/.exec(trimmed);

    if (comparison !== null) {
        const [operator, literal] =
            comparison[1] === '==' || comparison[1] === '!='
                ? [comparison[1], comparison[2] ?? '']
                : [comparison[2] ?? '', comparison[1] ?? ''];

        return (operator === '==') === (literal === event) ? 'true' : 'false';
    }

    // The association atom for THIS event's path only. A guard reading a DIFFERENT event's path stays
    // UNKNOWN, which is what makes the wrong-path bug visible instead of accidentally credited.
    if (trimmed.includes(associationPath)) {
        return 'false';
    }

    return 'unknown';
}

/** Whether a condition definitely blocks the job when the association check fails under `event`. */
function blocksUntrustedAuthor(condition: string | undefined, event: string, associationPath: string): boolean {
    if (condition === undefined) {
        return false;
    }

    return evaluateCondition(condition, (atom) => guardAtomTruth(atom, event, associationPath)) === 'false';
}

/**
 * The `(file, job, event)` triples where a privileged job stays reachable under a comment-shaped trigger
 * even though the author's association is not in an allowed set. Pure.
 *
 * @param workflows - Parsed workflow tree.
 * @returns Sorted, compact violation ids.
 */
function findUnguardedPrivilegedJobs(workflows: readonly Workflow[]): readonly string[] {
    const violations: string[] = [];

    for (const { file, doc } of workflows) {
        const events = triggerEvents(doc).filter((event) => event in UNTRUSTED_ACTOR_EVENTS);

        if (events.length === 0) {
            continue;
        }

        const jobs = doc.jobs ?? {};

        for (const [name, job] of Object.entries(jobs)) {
            if (!isPrivileged(job, doc)) {
                continue;
            }

            for (const event of events) {
                const path = UNTRUSTED_ACTOR_EVENTS[event] as string;

                if (blocksUntrustedAuthor(job.if, event, path)) {
                    continue;
                }

                // A guarded `needs` ancestor also protects it — unless this job survives a skipped
                // dependency, in which case the gate does not gate.
                const guardedByAncestor =
                    !isSkipTolerant(job.if) &&
                    needsOf(job).some((dependency) => blocksUntrustedAuthor(jobs[dependency]?.if, event, path));

                if (!guardedByAncestor) {
                    violations.push(`${file}::${name}::${event}`);
                }
            }
        }
    }

    return [...violations].sort();
}

/**
 * Split a call's argument list on its TOP-LEVEL commas, ignoring commas inside quotes, nested calls or
 * array literals. Pure.
 *
 * Needed because a multi-branch `if` contains several `contains(…)` calls and a JSON array literal is full
 * of commas: a regex reading "up to the next comma" silently pairs one call's haystack with another call's
 * needle, which is how the first version of this analyzer reported four phantom findings on a correct file.
 */
function splitTopLevelArgs(argumentList: string): readonly string[] {
    const args: string[] = [];
    let depth = 0;
    let current = '';

    for (let index = 0; index < argumentList.length; index += 1) {
        const char = argumentList[index] as string;

        if (char === "'" || char === '"') {
            const end = argumentList.indexOf(char, index + 1);
            const close = end === -1 ? argumentList.length - 1 : end;

            current += argumentList.slice(index, close + 1);
            index = close;
            continue;
        }

        if (char === '(' || char === '[') {
            depth += 1;
        }

        if (char === ')' || char === ']') {
            depth -= 1;
        }

        if (char === ',' && depth === 0) {
            args.push(current);
            current = '';
            continue;
        }

        current += char;
    }

    args.push(current);

    return args.map((argument) => argument.trim());
}

/** Every `contains(haystack, needle)` call in a condition, arguments unparsed. Pure. */
function containsCalls(condition: string): readonly { readonly haystack: string; readonly needle: string }[] {
    const calls: { haystack: string; needle: string }[] = [];

    for (const match of condition.matchAll(/contains\s*\(/g)) {
        const open = match.index + match[0].length - 1;
        const args = splitTopLevelArgs(condition.slice(open + 1, closingParen(condition, open)));

        if (args.length === 2) {
            calls.push({ haystack: args[0] as string, needle: args[1] as string });
        }
    }

    return calls;
}

/**
 * Every `if` in the tree that tests an `author_association`, paired with the membership problems it has:
 * an untrusted association admitted, or a substring test standing in for array membership. Pure.
 *
 * @param workflows - Parsed workflow tree.
 * @returns Sorted, compact violation ids.
 */
function findWeakAssociationSets(workflows: readonly Workflow[]): readonly string[] {
    const violations: string[] = [];

    for (const { file, doc } of workflows) {
        for (const [name, job] of Object.entries(doc.jobs ?? {})) {
            const condition = job.if;

            if (condition === undefined || !condition.includes('author_association')) {
                continue;
            }

            for (const association of UNTRUSTED_ASSOCIATIONS) {
                if (new RegExp(`['"\\[,\\s]${association}['"\\],\\s]`).test(condition)) {
                    violations.push(`${file}::${name}::admits-${association}`);
                }
            }

            // `contains(<haystack>, <association>)` must take an ARRAY haystack, not a string.
            for (const call of containsCalls(condition)) {
                if (call.needle.includes('author_association') && !call.haystack.startsWith('fromJSON(')) {
                    violations.push(`${file}::${name}::substring-membership`);
                }
            }
        }
    }

    return [...violations].sort();
}

// ── Fixture bodies ────────────────────────────────────────────────────────────────────────────────────

/** The correct membership test, spelled once so the fixtures differ only where they mean to. */
const ALLOWED = `contains(fromJSON('["OWNER","MEMBER","COLLABORATOR"]'),`;

const SECRET_STEP = `        steps:
            - uses: third/party@v1
              with:
                  token: \${{ secrets.LONG_LIVED_TOKEN }}
`;

const FOUR_BRANCH_GUARDED = `name: guarded
on:
    issue_comment:
        types: [created]
    pull_request_review_comment:
        types: [created]
    pull_request_review:
        types: [submitted]
    issues:
        types: [opened]
jobs:
    agent:
        if: |
            (github.event_name == 'issue_comment' && contains(github.event.comment.body, '@bot') &&
                ${ALLOWED} github.event.comment.author_association)) ||
            (github.event_name == 'pull_request_review_comment' && contains(github.event.comment.body, '@bot') &&
                ${ALLOWED} github.event.comment.author_association)) ||
            (github.event_name == 'pull_request_review' && contains(github.event.review.body, '@bot') &&
                ${ALLOWED} github.event.review.author_association)) ||
            (github.event_name == 'issues' && contains(github.event.issue.body, '@bot') &&
                ${ALLOWED} github.event.issue.author_association))
        runs-on: ubuntu-latest
${SECRET_STEP}`;

/** The real defect: the `pull_request_review` branch lost its association check. */
const THREE_OF_FOUR = FOUR_BRANCH_GUARDED.replace('name: guarded', 'name: partial').replace(
    `(github.event_name == 'pull_request_review' && contains(github.event.review.body, '@bot') &&
                ${ALLOWED} github.event.review.author_association)) ||`,
    `(github.event_name == 'pull_request_review' && contains(github.event.review.body, '@bot')) ||`,
);

const NO_GUARD = `name: open
on:
    issue_comment:
        types: [created]
jobs:
    agent:
        if: contains(github.event.comment.body, '@bot')
        runs-on: ubuntu-latest
${SECRET_STEP}`;

/** `issue_comment` guarded on the ISSUE author's association — a path that is always \`''\` here. */
const WRONG_PATH = `name: wrong-path
on:
    issue_comment:
        types: [created]
jobs:
    agent:
        if: |
            contains(github.event.comment.body, '@bot') &&
            ${ALLOWED} github.event.issue.author_association)
        runs-on: ubuntu-latest
${SECRET_STEP}`;

/** No secret, but a write grant on the automatic token — still privilege an outsider must not drive. */
const WRITE_GRANT = `name: write-grant
on:
    issue_comment:
        types: [created]
jobs:
    labeller:
        if: contains(github.event.comment.body, '@bot')
        runs-on: ubuntu-latest
        permissions:
            issues: write
        steps:
            - run: gh issue edit "$NUMBER" --add-label triaged
`;

/** Comment-triggered but unprivileged: no secret, read-only token. Must stay clean. */
const UNPRIVILEGED = `name: harmless
on:
    issue_comment:
        types: [created]
permissions:
    contents: read
jobs:
    echo:
        runs-on: ubuntu-latest
        steps:
            - run: echo hello
`;

/** The secret job is gated behind a guarded ancestor. Legitimate; must stay clean. */
const GATED_BY_NEED = `name: gated
on:
    issue_comment:
        types: [created]
jobs:
    gate:
        if: |
            contains(github.event.comment.body, '@bot') &&
            ${ALLOWED} github.event.comment.author_association)
        runs-on: ubuntu-latest
        steps:
            - run: echo ok
    agent:
        needs: gate
        runs-on: ubuntu-latest
${SECRET_STEP}`;

/** Same shape, but the dependent survives a skipped gate — so the gate does not gate. */
const TOLERANT_NEED = GATED_BY_NEED.replace('name: gated', 'name: tolerant').replace(
    `        needs: gate
        runs-on: ubuntu-latest`,
    `        needs: gate
        if: \${{ !cancelled() }}
        runs-on: ubuntu-latest`,
);

/** Reachability is fine; the SET is not. */
const ADMITS_CONTRIBUTOR = `name: too-wide
on:
    issue_comment:
        types: [created]
jobs:
    agent:
        if: |
            contains(github.event.comment.body, '@bot') &&
            contains(fromJSON('["OWNER","MEMBER","COLLABORATOR","CONTRIBUTOR"]'), github.event.comment.author_association)
        runs-on: ubuntu-latest
${SECRET_STEP}`;

/** Reachability is fine; the membership test is a substring match. */
const SUBSTRING_MEMBERSHIP = `name: unsound
on:
    issue_comment:
        types: [created]
jobs:
    agent:
        if: |
            contains(github.event.comment.body, '@bot') &&
            contains('OWNER MEMBER COLLABORATOR', github.event.comment.author_association)
        runs-on: ubuntu-latest
${SECRET_STEP}`;

// ── Assertions ────────────────────────────────────────────────────────────────────────────────────────

describe('comment-triggered privileged jobs are gated on author_association', () => {
    const workflows = realWorkflows();

    it('pins which jobs in the real tree the guard applies to', () => {
        const covered = workflows.flatMap(({ file, doc }) => {
            const events = triggerEvents(doc).filter((event) => event in UNTRUSTED_ACTOR_EVENTS);

            return events.length === 0
                ? []
                : Object.entries(doc.jobs ?? {})
                      .filter(([, job]) => isPrivileged(job, doc))
                      .map(([name]) => `${file}::${name}`);
        });

        // NOT `expect(covered).not.toEqual([])`. That was the first version and it was wrong: it would have
        // made DELETING `claude.yml` fail the suite, i.e. mandated the continued existence of a secret-bearing
        // comment-triggered workflow. A repo with none of them is the SAFEST state, not a broken one.
        //
        // The analyzer's own correctness does not need the real tree for evidence — the fixtures below cover
        // it, and they cover `isPrivileged` in particular: `NO_GUARD` can only be reported if `isPrivileged`
        // returns true for it. So this assertion's job is narrower and purely informational: pin the set the
        // tree currently has, so ADDING one is visible in a diff of this file rather than only in a passing
        // run. Removing `claude.yml` is then a one-line edit here, with no pressure to keep it alive.
        expect(covered).toEqual(['claude.yml::claude']);
    });

    it('every one of them is unreachable for an untrusted author, on every event it triggers on', () => {
        expect(
            findUnguardedPrivilegedJobs(workflows),
            'a privileged job on a comment-shaped trigger can still run when the author is not OWNER/' +
                'MEMBER/COLLABORATOR. This repository is PUBLIC, and these events carry the full secrets ' +
                'context regardless of actor: add the association check for the reported event, on ITS ' +
                'payload path (issue_comment / pull_request_review_comment -> github.event.comment, ' +
                'pull_request_review -> github.event.review, issues -> github.event.issue).',
        ).toEqual([]);
    });

    it('no allowed set admits an untrusted association, and membership is an array test', () => {
        expect(
            findWeakAssociationSets(workflows),
            'an author_association guard either admits an association that is not a grant of repository ' +
                'access (CONTRIBUTOR only means "has had a commit merged"), or tests membership with a ' +
                'substring `contains(\'A B C\', x)` instead of `contains(fromJSON(\'["A","B","C"]\'), x)`.',
        ).toEqual([]);
    });

    describe('the analyzers actually fire (fixtures)', () => {
        it('flags a comment-triggered secret job with no guard at all', () => {
            expect(findUnguardedPrivilegedJobs(fixture({ 'open.yml': NO_GUARD }))).toEqual([
                'open.yml::agent::issue_comment',
            ]);
        });

        it('flags ONLY the branch that lost its association check', () => {
            expect(findUnguardedPrivilegedJobs(fixture({ 'partial.yml': THREE_OF_FOUR }))).toEqual([
                'partial.yml::agent::pull_request_review',
            ]);
        });

        it('flags a guard placed on another event`s payload path', () => {
            expect(findUnguardedPrivilegedJobs(fixture({ 'wrong-path.yml': WRONG_PATH }))).toEqual([
                'wrong-path.yml::agent::issue_comment',
            ]);
        });

        it('flags a write-granting job even when it holds no secret', () => {
            expect(findUnguardedPrivilegedJobs(fixture({ 'write-grant.yml': WRITE_GRANT }))).toEqual([
                'write-grant.yml::labeller::issue_comment',
            ]);
        });

        it('does NOT flag the correct four-branch guard', () => {
            expect(findUnguardedPrivilegedJobs(fixture({ 'guarded.yml': FOUR_BRANCH_GUARDED }))).toEqual([]);
        });

        it('does NOT flag a comment-triggered job with no secret and no write grant', () => {
            expect(findUnguardedPrivilegedJobs(fixture({ 'harmless.yml': UNPRIVILEGED }))).toEqual([]);
        });

        it('does NOT flag a secret job gated behind a guarded needs ancestor', () => {
            expect(findUnguardedPrivilegedJobs(fixture({ 'gated.yml': GATED_BY_NEED }))).toEqual([]);
        });

        it('DOES flag it again when the dependent survives a skipped gate', () => {
            expect(findUnguardedPrivilegedJobs(fixture({ 'tolerant.yml': TOLERANT_NEED }))).toEqual([
                'tolerant.yml::agent::issue_comment',
            ]);
        });

        it('flags an allowed set that admits CONTRIBUTOR', () => {
            expect(findWeakAssociationSets(fixture({ 'too-wide.yml': ADMITS_CONTRIBUTOR }))).toEqual([
                'too-wide.yml::agent::admits-CONTRIBUTOR',
            ]);
        });

        it('flags a substring membership test', () => {
            expect(findWeakAssociationSets(fixture({ 'unsound.yml': SUBSTRING_MEMBERSHIP }))).toEqual([
                'unsound.yml::agent::substring-membership',
            ]);
        });

        it('does NOT flag the correct fromJSON membership test', () => {
            expect(findWeakAssociationSets(fixture({ 'guarded.yml': FOUR_BRANCH_GUARDED }))).toEqual([]);
        });
    });
});
