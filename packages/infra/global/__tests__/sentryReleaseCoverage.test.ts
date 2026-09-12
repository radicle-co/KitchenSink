// @vitest-environment node
/**
 * Repo-wide guard: **every runtime that reports to Sentry creates a release for the build it reports from.**
 *
 * ## Why this is not cosmetic
 *
 * A Sentry release is the key an event's stack trace is symbolicated against. Without one, a production
 * stack trace points at the bundled artifact — `handlers/parseLine.js:1:412093` — and the issue is
 * unreadable by the person paged for it. It fails in the direction that looks fine: events arrive, they
 * group, they alert, and the only symptom is that nobody can act on them.
 *
 * ## What was actually here
 *
 * ONE deployable uploaded source maps — identity-webhooks — in a hand-rolled block, and the other five Node
 * deployables uploaded nothing at all. That block also never CREATED the release, so its maps were uploaded
 * against a version Sentry had no record of. Both are the same failure this guard exists for: a per-site
 * copy that only one site has.
 *
 * ## The derivation
 *
 * The obligation is derived from the STACKS, not from a list kept here: a runtime owes a release exactly
 * when its infrastructure injects a `SENTRY_DSN`, because that is what makes it report at all. A new
 * deployable that wires a DSN and no release step fails this without anybody remembering to add it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import { productionSources, readSource, withoutTsComments } from './roleSplitSources.js';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const PROD_DEPLOY = join(REPO_ROOT, '.github', 'workflows', 'prod-deploy.yml');
const ACTION = join(REPO_ROOT, '.github', 'actions', 'sentry-release', 'action.yml');

/**
 * Runtimes whose infra wires a DSN but which are deliberately released by no step, each with the reason.
 *
 * ⛔ A NAME HERE IS A DECISION, not a backlog. Both entries are cases where a release would associate with
 * nothing, not cases somebody has not got to yet.
 */
const NO_RELEASE_OWED: Readonly<Record<string, string>> = {
    // Lambda@Edge cannot read environment variables, so the verifier sends no `release` — maps uploaded
    // against one would attach to a version no event carries. Its DSN is compiled in at build time
    // (`edgeObservability.ts`), which is the same constraint seen from the other side.
    EdgeStack: 'Lambda@Edge sends no release: it cannot read environment variables',
    // Python. `sentry-cli sourcemaps` is a JavaScript tool, and the engine's release is its pinned version
    // rather than the commit (ADR-0025) — `observability.py` sends that, and there are no maps to upload.
    IngredientParserStack: 'Python: the release is the pinned engine version, and there are no JS maps',
};

/** Infra files that inject a `SENTRY_DSN` into something they deploy. */
function stacksWiringADsn(): readonly string[] {
    return productionSources()
        .filter((path) => /infra\/lib\/.*Stack\.ts$/u.test(path) || /lib\/platform\/.*Stack\.ts$/u.test(path))
        .filter((path) => withoutTsComments(readSource(path)).includes('SENTRY_DSN'))
        .map((path) => (path.split('/').pop() ?? '').replace(/\.ts$/u, ''))
        .sort();
}

/** The Sentry projects `prod-deploy.yml` creates a release for, via the shared action. */
function projectsWithAReleaseStep(): readonly string[] {
    const workflow = parse(readFileSync(PROD_DEPLOY, 'utf8')) as {
        jobs?: Record<string, { steps?: { uses?: string; with?: Record<string, unknown> }[] }>;
    };
    const projects = Object.values(workflow.jobs ?? {})
        .flatMap((job) => job.steps ?? [])
        .filter((step) => (step.uses ?? '').includes('actions/sentry-release'))
        .map((step) => (typeof step.with?.['project'] === 'string' ? step.with['project'] : ''));

    return [...new Set(projects)].sort();
}

describe('every reporting runtime creates a release', () => {
    it('discovers the stacks that wire a DSN — an empty scan would pass everything below', () => {
        expect(stacksWiringADsn().length).toBeGreaterThanOrEqual(5);
    });

    /**
     * ⛔ THE COUNT IS DERIVED FROM THE STACKS, so a new deployable that wires a DSN owes a release without
     * anybody editing this file. What it may not do is wire a DSN and quietly release nothing.
     */
    it('⛔ leaves no DSN-wired stack without a release step or a stated reason', () => {
        const owed = stacksWiringADsn().filter((stack) => NO_RELEASE_OWED[stack] === undefined);
        const released = projectsWithAReleaseStep();

        // One release step per owed stack. Compared by COUNT rather than by name, because a stack's name and
        // its Sentry project's slug are different vocabularies and mapping them here would be a third copy
        // of that mapping — the stacks own it, and `SENTRY_OBSERVABILITY_SETUP.md` documents it.
        expect(released.length, `stacks owed a release: ${owed.join(', ')}`).toBeGreaterThanOrEqual(owed.length);
    });

    it('⛔ releases every project through the ONE composite action, never a hand-rolled block', () => {
        const raw = readFileSync(PROD_DEPLOY, 'utf8');
        const inlineUploads = raw
            .split('\n')
            .filter((line) => /sentry-cli\s+(sourcemaps|releases)/u.test(line) && !line.trimStart().startsWith('#'));

        expect(inlineUploads, 'source-map upload belongs in .github/actions/sentry-release').toEqual([]);
    });

    /**
     * ⛔ THE RELEASE MUST BE THE COMMIT, because that is what every runtime sends. `Sentry.init` reads
     * `SENTRY_RELEASE`, the stacks set it to the commit SHA, and an upload under any other identifier
     * associates the maps with a version no event carries — which looks exactly like no upload at all.
     */
    it('⛔ releases under the commit SHA, matching what the runtimes send', () => {
        const workflow = parse(readFileSync(PROD_DEPLOY, 'utf8')) as {
            jobs?: Record<string, { steps?: { uses?: string; with?: Record<string, unknown> }[] }>;
        };
        const releases = Object.values(workflow.jobs ?? {})
            .flatMap((job) => job.steps ?? [])
            .filter((step) => (step.uses ?? '').includes('actions/sentry-release'))
            .map((step) => (typeof step.with?.['release'] === 'string' ? step.with['release'] : ''));

        expect(releases.length).toBeGreaterThan(0);

        for (const release of releases) {
            expect(release).toBe('${{ github.sha }}');
        }
    });

    it('⛔ creates the release before uploading to it — an upload to a nonexistent release is orphaned', () => {
        const action = readFileSync(ACTION, 'utf8');
        const newAt = action.indexOf('releases new');
        const uploadAt = action.indexOf('sourcemaps upload');
        const finalizeAt = action.indexOf('releases finalize');

        expect(newAt).toBeGreaterThan(-1);
        expect(uploadAt).toBeGreaterThan(newAt);
        expect(finalizeAt).toBeGreaterThan(uploadAt);
    });
});
