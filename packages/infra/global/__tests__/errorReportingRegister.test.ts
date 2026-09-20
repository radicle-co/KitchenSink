// @vitest-environment node
/**
 * Repo-wide guard: every `catch` in a deployable service either RECORDS its error or says why it does not.
 *
 * ## The class of defect this exists for
 *
 * A swallowed error is the only failure that costs nothing at the moment it happens and everything later.
 * The request succeeds, the test passes, the dashboard is green, and the consequence surfaces days away from
 * its cause as a stranded reservation, an orphaned object, or a guarantee that quietly stopped holding. This
 * repository has shipped that shape repeatedly — the deletion-queue grant denied behind a `200`, the alarms
 * dimensioned so they watched a time series nobody wrote, `reportErrorLine` and `captureHandled` both
 * shipping with ZERO callers under docstrings describing what they would do if anything called them.
 *
 * ## Why this gate comes LAST, after the routing change
 *
 * It could not have been written honestly before U22a step 2. Until then `logger.error` wrote to stdout, and
 * whether that reached anybody depended on whether the runtime's log group had an ADR-0042 drain — so
 * "logs the error" was not a disposition, it was a guess. Now an `error` line goes to the service's own
 * Sentry project when a client exists, and to CloudWatch (and the drain) when one does not. `logs` is
 * therefore a real answer to "is this failure recorded", and a register written earlier would have certified
 * a set of catches on a premise that was not yet true.
 *
 * ## What the dispositions mean, and why `logs` is not the same as `reports`
 *
 * A LOG and an ISSUE are different products. A log line does not group, carries no stack Sentry can
 * symbolicate, and nothing alerts on it; an issue does all three. This gate does not decide which a given
 * catch deserves — that is the judgement U22a step 3 applied by hand, to five sites, on whether the failure
 * leaves a durable consequence an operator must act on. What this gate refuses is the fourth state: a catch
 * that does none of them and says nothing about why.
 *
 * ## Why the AST, and why the register is keyed by FUNCTION
 *
 * ⚠️ Text matching is defeated here by construction: this file's own prose contains `captureException(`,
 * `logger.error(` and `throw`, and so does every docstring it guards. Every predicate reads the TypeScript
 * AST. The register is keyed `file#enclosingFunction` rather than by line, because a line number churns on
 * every edit above it and a register that churns is a register nobody reads.
 */
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

import { type SourceFile, discoverServices, isInfraFile, isTestFile, parse, visit } from './serviceSources.js';

/**
 * What a `catch` does with the error it caught.
 *
 * `unaccounted` is the only failing value; it exists as a member rather than as `undefined` so that every
 * classification is a decision the union forces someone to make.
 */
type CatchDisposition = 'rethrows' | 'classifies' | 'reports' | 'logs' | 'propagates' | 'registered' | 'unaccounted';

/**
 * Calls that put an error in front of a human as an ISSUE.
 *
 * Deliberately short and literal: these three are the repository's only entry points to Sentry's error
 * product, and a fourth would be a decision (ADR-0024 layer 4b grants `bedrock:InvokeModel` to exactly one
 * role for a comparable reason — a second grantee is a change, not a detail).
 */
const REPORTING_CALLS: readonly string[] = ['captureException', 'captureHandled', 'reportErrorLine'];

/**
 * Functions that report on a caller's behalf, with the reason each one is indirect.
 *
 * ⛔ A REGISTER RATHER THAN DISCOVERY, and the reason is a measurement. Transitive discovery — "any function
 * whose body reaches a reporting call" — was tried first and admitted `catch` and `use` as reporter names,
 * because a method can be called either, and a predicate matching `catch(` then accepts essentially every
 * promise chain in the repository. A gate that accepts everything is worse than no gate.
 *
 * ⚠️ Each entry is VERIFIED below, not trusted: a name that no longer reaches a reporting call fails, so
 * this register cannot decay into a list of excuses.
 */
