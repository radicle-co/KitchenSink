// @vitest-environment node
import assert from 'node:assert';
import { readFileSync, globSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseDsn } from '../src/observability/sentryEnvelope.js';
import {
    announceSilentNoOp,
    buildSilentNoOpEnvelope,
    reportSilentNoOp,
    SILENT_NOOP_DEADLINE_MS,
    type SilentNoOp,
} from '../src/observability/silentNoOp.js';

const DSN = 'https://abc123@o1.ingest.sentry.io/456';

const NO_OP: SilentNoOp = {
    service: 'db-bootstrap',
    stage: 'sandbox',
    condition: 'per-pr-reclamation-disabled',
    detail: 'the rollback released the master from the owner role the reaper inherits',
};

afterEach(() => {
    vi.restoreAllMocks();
});

/**
 * ⛔ THE DSN PARSER IS ONE FUNCTION, SHARED WITH THE EDGE REPORTER.
 *
 * It was written for `edgeObservability.ts` and lifted here rather than copied, because a Sentry DSN's shape
 * is one piece of knowledge: a second copy would be a second thing to fix when Sentry's ingest path changes,
 * and the way a copy fails is that only one of them gets fixed.
 */
describe('the shared DSN parser', () => {
    it('decomposes a DSN into the ingest URL and the key', () => {
        expect(parseDsn(DSN)).toEqual({ url: 'https://o1.ingest.sentry.io/api/456/envelope/', key: 'abc123' });
    });

    it('answers undefined for anything it cannot use, rather than throwing', () => {
        expect(parseDsn('')).toBeUndefined();
        expect(parseDsn('not-a-url')).toBeUndefined();
        expect(parseDsn('https://o1.ingest.sentry.io/456')).toBeUndefined();
    });
});

describe('the silent-no-op envelope', () => {
    /**
     * ⛔ IT IS A MESSAGE EVENT WITH AN EXPLICIT FINGERPRINT, and both halves matter.
     *
     * A message rather than an exception, because nothing threw — the function ran to completion and did
     * nothing, which is the entire point. And an explicit fingerprint because Sentry groups a message by its
     * text: two different platform functions reporting two different silent no-ops would otherwise be one
     * issue, and the second would be filed as a duplicate of the first and never read.
     */
    it('⛔ groups by service and condition, not by the message text', () => {
        const bootstrap = JSON.parse(buildSilentNoOpEnvelope(NO_OP).split('\n')[2] as string) as {
            fingerprint?: readonly string[];
        };
        const reaper = JSON.parse(
            buildSilentNoOpEnvelope({ ...NO_OP, service: 'db-reaper' }).split('\n')[2] as string,
        ) as { fingerprint?: readonly string[] };

        expect(bootstrap.fingerprint).toBeDefined();
        expect(reaper.fingerprint).not.toEqual(bootstrap.fingerprint);
    });

    /**
     * ⛔ ERROR LEVEL, not warning. A per-PR reclamation that has silently stopped means every abandoned
     * preview keeps billing until somebody notices, and the whole reason this report exists is that nobody
     * was going to. A warning is a thing a reader scrolls past.
     */
    it('⛔ reports at error level and tags the stage and the service', () => {
        const event = JSON.parse(buildSilentNoOpEnvelope(NO_OP).split('\n')[2] as string) as {
            level?: string;
            environment?: string;
            tags?: Record<string, string>;
        };

        expect(event.level).toBe('error');
        expect(event.environment).toBe('sandbox');
        expect(event.tags).toEqual({ service: 'db-bootstrap', condition: 'per-pr-reclamation-disabled' });
    });

    it('is a well-formed three-line envelope', () => {
        const lines = buildSilentNoOpEnvelope(NO_OP).split('\n');

        expect(JSON.parse(lines[1] as string)).toEqual({ type: 'event' });
        expect(lines[3]).toBe('');
    });
});

