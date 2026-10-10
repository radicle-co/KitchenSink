import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

const { captureCheckIn, captureMessage, withScope } = vi.hoisted(() => ({
    captureCheckIn: vi.fn(),
    captureMessage: vi.fn(),
    withScope: vi.fn(),
}));

vi.mock('@sentry/aws-serverless', () => ({ captureCheckIn, captureMessage, withScope }));

import { checkInQueueCheck, QUEUE_CHECK_INTERVAL_MINUTES } from '../queueEscalation.js';

/**
 * ⛔ THE SCHEDULE AND THE MONITOR ARE ONE CADENCE, and nothing but this holds them together.
 *
 * The handler upserts its Sentry cron monitor with {@link QUEUE_CHECK_INTERVAL_MINUTES} on every check-in,
 * while the EventBridge rule that fires it carries a rate declared in the CDK stack. `infra/` and `src/` are
 * separate TypeScript programs in this package — a runtime module must not import a CDK app — so the two
 * numbers cannot be one constant, and a copy of a value cannot detect that the value changed.
 *
 * Both failure directions are silent where it matters:
 *
 *  - a rule firing LESS often than the monitor expects reports a missed check-in every single interval, so
 *    the monitor is permanently failing for a check that is running exactly as designed — and an alert that
 *    is always red is an alert that gets muted, taking the real signal with it;
 *  - a rule firing MORE often is merely wasteful, but it also means a DEAD check goes unnoticed for as long
 *    as the monitor's expectation, which is the one thing the monitor exists to shorten.
 *
 * ⚠️ READ, never restated. The rate comes out of the stack's own AST and the interval out of the module the
 * handler actually calls, so this reds if either side moves alone.
 */
const STACK = join(dirname(fileURLToPath(import.meta.url)), '../../../infra/lib/RecipeWorkersStack.ts');

/** The `Duration.minutes(n)` initialising `QUEUE_CHECK_INTERVAL`, read from the stack's AST. */
function scheduledIntervalMinutes(): number {
    const source = ts.createSourceFile('stack.ts', readFileSync(STACK, 'utf8'), ts.ScriptTarget.Latest, true);
    const found: number[] = [];

    const visit = (node: ts.Node): void => {
        if (
            ts.isVariableDeclaration(node) &&
            ts.isIdentifier(node.name) &&
            node.name.text === 'QUEUE_CHECK_INTERVAL' &&
            node.initializer !== undefined &&
            ts.isCallExpression(node.initializer) &&
            ts.isPropertyAccessExpression(node.initializer.expression) &&
            node.initializer.expression.name.text === 'minutes'
        ) {
            const [argument] = node.initializer.arguments;

            if (argument !== undefined && ts.isNumericLiteral(argument)) {
                found.push(Number(argument.text));
            }
        }

        ts.forEachChild(node, visit);
    };

    visit(source);

    expect(found, 'the stack must declare exactly one QUEUE_CHECK_INTERVAL as Duration.minutes(n)').toHaveLength(1);

    return found[0] as number;
}

/** That the rule actually USES the constant — a constant nothing reads would agree with anything. */
function ruleUsesTheConstant(): boolean {
    return /Schedule\.rate\(QUEUE_CHECK_INTERVAL\)/u.test(readFileSync(STACK, 'utf8'));
}

describe('the backstop schedule and its cron monitor agree', () => {
    it('⛔ the EventBridge rate equals the interval the monitor is upserted with', () => {
        expect(scheduledIntervalMinutes()).toBe(QUEUE_CHECK_INTERVAL_MINUTES);
    });

    /**
     * ⛔ Without this, the assertion above is satisfiable by a stack that declares the right constant and
     * schedules something else entirely — which is the failure it exists to prevent, one line removed.
     */
    it('⛔ and the rule is actually scheduled on that constant', () => {
        expect(ruleUsesTheConstant()).toBe(true);
    });
});

/**
 * ⛔ THE WIRING, which is all this service's own file now does. The escalation BEHAVIOUR is one
 * implementation in `@kitchensink/queue-check` with one suite; what a copy-paste of a sibling's file would
 * get wrong is the two values passed to it — this service's name and its cadence. The cadence is asserted
 * above against the stack; the name is asserted here, because a slug carrying the WRONG service is checked
 * in to another service's monitor, leaving this one permanently missing and that one falsely green.
 */
describe('this service is wired to its own identity', () => {
    it('⛔ checks in under recipe-workers, not a sibling', () => {
        checkInQueueCheck('prod');

        expect(captureCheckIn.mock.calls[0]?.[0]).toEqual({
            monitorSlug: 'recipe-workers-queue-check-prod',
            status: 'ok',
        });
        expect(captureCheckIn.mock.calls[0]?.[1]).toEqual(
            expect.objectContaining({
                schedule: { type: 'interval', value: QUEUE_CHECK_INTERVAL_MINUTES, unit: 'minute' },
            }),
        );
    });
});