const REPORTING_FUNCTIONS: ReadonlyMap<string, string> = new Map([
    [
        'reportDeletionEnqueueFailure',
        'identity’s ONE paging path for a divergence between its database and Clerk (closure/reactivation)',
    ],
]);

/**
 * ⚠️ `rejectInvalidWebhook` WAS registered here and the verification below rejected it — it calls
 * `logger.error` and `emitMetric`, never a reporting call, so it records the failure without raising an
 * issue. That is the correct behaviour for an invalid webhook (unauthenticated internet noise must not
 * create issues), and the entry was a false claim about the code that the register's own check refused to
 * accept. Recorded here because "a name that stopped doing what its docstring says" is the exact failure
 * this file exists for, and it is worth knowing the check catches it.
 */

/**
 * Functions that LOG on a caller's behalf, with the reason each one is indirect.
 *
 * ⛔ SEPARATE FROM {@link REPORTING_FUNCTIONS}, AND THE SPLIT IS LOAD-BEARING. A log and an issue are
 * different products, and each register is verified against its OWN product — which is the check that
 * refused `rejectInvalidWebhook` as a reporter. That refusal was right and the function is not silent: it
 * logs and meters, which is correct for unauthenticated webhook noise. Merging the two registers would have
 * made that entry pass, and the mistake would have stood.
 *
 * ⚠️ Each entry is VERIFIED below to actually reach a logging call, by the same parameterised test
 * that verifies the reporters.
 */
const LOGGING_FUNCTIONS: ReadonlyMap<string, string> = new Map([
    [
        'reportDegraded',
        'the food-catalog gateway’s RATE-LIMITED logger: `warn` at most once per interval, `debug` in ' +
            'between, so a source outage does not emit one line per keystroke of a typeahead',
    ],
    [
        'rejectInvalidWebhook',
        'the webhook pipeline’s single rejection path: logs with the reason and meters it by dimension. ' +
            'Deliberately not an issue — unauthenticated internet noise must not create one',
    ],
]);

/**
 * Every `catch` that deliberately records nothing, and why.
 *
 * ⛔ THE REASON IS THE POINT, not the exemption. Each entry states what the caught error MEANS at that site,
 * and in every case below it means "absence", not "failure": a probe of a file this kernel does not have, a
 * body that is not JSON, a buffer that is not a decodable image. Reporting those would be reporting the
 * normal case, which is how a Sentry project becomes unreadable and then ignored — the same argument both
 * `ApiExceptionFilter`s make for capturing 5xx and not 4xx.
 *
 * ⚠️ Keyed by `file#enclosingFunction`, plus an ordinal for the second and later catch in the same function,
 * so one written reason can never silently cover two sites. The residual that remains is ORDER: inserting or
 * reordering a catch inside a registered function re-attaches an existing reason to a different site, and
 * the stale-entry check cannot see it because both keys still resolve.
 */