describe('reporting a silent no-op', () => {
    it('POSTs one envelope to the DSN’s ingest endpoint', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(''));

        expect(await reportSilentNoOp(NO_OP, DSN)).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0]?.[0]).toBe('https://o1.ingest.sentry.io/api/456/envelope/');
    });

    /**
     * ⛔ NO DSN IS NOT AN ERROR. These functions run in stages that may have no Sentry parameter yet, and in
     * every local test. A reporter that threw would turn "observability is not configured" into "the database
     * bootstrap failed", which is the more damaging of the two by a wide margin.
     */
    it('⛔ is inert without a usable DSN, rather than throwing', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch');

        expect(await reportSilentNoOp(NO_OP, '')).toBe(false);
        expect(await reportSilentNoOp(NO_OP, 'not-a-dsn')).toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    /**
     * ⛔ A FAILED REPORT NEVER FAILS THE CALLER. The bootstrap is a CloudFormation custom resource: a throw
     * here fails the resource, which fails the stack, which is an outage caused by telemetry. The reporter
     * is strictly best-effort in both directions — it cannot fail the deploy, and it cannot hang it.
     */
    it('⛔ swallows an unreachable Sentry and answers false', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ENOTFOUND'));

        expect(await reportSilentNoOp(NO_OP, DSN)).toBe(false);
    });

    /**
     * ⛔ A REJECTED ENVELOPE IS NOT A SENT ONE. `fetch` rejects only on a transport failure, so an expired
     * DSN key (401), an oversized envelope (413) or a rate limit (429) all resolve — and this function used
     * to answer `true` for every one of them, claiming a delivery it never verified. In the module whose
     * entire subject is a success that is not one.
     */
    it('⛔ answers false for a Sentry response that refused the envelope', async () => {
        for (const status of [401, 413, 429, 500]) {
            vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status }));

            expect(await reportSilentNoOp(NO_OP, DSN), `status ${String(status)}`).toBe(false);
        }
    });

    /**
     * ⚠️ The clock is INJECTED, so `buildSilentNoOpEnvelope` is the pure function its docstring claims. It
     * read `new Date()` while documented `Pure.` — a small lie, and the kind that makes the next reader
     * distrust every other purity claim in the package.
     */
    it('takes its clock, so the envelope header is reproducible', () => {
        const at = new Date('2026-07-15T15:00:00Z');
        const header = JSON.parse(buildSilentNoOpEnvelope(NO_OP, () => at).split('\n')[0] as string) as {
            sent_at?: string;
        };

        expect(header.sent_at).toBe(at.toISOString());
    });

    it('is bounded by a deadline well inside a custom resource’s own timeout', () => {
        expect(SILENT_NOOP_DEADLINE_MS).toBeGreaterThan(0);
        expect(SILENT_NOOP_DEADLINE_MS).toBeLessThanOrEqual(3_000);
    });
});

/**
 * ⛔ THE FALLBACK IS THE BRANCH LEAST AFFORDABLE TO LEAVE UNPROVEN, and it shipped at two call sites with no
 * test at any tier — a green suite says nothing about a branch no test enters.
 *
 * ⚠️ That sentence used to quote the suite's size, and the figure was stale by nine within a day.
 * Refreshing it re-creates the defect on the next test added; the number was never the argument.
 * ADR-0004's consumer table rotted exactly that way, and its remedy is the apter citation here:
 * `natEgressConsumers.test.ts` reads the list out of the ADR's own marker block in both directions, which
 * is what it takes for a number in prose to stay true. A count nobody machine-checks does not get one.
 *
 * It exists because the reporter can fail: an expired DSN key, a 429, an unreachable Sentry. Without the
 * fallback that is a silent failure to report a silent failure, which is the same shape as the defect the
 * whole module is for, one level up. It lives in a function rather than inline at each handler precisely so
 * it can be reached without standing up a database and forcing a rollback — an empty DSN drives it here with
 * no network at all.
 */
