/**
 * `kitchenSinkAppProps` is the one seam that puts every stage CDK app on KitchenSink's bootstrap qualifier and
 * under its permissions boundary. The properties pinned here are the ones a wrong value would turn
 * into a failed or misdirected production deploy: which qualifier a stage gets, which boundary its roles get, and
 * that nothing the CDK CLI or `cdk.json` says can override either.
 *
 * What the CDK DOES with these props is proved against the real `aws-cdk-lib` in
 * `packages/tools/repoGuards/__tests__/cdkQualifierCoverage.test.ts` and the template-parity proof; this package is
 * deliberately CDK-free (an app resolves its own single `aws-cdk-lib` instance), so it can only pin the data.
 */
import { describe, expect, it } from 'vitest';

import { accountAppProps, kitchenSinkAppProps, resolveStage } from '../src/appProps.js';
import { boundaryPolicyName } from '../src/qualifiers.js';

const QUALIFIER_KEY = '@aws-cdk/core:bootstrapQualifier';
const BOUNDARY_KEY = '@aws-cdk/core:permissionsBoundary';

describe('kitchenSinkAppProps', () => {
    it.each([
        ['prod', 'ksprod'],
        ['sandbox', 'ksnonprod'],
        ['pr-1', 'ksnonprod'],
        ['pr-4242', 'ksnonprod'],
        ['dev', 'ksnonprod'],
    ])('stage %s deploys through %s', (stage, qualifier) => {
        expect(kitchenSinkAppProps(stage).postCliContext[QUALIFIER_KEY]).toBe(qualifier);
    });

    it.each(['prod', 'sandbox', 'pr-1'])("puts the stage %s roles under that qualifier's boundary", (stage) => {
        const props = kitchenSinkAppProps(stage);
        const qualifier = props.postCliContext[QUALIFIER_KEY] as 'ksprod' | 'ksnonprod';

        expect(props.postCliContext[BOUNDARY_KEY]).toEqual({ name: boundaryPolicyName(qualifier) });
    });

    it("never gives a stage the other tier's boundary", () => {
        expect(kitchenSinkAppProps('prod').postCliContext[BOUNDARY_KEY]).not.toEqual(
            kitchenSinkAppProps('sandbox').postCliContext[BOUNDARY_KEY],
        );
    });

    it('sets context AFTER the CLI and cdk.json, so neither can redirect a stage to another qualifier', () => {
        // `postCliContext` is the AppProps field with the last word; plain `context` would lose to `-c` and cdk.json.
        const props = kitchenSinkAppProps('prod');

        expect(Object.keys(props)).toEqual(['postCliContext']);
    });

    it('returns plain data only, so it holds no aws-cdk-lib object from a second instance of the library', () => {
        expect(JSON.parse(JSON.stringify(kitchenSinkAppProps('prod')))).toEqual(kitchenSinkAppProps('prod'));
    });

    it('refuses an empty stage rather than choosing a qualifier for it', () => {
        expect(() => kitchenSinkAppProps('')).toThrow(/non-empty/u);
    });
});

describe('accountAppProps', () => {
    it('puts the stage-less account app on the ksaccount qualifier and its boundary', () => {
        const props = accountAppProps();

        expect(props.postCliContext[QUALIFIER_KEY]).toBe('ksaccount');
        expect(props.postCliContext[BOUNDARY_KEY]).toEqual({ name: boundaryPolicyName('ksaccount') });
    });

    it('takes no stage, so no stage can redirect the account app to another tier', () => {
        expect(accountAppProps).toHaveLength(0);
    });

    it('sets context AFTER the CLI and cdk.json, as the stage helper does', () => {
        expect(Object.keys(accountAppProps())).toEqual(['postCliContext']);
    });
});

describe('resolveStage', () => {
    it('reads the stage the CDK CLI passes as context', () => {
        expect(resolveStage({ CDK_CONTEXT_JSON: JSON.stringify({ stage: 'pr-7' }) })).toBe('pr-7');
    });

    it('prefers the CLI context over STAGE, as the apps always did', () => {
        expect(resolveStage({ CDK_CONTEXT_JSON: JSON.stringify({ stage: 'prod' }), STAGE: 'sandbox' })).toBe('prod');
    });

    it('falls back to STAGE when the context has none', () => {
        expect(resolveStage({ CDK_CONTEXT_JSON: JSON.stringify({ other: 1 }), STAGE: 'sandbox' })).toBe('sandbox');
        expect(resolveStage({ STAGE: 'pr-3' })).toBe('pr-3');
    });

    it('answers undefined when neither is set, so each app keeps its own default', () => {
        expect(resolveStage({})).toBeUndefined();
    });

    it('does not take a non-string context stage for a stage', () => {
        expect(resolveStage({ CDK_CONTEXT_JSON: JSON.stringify({ stage: 5 }), STAGE: 'sandbox' })).toBe('sandbox');
    });

    it.each(['null', '[]', '"prod"', '7'])(
        'does not read a stage out of a context that is not an object (%s)',
        (raw) => {
            expect(resolveStage({ CDK_CONTEXT_JSON: raw, STAGE: 'sandbox' })).toBe('sandbox');
        },
    );

    it('throws on a malformed context instead of guessing a stage', () => {
        expect(() => resolveStage({ CDK_CONTEXT_JSON: '{nope', STAGE: 'prod' })).toThrow();
    });
});