const DELIBERATE_SILENCE: ReadonlyMap<string, string> = new Map([
    [
        'packages/services/food-service/src/worker/concurrency.ts#containerCpus',
        'probes the cgroup v2 CPU files; a kernel that does not have them is the normal case',
    ],
    [
        'packages/services/food-service/src/worker/concurrency.ts#containerCpus#1',
        'the cgroup v1 fallback of the same probe; neither present means the caller uses a declared default',
    ],
    [
        'packages/services/identity-webhooks/src/common/erasureFanout.ts#safeSnippet',
        'reads a body snippet to DECORATE an HTTP failure; a read error here would mask the error being ' +
            'described, so it degrades to an empty detail',
    ],
    [
        'packages/services/identity-webhooks/src/common/otlp.ts#sanitizeAccessLogMessage',
        'a log line that is not JSON is passed through as text — the forwarder’s first duty is not to drop ' +
            'logs, and "not JSON" is most lines',
    ],
    [
        'packages/services/recipe-service/src/ingredients/resolution/resolutionCascade.ts#runResolutionCascade',
        'a failed tier is marked UNAVAILABLE and handed to the cascade’s observers, which is this module’s ' +
            'own record; the cascade then continues to the next tier by design',
    ],
    [
        'packages/services/recipe-service/src/ingredients/resolution/resolutionCascade.ts#report',
        'notifies observers; an observer that throws must not take down the resolution it is observing',
    ],
    [
        'packages/services/recipe-service/src/photos/photos.service.ts#detectImageContentType',
        '`file-type` throws on a truncated or malformed buffer, which IS the answer — "not a determinable ' +
            'image" — and becomes a 422 rather than escaping as a 500',
    ],
    [
        'packages/services/recipe-workers/src/handlers/handleSyncWorker.ts#parseHandleSyncMessage',
        'a payload that does not parse is absence; the caller refuses it once through `invalidPayload.ts`, ' +
            'which is where that refusal is recorded (GR-018 §18-b)',
    ],
    [
        'packages/services/recipe-workers/src/local/parseQueueConsumer.ts#receive',
        'absorbs ONLY our own abort — the guard tests `options.abortSignal`, not the error, so it is not ' +
            'classifying a failure but recognising a shutdown it asked for; every other error is rethrown ' +
            'to the loop, and this file ships to no stage',
    ],
    [
        'packages/services/recipe-workers/src/local/parseQueueConsumer.ts#drainParseQueue',
        'the LOCAL dev runner: a restarting broker is not a reason to stop, the failure is counted and ' +
            'handed to the injected `onError`, and this file ships to no stage',
    ],
    [
        'packages/services/recipe-workers/src/local/parseQueueConsumer.ts#drainParseQueue#1',
        'the same runner’s per-message arm: a message that fails is counted and handed to `onError`, and ' +
            'the loop continues rather than losing the rest of the batch',
    ],
    [
        'packages/services/recipe-workers/src/parsing/gatedLlm.ts#readParseJson',
        'a model answer that is not JSON is absence, which the caller already handles as a refusal; the ' +
            'model producing prose is an expected outcome, not an incident',
    ],
]);

// ───────────────────────────── the classifier ─────────────────────────────

/**
 * Walk a catch body WITHOUT descending into a scope that owns its own error handling.
 *
 * ⛔ THE UNBOUNDED WALK LETS AN INNER SCOPE ANSWER FOR THE OUTER ONE. `visit` is a plain `forEachChild`
 * descent, so a `throw` inside a nested `try/catch`, or inside a callback the catch passes to something
 * else, counted as the OUTER catch rethrowing. The dangerous shape is a false PASS: an outer catch that
 * swallows by falling off the end, while containing an inner `try { … } catch { throw … }`, reads as
 * `rethrows` and is never examined again.
 *
 * ⚠️ ZERO sites in this tree hit it today — 3 catches contain a nested catch and all three genuinely
 * rethrow — so this closes the gap rather than a live defect, which is the only time it is cheap. Function
 * boundaries are excluded for the same reason: a `return` inside a callback returns from the CALLBACK.
 *
 * @param block - The catch's block.
 * @param callback - Called for each node in the catch's own scope.
 */
function visitOwnScope(block: ts.Node, callback: (node: ts.Node) => void, stopAtTry = false): void {
    const walk = (node: ts.Node): void => {
        callback(node);

        ts.forEachChild(node, (child) => {
            if (ts.isFunctionLike(child) || ts.isCatchClause(child)) {
                return;
            }

            // ⛔ `stopAtTry` IS FOR THE `throws` PROBE ONLY, and one bound cannot serve all four predicates.
            // `catch (error) { try { throw error; } catch { } }` rethrows NOTHING — the inner catch consumes
            // it — yet the throw is lexically inside the outer block, so without this it read as `rethrows`:
            // the false-PASS direction again, one level in from the nested-catch case. But a LOG call inside
            // an inner `try` genuinely logs, so the same bound would make `callsLogger` miss real records.
            if (stopAtTry && ts.isTryStatement(child)) {
                return;
            }

            walk(child);
        });
    };

    walk(block);
}