describe('announcing a silent no-op when the report itself fails', () => {
    it('⛔ logs to the drain when there is no usable DSN, rather than saying nothing', async () => {
        const log = vi.fn();

        expect(await announceSilentNoOp(NO_OP, {}, log, '')).toBe(false);
        expect(log).toHaveBeenCalledTimes(1);
        expect(String(log.mock.calls[0]?.[0])).toContain('its Sentry report failed');
    });

    it('⛔ logs when Sentry REFUSED the envelope — a resolved 401 is not a delivery', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 401 }));
        const log = vi.fn();

        expect(await announceSilentNoOp(NO_OP, {}, log, DSN)).toBe(false);
        expect(log).toHaveBeenCalledTimes(1);
    });

    /** ⚠️ And it stays quiet when the report landed — a duplicate line is how a real one gets scrolled past. */
    it('does not log when the report landed', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(''));
        const log = vi.fn();

        expect(await announceSilentNoOp(NO_OP, {}, log, DSN)).toBe(true);
        expect(log).not.toHaveBeenCalled();
    });

    /**
     * ⛔ THE THREE PRECEDENCE LEVELS, ASSERTED. The drain line merges caller `context`, then the reported
     * `noOp`, then the label — and until this test, NOTHING held any of them: reverting the spread order left
     * the whole suite green, because no other test passes a colliding key. A comment claiming three
     * guarantees with none of them checked is the same defect this module's own history is made of.
     *
     * ⚠️ PARSED, NOT `toContain`. On the JSON string, `toContain` passes for a `message` that merely INCLUDES
     * the label — so a shadowing key appended to it would slip through the assertion meant to catch it.
     *
     * Each assertion kills a different reorder: shadowing `message` kills the first, shadowing a reported
     * field kills the second.
     */
    it('⛔ neither the label nor a reported field is shadowable by drain context', async () => {
        const log = vi.fn();

        await announceSilentNoOp(NO_OP, { message: 'shadowed', service: 'impostor' }, log, '');

        const line = JSON.parse(String(log.mock.calls[0]?.[0])) as { message?: string; service?: string };

        expect(line.message).toBe('silent no-op detected AND its Sentry report failed');
        expect(line.service).toBe('db-bootstrap');
    });

    /** The line carries the condition, so the drain's copy is as actionable as the Sentry issue would be. */
    it('names the service and the condition in the fallback line', async () => {
        const log = vi.fn();

        await announceSilentNoOp(NO_OP, {}, log, '');

        const line = String(log.mock.calls[0]?.[0]);

        expect(line).toContain('db-bootstrap');
        expect(line).toContain('per-pr-reclamation-disabled');
    });
});

/**
 * ⛔ THE DRAIN'S EXTRA CONTEXT NEVER REACHES SENTRY, and the split is the whole reason it is a separate
 * parameter rather than a field on the payload. `SilentNoOp` is the closed shape that leaves for Sentry — an
 * event outside every erasure path — while a CloudWatch group is a different sink with a different rule. The
 * bootstrap's database name belongs in the second and not the first, and a reader adding it to the payload
 * instead would be widening the wrong one.
 */
describe('the drain-only context', () => {
    it('⛔ appears in the fallback line', async () => {
        const log = vi.fn();

        await announceSilentNoOp(NO_OP, { database: 'kitchensink_recipe_pr_91' }, log, '');

        expect(String(log.mock.calls[0]?.[0])).toContain('kitchensink_recipe_pr_91');
    });

    /**
     * ⛔ READ OFF THE WIRE, and stated precisely because the obvious claim is wrong in both directions.
     *
     * The first version asserted on `buildSilentNoOpEnvelope(NO_OP)` — a function that takes no `context` at
     * all, against a fixture with no `database` field — so nothing anyone did to `announceSilentNoOp` could
     * make it red. A test that has never failed has proved nothing.
     *
     * ⚠️ AND THE MUTATION IT WAS SUPPOSED TO CATCH DOES NOT LEAK EITHER, which is the more useful finding.
     * Merging `context` into the payload — `reportSilentNoOp({ ...noOp, ...context }, dsn)` — sends nothing
     * extra, because `buildSilentNoOpEnvelope` names its fields one by one rather than spreading. THAT is
     * what actually keeps the drain's context off the wire, not the type and not the parameter split. Both
     * verified by mutation.
     *
     * So what this test covers is the TWO-edit path: somebody merges the context AND "simplifies" the builder
     * to spread its payload. Either edit alone is inert; together they put a per-PR database name into an
     * event that sits outside every erasure path, and neither the type nor a reviewer reading one file would
     * see it.
     */
    it('⛔ and never in the Sentry envelope', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(''));

        await announceSilentNoOp(NO_OP, { database: 'kitchensink_recipe_pr_91' }, vi.fn(), DSN);

        expect(fetchSpy).toHaveBeenCalledTimes(1);

        // ⚠️ Narrowed rather than stringified: a `BodyInit` can be a stream or a `FormData`, and
        // `String(…)` of one is `[object Object]` — a value no database name can ever appear in, which would
        // satisfy the assertion below without reading the envelope at all. `assert` narrows by its `asserts`
        // signature, so the reads below need no cast.
        const body = fetchSpy.mock.calls[0]?.[1]?.body;

        assert(typeof body === 'string');

        // ⛔ THE POSITIVE CONTROL FIRST, and it is not ceremony. Without it every assertion here is
        // satisfiable by an EMPTY body — change `body:` in the reporter to `''` and a
        // `not.toContain` passes having read nothing. That is this test's own original defect one step
        // further along, so it is closed rather than inherited from the neighbouring builder tests.
        expect(body).toContain('per-pr-reclamation-disabled');
        expect(body).not.toContain('kitchensink_recipe_pr_91');
    });
});

