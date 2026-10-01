// @vitest-environment node
/**
 * ⚠️⚠️ THE ONE-SHOT LEGACY RECREATE IS ARMED ON: sandbox, prod ⚠️⚠️
 *
 * While this file says so, every deploy of `DataStack` to those stages may DROP a base database still owned by its
 * pre-role-split owner and recreate it owned by `<svc>_owner` (`docs/plans/2026-09-11-database-role-split.md`,
 * owner rulings 1, 2 and 8). A database already owned by `<svc>_owner` is left alone — the recreate cannot repeat —
 * but a stage is only safe from it once it is DISARMED.
 *
 * ## The disarm commit (mandatory, the second prod deploy)
 *
 * After the sandbox run and the prod run have both completed, ONE commit:
 *
 * 1. deletes `src/db-bootstrap/legacyRecreate.ts` and the `recreate` branch of the disposition — the recreate path
 *    stops existing, so no event, forged or re-sent by a rollback, can reach it;
 * 2. deletes `LEGACY_RECREATE_ARMED_STAGES`, the `legacyRecreate` property and the function's `LEGACY_RECREATE_ARMED`
 *    flag from `lib/platform/DataStack.ts`;
 * 3. removes the recreate from `dropDatabaseAuthority.test.ts`'s exact list, and deletes THIS file.
 *
 * An unarmed stage whose database is still legacy then fails its deploy instead of dropping it.
 *
 * The list is restated here rather than imported ON PURPOSE: disarming must touch two files, and a reviewer must see
 * the stage names change in both.
 */
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';

import { LEGACY_RECREATE_TOKEN_PREFIX } from '../src/db-bootstrap/disposition.js';
import { DataStack } from '../lib/platform/DataStack.js';
import { NetworkStack } from '../lib/platform/NetworkStack.js';
import { testApp } from './testApp.js';

/** ⚠️ The stages the recreate is armed on. Emptied by the disarm commit. */
const ARMED: readonly string[] = ['sandbox', 'prod'];

const env = { account: '123456789012', region: 'us-east-1' };

/** The DataStack template for `stage`. */
function dataTemplate(stage: string): Template {
    const app = testApp();
    const network = new NetworkStack(app, `Net-${stage}`, { env, stage });

    return Template.fromStack(new DataStack(app, `Data-${stage}`, { env, network, stage }));
}

/** The bootstrap function's `LEGACY_RECREATE_ARMED` environment value, or `undefined`. */
function functionFlag(stage: string): unknown {
    const fn = Object.values(dataTemplate(stage).findResources('AWS::Lambda::Function')).find((resource) =>
        String(resource.Properties.Description ?? '').startsWith('Bootstrap the database role model'),
    );

    return fn?.Properties.Environment.Variables['LEGACY_RECREATE_ARMED'];
}

/** Each bootstrap custom resource's `legacyRecreate` property, keyed by service. */
function armingTokens(stage: string): Record<string, unknown> {
    const template = dataTemplate(stage);

    return Object.fromEntries(
        Object.values(
            template.toJSON().Resources as Record<string, { Type: string; Properties: Record<string, unknown> }>,
        )
            .filter(
                (resource) =>
                    resource.Type === 'AWS::CloudFormation::CustomResource' && 'service' in resource.Properties,
            )
            .map((resource) => [String(resource.Properties['service']), resource.Properties['legacyRecreate']]),
    );
}

describe(`⚠️ ARMED — the one-shot legacy recreate is armed on: ${ARMED.join(', ') || 'nothing'}`, () => {
    it.each(ARMED)('%s: every bootstrap resource carries the token naming its own stage', (stage) => {
        const token = `${LEGACY_RECREATE_TOKEN_PREFIX}:${stage}`;

        expect(armingTokens(stage)).toEqual({ identity: token, food: token, recipe: token });
    });

    it.each(ARMED)('%s: the deployed function carries the same flag — the event alone cannot arm it', (stage) => {
        expect(functionFlag(stage)).toBe(`${LEGACY_RECREATE_TOKEN_PREFIX}:${stage}`);
    });

    it.each(['dev', 'test', 'sandbox', 'prod'].filter((stage) => !ARMED.includes(stage)))(
        '%s: carries no token at all',
        (stage) => {
            const tokens = armingTokens(stage);

            // Keys first: `toEqual` treats a missing key as equal to an undefined one, so without this an empty
            // template — no bootstrap at all — would pass as "unarmed".
            expect(Object.keys(tokens).sort()).toEqual(['food', 'identity', 'recipe']);
            expect(Object.values(tokens)).toEqual([undefined, undefined, undefined]);
            expect(functionFlag(stage)).toBeUndefined();
        },
    );
});