/** Whether a body calls any of {@link REPORTING_CALLS} or a registered indirect reporter. */
function callsReporter(body: ts.Node): boolean {
    let found = false;

    visitOwnScope(body, (node) => {
        if (!ts.isCallExpression(node)) {
            return;
        }

        const callee = ts.isPropertyAccessExpression(node.expression)
            ? node.expression.name.text
            : ts.isIdentifier(node.expression)
              ? node.expression.text
              : undefined;

        if (callee !== undefined && (REPORTING_CALLS.includes(callee) || REPORTING_FUNCTIONS.has(callee))) {
            found = true;
        }
    });

    return found;
}

/**
 * Whether a body records the error — directly through `.error`/`.warn`, or through a registered indirect
 * logger.
 *
 * ⚠️ The indirect arm is what distinguishes "recorded somewhere else" from "discarded". Without it,
 * `foodCatalog.gateway.ts`'s `catch` — which calls a rate-limited `reportDegraded` — reads as a silent
 * swallow, and the register would have filled with an exemption for a site that is not exempt.
 */
function callsLogger(body: ts.Node): boolean {
    let found = false;

    visitOwnScope(body, (node) => {
        if (!ts.isCallExpression(node)) {
            return;
        }

        if (
            ts.isPropertyAccessExpression(node.expression) &&
            (node.expression.name.text === 'error' ||
                node.expression.name.text === 'warn' ||
                LOGGING_FUNCTIONS.has(node.expression.name.text))
        ) {
            found = true;
        }

        if (ts.isIdentifier(node.expression) && LOGGING_FUNCTIONS.has(node.expression.text)) {
            found = true;
        }
    });

    return found;
}

/**
 * Whether the catch converts its error into a value the CALLER receives.
 *
 * ⚠️ Both halves are required. Returning is not enough — `return undefined` after a swallow is the shape
 * this gate exists to catch — so the bound error must also be referenced, which is what distinguishes
 * "handed upward as a failure value" from "discarded and replaced by a fallback".
 */
function propagatesAsValue(clause: ts.CatchClause): boolean {
    const bound = clause.variableDeclaration?.name;

    if (bound === undefined || !ts.isIdentifier(bound)) {
        return false;
    }

    let carried = false;

    // ⛔ A DERIVED value deliberately does NOT count, and this is the second attempt at that rule. Accepting
    // any identifier whose initialiser mentioned the error re-opened the exact hole the ⛔ below says is
    // closed: `const isMissing = error instanceof NotFound; return isMissing ? undefined : FALLBACK;` became
    // `propagates`, because hoisting a GUARD into a `const` is indistinguishable from deriving a payload
    // from one. It was added for a hypothetical sibling and, measured over this tree's catches, it moved
    // exactly one disposition and no pass/fail outcome — which is the YAGNI misuse CLAUDE.md names.
    visitOwnScope(clause.block, (node) => {
        if (!ts.isReturnStatement(node) || node.expression === undefined) {
            return;
        }

        // ⛔ THE ERROR MUST BE IN THE RETURNED EXPRESSION, not merely somewhere in the block. The first
        // version asked "is the binding referenced anywhere AND does the block return", which accepted
        // `catch (error) { if (isNotFound(error)) { return undefined; } throw error; }` — where the error is
        // referenced by a GUARD and the returned value carries nothing of it. That is a swallow wearing
        // propagation's clothes, and it defeated this function's own stated target: a bare `return` after a
        // discard. Requiring the identifier inside the returned subtree keeps the real shape
        // (`return { ok: false, detail: String(error) }`) and rejects that one.
        visitOwnScope(node.expression, (inner) => {
            if (ts.isIdentifier(inner) && inner.text === bound.text) {
                carried = true;
            }
        });
    });

    return carried;
}