/**
 * ⛔ A HANDLER CALLS THE ANNOUNCING FORM, and nothing but this says so.
 *
 * `reportSilentNoOp` is exported — the suite drives it and `announceSilentNoOp` builds on it — and called
 * directly from a handler it discards the reporter's answer. That is a silent failure to report a silent
 * failure, which is the branch this module was extended to close, and it is precisely the shape a third
 * handler would reach for by copying the first two before the extraction. A docstring asks; this refuses.
 *
 * ⚠️ IT KEYS ON THE FILE NAME, which is one hop from the invariant it protects. The rule is "nothing
 * discards the reporter's answer"; what is checked is "no file named `handler.ts` under `src` names the
 * non-announcing form". A handler that moved this call into a sibling module would be invisible here. That is
 * the same one-hop limit `deployedE2eTiers.test.ts`'s `isOriginValue` records, and it is stated rather than
 * widened for the same reason: scanning every file under `src` would sweep in this module and its own suite,
 * and a guard that cannot be satisfied is a guard that gets deleted.
 */
describe('the call-site API', () => {
    const SRC = fileURLToPath(new URL('../src', import.meta.url));

    /**
     * A file's CODE, with its comments removed.
     *
     * ⛔ A TEXT GATE OVER SOURCE READS ITS DOCUMENTATION AS CODE, and this guard caught its own author doing
     * it: the comment explaining *why* a handler must not call `reportSilentNoOp` names `reportSilentNoOp`,
     * so the first version reported both handlers as violators for saying the right thing. That is the same
     * failure `testPoolWorkflowWiring.test.ts` and `RecipeWorkersStack.test.ts` each record — the second
     * having read a dependency's JSDoc `@example` block as a live import.
     */
    const codeOf = (file: string): string =>
        readFileSync(file, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//gu, '')
            .split('\n')
            .filter((line) => !line.trimStart().startsWith('//'))
            .join('\n');

    it('⛔ no handler imports the non-announcing reporter', () => {
        const handlers = [...globSync(`${SRC}/**/handler.ts`)];

        // ⚠️ FOUR, not two. A scan that found nothing would pass this vacuously — and a floor of 2, taken
        // from the two handlers that REPORT a silent no-op, would still pass with the other two deleted.
        // The four are db-bootstrap, db-reaper, edge-verifier and sandbox-scheduler.
        expect(handlers.length).toBeGreaterThanOrEqual(4);

        const bypassing = handlers.filter((file) => /\breportSilentNoOp\b/u.test(codeOf(file)));

        expect(bypassing, 'a handler must call announceSilentNoOp, which reads the reporter’s answer').toEqual([]);
    });

    it('⛔ and the announcing form is what they do call — an empty scan would prove nothing', () => {
        const calling = [...globSync(`${SRC}/**/handler.ts`)].filter((file) =>
            /\bannounceSilentNoOp\b/u.test(codeOf(file)),
        );

        expect(calling).toHaveLength(2);
    });
});
