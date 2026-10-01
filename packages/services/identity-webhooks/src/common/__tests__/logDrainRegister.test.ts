/**
 * U15 — the log-drain register: every group the drain forwards, and how its stage is read.
 *
 * ⛔ THE DEFECT THIS REPLACES WAS INVISIBLE FOR AS LONG AS IT EXISTED. One regex served every source and
 * answered `'unknown'` when it did not fit — which is a value nobody alarms on, nobody filters on, and
 * nobody notices. Two of the groups it was meant to serve did not fit it:
 *
 *  - `/kitchensink/identity-service/<stage>` uses SLASHES, so it matched nothing, and every line from the
 *    service that serves real users was tagged `environment:unknown`;
 *  - a CDK-generated webhook group let `sandbox-[a-z0-9]+` swallow the construct id, producing an
 *    environment called `sandbox-webhookslogroup`.
 *
 * So the test that matters most here is the EXHAUSTIVE one: no registered source may resolve to `unknown`,
 * for any stage. Asked that way, both defects fail this file on arrival.
 */
import { describe, expect, it } from 'vitest';

import { identifyLogSource, LOG_DRAIN_SOURCES } from '../logDrainRegister.js';

/** A realistic group name per registered source, at a given stage. Keyed by the register's own service key. */
const SAMPLE: Readonly<Record<string, (stage: string) => string>> = {
    'identity-service': (stage) => `/kitchensink/identity-service/${stage}`,
    'identity-webhooks': (stage) => `kitchensink-identity-webhooks-${stage}-WebhooksLogGroupA05F4FC6-Rwj`,
    'identity-webhooks-api': (stage) => `kitchensink-identity-webhooks-${stage}-IdentityWebhooksApiLogGroupB1-Q`,
    'log-forwarder': (stage) => `kitchensink-identity-webhooks-${stage}-LogForwarderLogGroupC2D3-Z`,
    'recipe-workers': (stage) => `/aws/lambda/kitchensink-recipe-workers-${stage}`,
    'ingredient-parser': (stage) => `/aws/lambda/kitchensink-ingredient-parser-${stage}`,
    'recipe-service': (stage) => `kitchensink-recipe-${stage}-RecipeApiLogGroupD4E5-Y`,
    'food-service': (stage) => `kitchensink-food-${stage}-FoodApiLogGroupF6G7-X`,
    'food-worker': (stage) => `kitchensink-food-${stage}-FoodWorkerLogGroupH8I9-W`,
    'food-change-refresh': (stage) => `kitchensink-food-${stage}-FoodChangeRefreshLogGroupJ0K1-V`,
    'identity-migration': (stage) => `kitchensink-identity-schema-${stage}-IdentityMigrationLogGroupL2-U`,
    'food-migration': (stage) => `kitchensink-food-schema-${stage}-FoodMigrationLogGroupM3-T`,
    'recipe-migration': (stage) => `kitchensink-recipe-schema-${stage}-RecipeMigrationLogGroupN4-S`,
    'db-bootstrap': (stage) => `kitchensink-data-${stage}-DbBootstrapLogGroupO5-R`,
    'per-pr-reaper': (stage) => `kitchensink-data-${stage}-PerPrDatabaseReaperLogGroupP6-Q`,
    'sandbox-scheduler': (stage) => `kitchensink-sandbox-scheduler-${stage}-SandboxSchedulerLogGroupQ7-P`,
};

/** The stages a group name can carry: the two base stages and a preview. */
const STAGES = ['prod', 'sandbox', 'pr-91'] as const;

describe('the log-drain register', () => {
    /**
     * ⛔ Every entry has a sample, by SET EQUALITY. A source added to the register without one would
     * otherwise be silently untested — which is the shape of the defect this file exists for.
     */
    it('⛔ has a sample group name for EVERY registered source, and no orphans', () => {
        expect(LOG_DRAIN_SOURCES.map((source) => source.service).sort()).toEqual(Object.keys(SAMPLE).sort());
    });

    it('⛔ resolves EVERY registered source at EVERY stage — none falls through to unknown', () => {
        for (const source of LOG_DRAIN_SOURCES) {
            for (const stage of STAGES) {
                const group = SAMPLE[source.service]?.(stage) ?? '';
                const identity = identifyLogSource(group);

                expect(identity, `${source.service} @ ${stage} (${group})`).toEqual({
                    service: source.service,
                    stage,
                });
            }
        }
    });

    /**
     * ⛔ An unregistered group FAILS rather than guessing. `'unknown'` is a value someone has to notice, and
     * for as long as the regex produced it for groups we DO own, nobody did. The forwarder still forwards
     * such a line — its first duty is not to drop logs — but it forwards it knowing it is unidentified.
     */
    it('⛔ refuses to identify an unregistered group instead of guessing a stage', () => {
        expect(identifyLogSource('/aws/lambda/some-other-function')).toBeUndefined();
        expect(identifyLogSource('kitchensink-armoury-prod-SomethingElse')).toBeUndefined();
        expect(identifyLogSource('')).toBeUndefined();
    });

    /**
     * ⚠️ The retired identity group (ADR-0035 expand-first keeps it until its export stops being imported)
     * receives NOTHING. It is deliberately absent from the register, and asserted absent so that re-adding
     * it is a decision rather than a reflex — a stage read off a group nobody writes to is noise.
     */
    it('does not claim the RETIRED identity group, which nothing writes to', () => {
        expect(
            identifyLogSource('kitchensink-identity-service-prod-IdentityServiceLogGroup4DD93B61-0yC'),
        ).toBeUndefined();
    });

    /**
     * ⛔ The stage capture must be bounded on BOTH sides. This is the exact shape of the second defect: the
     * old pattern's right-hand side was open, so a construct id became part of the stage.
     */
    it('⛔ never lets a construct id leak into the stage', () => {
        for (const source of LOG_DRAIN_SOURCES) {
            const identity = identifyLogSource(SAMPLE[source.service]?.('sandbox') ?? '');

            expect(identity?.stage, source.service).toBe('sandbox');
        }
    });
});