/**
 * Whether every `return` in a catch sits under a condition that tests the caught error.
 *
 * ⛔ THE POINT IS THAT THE ERROR WAS LOOKED AT. `if (isUniqueViolation(error)) { return after; }` inspects
 * the failure and converts a known case into a domain outcome; `return undefined;` beside a `throw` does
 * not, and the difference is invisible to a rule that only asks whether the block contains both keywords.
 *
 * @param clause - The catch clause.
 * @returns Whether all returns are guarded. Pure — returns `false` when there is no binding to test.
 */
function returnsAreGuardedByError(clause: ts.CatchClause): boolean {
    const bound = clause.variableDeclaration?.name;

    if (bound === undefined || !ts.isIdentifier(bound)) {
        return false;
    }

    let allGuarded = true;

    /** Whether a statement's every path throws — an `if` that rethrows narrows everything after it. */
    const alwaysThrows = (node: ts.Node): boolean => {
        if (ts.isThrowStatement(node)) {
            return true;
        }

        if (ts.isBlock(node)) {
            return node.statements.some((statement) => alwaysThrows(statement));
        }

        return false;
    };

    /** Whether an expression mentions the caught error. */
    const testsError = (node: ts.Node): boolean => {
        let found = false;

        visit(node, (inner) => {
            if (ts.isIdentifier(inner) && inner.text === bound.text) {
                found = true;
            }
        });

        return found;
    };

    const walk = (node: ts.Node, guarded: boolean): void => {
        if (ts.isReturnStatement(node) && !guarded) {
            allGuarded = false;

            return;
        }

        if (ts.isBlock(node)) {
            // ⛔ STATEMENT ORDER MATTERS, because of the EARLY-RETHROW idiom:
            // `if (!isNotFound(error)) { throw error; }` narrows everything that follows it just as much as
            // wrapping the remainder in an `if`, and it is the form this repository actually writes
            // (`ingredients.service.ts#readFoodStatus`). A predicate that only understood the nested shape
            // reported that site as a silent swallow — a false finding indistinguishable from a real one.
            let narrowed = guarded;

            for (const statement of node.statements) {
                walk(statement, narrowed);

                if (
                    ts.isIfStatement(statement) &&
                    testsError(statement.expression) &&
                    alwaysThrows(statement.thenStatement)
                ) {
                    narrowed = true;
                }
            }

            return;
        }

        if (ts.isIfStatement(node)) {
            const narrowed = guarded || testsError(node.expression);

            walk(node.thenStatement, narrowed);

            if (node.elseStatement !== undefined) {
                walk(node.elseStatement, narrowed);
            }

            return;
        }

        ts.forEachChild(node, (child) => {
            walk(child, guarded);
        });
    };

    walk(clause.block, false);

    return allGuarded;
}

/** The name of the function a node sits inside, for the register key. */
function enclosingFunctionName(clause: ts.CatchClause, source: ts.SourceFile): string {
    let name = '(top level)';

    const walk = (node: ts.Node, current: string): void => {
        let here = current;

        if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name !== undefined) {
            here = node.name.getText(source);
        } else if (
            ts.isVariableDeclaration(node) &&
            node.initializer !== undefined &&
            (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
        ) {
            here = node.name.getText(source);
        }

        if (node === clause) {
            name = here;
        }

        ts.forEachChild(node, (child) => {
            walk(child, here);
        });
    };

    walk(source, '(top level)');

    return name;
}

/** One classified `catch`. */
interface ClassifiedCatch {
    readonly key: string;
    readonly disposition: CatchDisposition;
}

