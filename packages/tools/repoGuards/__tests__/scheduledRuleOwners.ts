/**
 * @module __tests__/scheduledRuleOwners — which CDK apps own a SCHEDULED EventBridge rule, DISCOVERED from source.
 *
 * Two guards read this (ADR-0060): `nonProdScheduledRules.test.ts` (every such stack holds its rules for the sandbox
 * scheduler) and `scheduledRuleSyncWiring.test.ts` (every non-prod deploy of such an app hands the rules back with a
 * `sync`). One reading of "who owns a scheduled rule", so the two cannot disagree — and no list, so an app that grows
 * its first sweeper tomorrow is held to both the day it lands.
 *
 * DESIGN PATTERN: Repository — one read-only view of the source tree, shared by the specifications that judge it.
 */
import { productionSources, readSource, withoutTsComments } from './roleSplitSources.js';

/**
 * A construct call that makes a rule run on a CLOCK: the L2 `Schedule.rate/cron/expression(` or the L1
 * `scheduleExpression:` property. ⛔ NOT `ScheduleExpression.` — that is EventBridge SCHEDULER (`aws_scheduler`),
 * a different service whose one schedule is the sandbox's own midnight stop, which must keep running.
 */
export const SCHEDULED_RULE_CONSTRUCT =
    /\b(?:events\.)?Schedule\.(?:rate|cron|expression)\s*\(|\bscheduleExpression\s*:/u;

/** A CDK app's library source: `…/infra/lib/**` or `packages/infra/<pkg>/lib/**`. */
const CDK_LIBRARY = /(^|\/)infra\/lib\/|^packages\/infra\/[^/]+\/lib\//u;

/**
 * The shared constructs (`@radicle-co/infra-shared`). A scheduled rule built THERE would be invisible to
 * {@link scheduledRuleOwners}, which finds the stack that constructs a rule, not the stack that instantiates a
 * construct which does — so `nonProdScheduledRules.test.ts` refuses one outright.
 */
export const SHARED_CONSTRUCTS = /^shared\/infra\/src\//u;

/** One library file that constructs a scheduled rule, and the CDK app it belongs to. */
export interface ScheduledRuleOwner {
    /** Repo-relative path of the file constructing the rule. */
    readonly file: string;
    /** The directory holding that app's `bin/` and `lib/` (e.g. `packages/services/recipe-workers/infra`). */
    readonly appRoot: string;
    /** The app's entrypoint, `<appRoot>/bin/app.ts`. */
    readonly entrypoint: string;
}

/**
 * Whether a source text constructs a scheduled rule, comments ignored.
 *
 * @param source - TypeScript source.
 * @returns `true` when it does. Pure.
 */
export function constructsScheduledRule(source: string): boolean {
    return SCHEDULED_RULE_CONSTRUCT.test(withoutTsComments(source));
}

/**
 * Every CDK library file in the working tree that constructs a scheduled rule.
 *
 * @returns One entry per file. Impure.
 * @sideEffect Shells out to git and reads source files.
 */
export function scheduledRuleOwners(): readonly ScheduledRuleOwner[] {
    return productionSources()
        .filter((file) => CDK_LIBRARY.test(file) && constructsScheduledRule(readSource(file)))
        .map((file) => {
            const appRoot = file.slice(0, file.indexOf('/lib/'));

            return { file, appRoot, entrypoint: `${appRoot}/bin/app.ts` };
        });
}