/** Classify every `catch` in a file. */
function classifyCatches(file: SourceFile): readonly ClassifiedCatch[] {
    const source = parse(file);
    const classified: ClassifiedCatch[] = [];
    // ⚠️ ORDINAL PER FUNCTION, because `file#function` is NOT unique: 24 of this tree's catches share one,
    // and two silence entries covered two catches each. Those pairs are genuinely the same case today
    // (`containerCpus` probes cgroup v2 then cgroup v1), but one justification exempting N catches is by
    // CONSTRUCTION rather than by review — the next catch added to an already-registered function would
    // inherit an exemption nobody wrote for it.
    const seenPerFunction = new Map<string, number>();

    visit(source, (node) => {
        if (!ts.isCatchClause(node)) {
            return;
        }

        const scope = `${file.file}#${enclosingFunctionName(node, source)}`;
        const ordinal = seenPerFunction.get(scope) ?? 0;

        seenPerFunction.set(scope, ordinal + 1);

        const key = ordinal === 0 ? scope : `${scope}#${ordinal}`;
        let throws = false;

        visitOwnScope(
            node.block,
            (inner) => {
                if (ts.isThrowStatement(inner)) {
                    throws = true;
                }
            },
            true,
        );

        let returns = false;

        visitOwnScope(node.block, (inner) => {
            if (ts.isReturnStatement(inner)) {
                returns = true;
            }
        });

        // ⛔ A PARTIAL RETHROW IS NOT AUTOMATICALLY A RETHROW. `throws` used to be evaluated first, so a
        // catch that rethrows on one branch and RETURNS on another had its returning branch never examined.
        // Measured: 13 catches in this tree do exactly that — and every one is the SAME legitimate shape, a
        // typed sub-case converted to a domain outcome with the remainder rethrown
        // (`if (isUniqueViolation(error)) { return after; } throw error;`). Forcing those into the silence
        // register would have added thirteen entries saying one thing, which is register noise rather than
        // safety, so the shape gets its own name.
        //
        // ⚠️ What it requires is that the error was INSPECTED: every return sits under a condition that
        // tests the bound error. A catch that rethrows AND returns unconditionally is not classifying — it
        // is swallowing on the path nobody looked at — and falls through to `unaccounted`.
        const classifies = throws && returns && returnsAreGuardedByError(node);
        // ⚠️ RECORDING WINS OVER CLASSIFYING. A catch that both tests the error and logs it is reported as
        // `logs`, because that is the stronger statement: `classifies` says only that a known case was
        // handled deliberately, while `logs` says a human can see that it happened.
        const disposition: CatchDisposition =
            throws && !returns
                ? 'rethrows'
                : callsReporter(node.block)
                  ? 'reports'
                  : callsLogger(node.block)
                    ? 'logs'
                    : propagatesAsValue(node)
                      ? 'propagates'
                      : classifies
                        ? 'classifies'
                        : DELIBERATE_SILENCE.has(key)
                          ? 'registered'
                          : 'unaccounted';

        classified.push({ key, disposition });
    });

    return classified;
}

// ───────────────────────────── the mutation proof ─────────────────────────────

/** A file whose every catch is a different disposition, with prose naming what each gate looks for. */
const FIXTURE: SourceFile = {
    file: 'packages/services/fake-reporting-service/src/worker/probe.ts',
    contents: `
        export async function rethrowing(): Promise<void> {
            try { await work(); } catch (error) { throw error; }
        }

        export async function reporting(): Promise<void> {
            // Swallowed, but captureException is called so an operator sees it.
            try { await work(); } catch (error) { captureHandled(error, { callSite: 'probe' }); }
        }

        export async function logging(): Promise<void> {
            try { await work(); } catch (error) { logger.error('work failed', { error }); }
        }

        export async function converting(): Promise<Result> {
            try { return await work(); } catch (error) { return { ok: false, detail: String(error) }; }
        }

        export async function partiallySwallowingRecorded(): Promise<Result | undefined> {
            try { return await work(); } catch (error) {
                if (isNotFound(error)) { logger.warn('absent', { error }); return undefined; }
                throw error;
            }
        }

        export async function partiallySwallowingSilent(): Promise<Result | undefined> {
            // Rethrows, and the swallowing branch reports through captureHandled.
            try { return await work(); } catch (error) {
                if (isNotFound(error)) { return undefined; }
                throw error;
            }
        }

        export async function discardingWithFallback(): Promise<Result> {
            // Converts the error into a returned failure value the caller receives.
            try { return await work(); } catch (error) { return FALLBACK; }
        }

        export async function partiallySwallowingUnguarded(): Promise<Result | undefined> {
            try { return await work(); } catch (error) {
                if (somethingElse()) { return undefined; }
                throw error;
            }
        }

        export async function innerTryConsumesTheThrow(): Promise<void> {
            // Rethrows the error so the caller still sees it.
            try { await work(); } catch (error) {
                try { throw error; } catch { }
            }
        }

        export async function guardBoundToAName(): Promise<Result | undefined> {
            // Converts the error into a returned failure value.
            try { return await work(); } catch (error) {
                const isMissing = error instanceof NotFound;
                return isMissing ? undefined : FALLBACK;
            }
        }

        export async function innerRethrowOuterSwallow(): Promise<void> {
            // Rethrows the error after logging it with logger.error.
            // (The throw below belongs to the INNER catch; the outer one falls off the end.)
            try { await work(); } catch (error) {
                try { await cleanup(); } catch (inner) { throw inner; }
            }
        }

        export async function swallowing(): Promise<void> {
            // Reported through captureHandled and logged with logger.error, then rethrown.
            // (Prose only — the body below does none of those, which is the whole point.)
            try { await work(); } catch { return undefined; }
        }
    `,
};

/**
 * A service's RUNTIME sources.
 *
 * ⚠️ `infra/**` is excluded, and not as a convenience. A CDK stack and a deploy-smoke script do not run in
 * the service; their failures surface as a red pipeline, which is already a human looking at an error. Left
 * in, the first thing this gate reported was two `deployedSmoke.ts` catches — a gate finding the wrong
 * population is how an exemption register fills up with entries that teach nothing.
 */
function runtimeSources(sources: readonly SourceFile[]): readonly SourceFile[] {
    return sources.filter((source) => !isTestFile(source.file) && !isInfraFile(source.file));
}

describe('every caught error in a deployable service is recorded, or says why not', () => {
    const services = discoverServices();
    const classified = services.flatMap((service) =>
        runtimeSources(service.sources).flatMap((source) => classifyCatches(source)),
    );

    it('⛔ leaves no catch unaccounted for', () => {
        expect(classified.filter((entry) => entry.disposition === 'unaccounted').map((entry) => entry.key)).toEqual([]);
    });

    it('⛔ has no STALE register entry — an exemption nothing uses is a rule nobody follows', () => {
        const hit = new Set(classified.filter((entry) => entry.disposition === 'registered').map((entry) => entry.key));

        expect([...DELIBERATE_SILENCE.keys()].filter((key) => !hit.has(key))).toEqual([]);
    });

    /**
     * ⛔ EVERY INDIRECT REGISTER IS VERIFIED AGAINST ITS OWN PRODUCT, and the test is PARAMETERISED over
     * them so that a third register cannot be added without its check.
     *
     * ⚠️ IT WAS NOT, AND THAT IS THE POINT. `LOGGING_FUNCTIONS` shipped with a docstring promising "each
     * entry is VERIFIED below" and nothing behind it — which is precisely the failure this whole file
     * exists to catch ("a name that stopped doing what its docstring says"), sitting inside the guard. A
     * register copied without its check is a register that can only accumulate excuses.
     *
     * ⚠️ The two stay SEPARATE and are checked against DIFFERENT products: a reporter must reach
     * `captureException`/`captureHandled`, a logger must reach a logging call. Merging them would re-admit
     * `rejectInvalidWebhook` as a reporter — the wrong claim this check already refused once, since it logs
     * and meters deliberately, because unauthenticated webhook noise must not raise issues.
     */
    it.each([
        ['reporter', REPORTING_FUNCTIONS, callsReporter],
        ['logger', LOGGING_FUNCTIONS, callsLogger],
    ] as const)('⛔ verifies every registered %s actually does it', (kind, register, reaches) => {
        const bodies = new Map<string, ts.Node>();

        for (const service of services) {
            for (const file of runtimeSources(service.sources)) {
                const source = parse(file);

                visit(source, (node) => {
                    if (
                        (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
                        node.name !== undefined &&
                        node.body !== undefined &&
                        register.has(node.name.getText(source))
                    ) {
                        bodies.set(node.name.getText(source), node.body);
                    }

                    // ⚠️ An arrow-function `const` counts too: `rejectInvalidWebhook` is declared that way,
                    // and a lookup that only knew `function` declarations would have reported the repo's
                    // real reporter as missing — a false finding that reads exactly like a real one.
                    if (
                        ts.isVariableDeclaration(node) &&
                        node.initializer !== undefined &&
                        (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) &&
                        register.has(node.name.getText(source))
                    ) {
                        bodies.set(node.name.getText(source), node.initializer.body);
                    }
                });
            }
        }

        // A register that has emptied out would pass every loop below vacuously.
        expect(register.size).toBeGreaterThan(0);

        for (const name of register.keys()) {
            const body = bodies.get(name);

            expect(body, `${name} is registered as a ${kind} but was not found`).toBeDefined();
            expect(reaches(body as ts.Node), `${name} is registered as a ${kind} but reaches no ${kind} call`).toBe(
                true,
            );
        }
    });

    /** Non-vacuity: the classifier must be looking at a real population, in every disposition it defines. */
    it('has real subjects in every disposition it claims to distinguish', () => {
        const seen = new Set(classified.map((entry) => entry.disposition));

        expect(classified.length).toBeGreaterThanOrEqual(100);
        expect([...seen].sort()).toEqual(['classifies', 'logs', 'propagates', 'registered', 'reports', 'rethrows']);
    });

    describe('the classifier actually fires — proven against a fixture holding one of each', () => {
        const fixture = classifyCatches(FIXTURE);

        /**
         * ⚠️ `guardBoundToAName` pins that hoisting a GUARD into a `const` is still not propagation, and
         * `innerRethrowOuterSwallow` pins the scope boundary: the `throw` belongs to an inner catch, so it
         * must not certify the outer one — the false-PASS shape, which is the dangerous direction.
         *
         * ⚠️ The last three are the partial-rethrow family, and they are what the `classifies` disposition
         * exists to tell apart. Returning from a branch that TESTED the error is deliberate handling;
         * returning from one that tested something else is a swallow on the path nobody looked at, and a
         * `throw` elsewhere in the block must not certify it.
         */
        it.each([
            ['rethrowing', 'rethrows'],
            ['reporting', 'reports'],
            ['logging', 'logs'],
            ['converting', 'propagates'],
            ['discardingWithFallback', 'unaccounted'],
            ['guardBoundToAName', 'unaccounted'],
            ['innerRethrowOuterSwallow', 'unaccounted'],
            ['innerTryConsumesTheThrow', 'unaccounted'],
            ['swallowing', 'unaccounted'],
            ['partiallySwallowingRecorded', 'logs'],
            ['partiallySwallowingSilent', 'classifies'],
            ['partiallySwallowingUnguarded', 'unaccounted'],
        ] as const)('classifies %s as %s', (fn, expected) => {
            expect(fixture.find((entry) => entry.key.endsWith(`#${fn}`))?.disposition).toBe(expected);
        });

        it('⛔ is not satisfied by the comment above the swallow that names every reporting call', () => {
            expect(FIXTURE.contents).toContain('captureHandled');
            expect(FIXTURE.contents).toContain('logger.error');
            expect(fixture.find((entry) => entry.key.endsWith('#swallowing'))?.disposition).toBe('unaccounted');
        });

        it('⚠️ a `return undefined` after a swallow is NOT propagation — the error is discarded', () => {
            expect(fixture.find((entry) => entry.key.endsWith('#swallowing'))?.disposition).not.toBe('propagates');
        });
    });
});
