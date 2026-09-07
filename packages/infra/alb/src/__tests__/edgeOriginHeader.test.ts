/**
 * ⛔ THE ACCEPTANCE CRITERION for the secret origin header — the boundary the prefix list is NOT
 * (plan U17, ADR-0020 trap 5).
 *
 * The prefix-list restriction landed first and authorizes **CloudFront**, not **our** CloudFront: the origin
 * hostnames are published in the public zone, so anyone may point their own distribution at
 * `food.internal.commise.app`. AWS's documented mechanism for "only through CloudFront" is a shared secret
 * header, and this module is its single authority.
 *
 * What is asserted where: the header's presence on the distributions lives in `EdgeStack.test.ts`, and its
 * presence on the listener rules lives in each service stack's own suite, because those are the two
 * templates where getting it wrong is visible. What belongs HERE is the rule itself — prod carries the
 * header, no other stage may, and the value is a CloudFormation dynamic reference rather than a literal.
 */
import { App, Stack } from 'aws-cdk-lib';
import { describe, expect, it } from 'vitest';

import {
    ALB_CONDITION_VALUE_MAX_LENGTH,
    EDGE_ORIGIN_HEADER_NAME,
    EDGE_ORIGIN_HEADER_VALUE_LENGTH,
    edgeOriginHeaderFor,
} from '../edgeOriginHeader.js';

/**
 * Resolve a CDK token to the string CloudFormation will actually receive.
 *
 * `SecretValue.unsafeUnwrap()` hands back a token (`${Token[TOKEN.n]}`), not the dynamic reference — the
 * reference only appears once something resolves it during synthesis. Asserting on the unresolved token
 * would pass for literally any token, which is the whole thing this file is checking against.
 *
 * @param value - The token string.
 * @returns The resolved string.
 */
function resolved(value: string): unknown {
    return new Stack(new App(), 'Resolver', { env: { account: '123456789012', region: 'us-east-1' } }).resolve(value);
}

describe('edgeOriginHeaderFor', () => {
    it('gives prod a header, because prod is the only stage with a distribution to send it', () => {
        const header = edgeOriginHeaderFor('prod');

        expect(header).toBeDefined();
        expect(header?.headerName).toBe(EDGE_ORIGIN_HEADER_NAME);
    });

    it('⛔ gives every other stage NOTHING — requiring a header no distribution sends is a total outage', () => {
        // Sandbox and every per-PR preview reach their ALB directly with no edge in front of it. A listener
        // rule demanding this header on those stages matches nothing, and every preview answers ADR-0003's
        // default 404 behind a completely green deploy. Absence IS the prod gate, the same shape
        // `internalOriginForStage` and `albHttpsIngressPrefixListFor` use.
        for (const stage of ['sandbox', 'pr-91', 'pr-1', 'dev', 'test', 'local', 'staging']) {
            expect(edgeOriginHeaderFor(stage), `stage ${stage}`).toBeUndefined();
        }
    });

    it('⛔ is exact about the stage name — a near-miss must not demand the header', () => {
        for (const stage of ['PROD', 'Prod', 'prod-2', 'preprod', 'prod ', ' prod', '']) {
            expect(edgeOriginHeaderFor(stage), `stage ${stage}`).toBeUndefined();
        }
    });
});

describe('the header NAME (deliberately not secret, and deliberately not a reserved one)', () => {
    it('is `x-commise-edge` — the name is public, only the VALUE is secret', () => {
        // A secret NAME makes every `cdk diff`, log line and 404 debugging session opaque and buys nothing
        // against a 64-character random value carried over TLS (the origin protocol is HTTPS_ONLY). Pinned
        // as a literal because four templates have to agree on it and none of them can see the others.
        expect(EDGE_ORIGIN_HEADER_NAME).toBe('x-commise-edge');
    });

    it('⛔ is not a header CloudFront refuses to add to an origin request', () => {
        // `OriginCustomHeaders` has a denylist. A name on it is rejected at deploy time — but the failure
        // that matters is the SILENT one: an `x-forwarded-*` name would collide with the hop-by-hop headers
        // the edge and the ALB both set, so the ALB would compare the header against something a client
        // supplied rather than something CloudFront did.
        const denied = [
            'cache-control',
            'connection',
            'content-length',
            'cookie',
            'host',
            'max-forwards',
            'pragma',
            'proxy-authenticate',
            'proxy-authorization',
            'proxy-connection',
            'range',
            'request-range',
            'te',
            'trailer',
            'transfer-encoding',
            'upgrade',
            'via',
            'x-cache',
            'x-real-ip',
        ];
        const deniedPrefixes = ['if-', 'x-accel-', 'x-amz-cf-', 'x-amzn-', 'x-edge-', 'x-forwarded-'];

        expect(denied).not.toContain(EDGE_ORIGIN_HEADER_NAME);

        for (const prefix of deniedPrefixes) {
            expect(EDGE_ORIGIN_HEADER_NAME.startsWith(prefix), `prefix ${prefix}`).toBe(false);
        }
    });

    it('is lower-case, because an ALB header condition matches the NAME case-insensitively but the value does not', () => {
        expect(EDGE_ORIGIN_HEADER_NAME).toBe(EDGE_ORIGIN_HEADER_NAME.toLowerCase());
    });
});

describe('the header VALUE is a dynamic reference, never a literal', () => {
    it('⛔ resolves to a Secrets Manager dynamic reference — nothing secret enters this PUBLIC repository', () => {
        // The single assertion this whole module exists for. CloudFormation fetches the value at deploy
        // time; the repository, the synthesized template and every `cdk diff` carry only the pointer.
        expect(resolved(edgeOriginHeaderFor('prod')!.value)).toMatch(/^\{\{resolve:secretsmanager:/u);
    });

    it('points at the SAME secret name the header struct publishes, so DomainStack cannot mint a different one', () => {
        const header = edgeOriginHeaderFor('prod')!;

        // `DomainStack` names the secret from `header.secretName` and this reference reads it back. They are
        // one fact seen from two sides — a mismatch is not a synth error, it is a deploy that cannot resolve
        // the reference, or worse, one that resolves a DIFFERENT secret.
        expect(String(resolved(header.value))).toContain(header.secretName);
    });

    it('reads the `value` JSON field, matching the key DomainStack generates into the secret', () => {
        expect(String(resolved(edgeOriginHeaderFor('prod')!.value))).toContain(':SecretString:value');
    });

    it('names the secret under the repository’s stage-scoped convention', () => {
        // `kitchensink/{stage}/{subsystem}/{thing}`, as `kitchensink/prod/identity/keys` and
        // `kitchensink/sandbox/food/usda-api-key` already are.
        expect(edgeOriginHeaderFor('prod')?.secretName).toBe('kitchensink/prod/edge/origin-header');
    });

    it('is stable across calls, so two stacks reading it emit the same template', () => {
        // A fresh `SecretValue` per call yields a fresh token id. Both resolve identically, but a resolver
        // whose output is not equal to itself is a trap for any caller that compares or caches it.
        expect(edgeOriginHeaderFor('prod')?.value).toBe(edgeOriginHeaderFor('prod')?.value);
    });
});

describe('the generated value has to survive an ALB listener-rule condition', () => {
    it('⛔ fits ALB’s 128-character condition-value cap, with room to spare', () => {
        // A value longer than the cap is refused at deploy time, after CloudFront is already sending it.
        expect(EDGE_ORIGIN_HEADER_VALUE_LENGTH).toBe(64);
        expect(EDGE_ORIGIN_HEADER_VALUE_LENGTH).toBeLessThan(ALB_CONDITION_VALUE_MAX_LENGTH);
    });

    it('records ALB’s cap as the number it actually is', () => {
        expect(ALB_CONDITION_VALUE_MAX_LENGTH).toBe(128);
    });

    it('⛔ carries enough entropy that guessing it is not a strategy', () => {
        // 64 characters from the 62-character alphanumeric alphabet `excludePunctuation` leaves is ~381
        // bits. The length is the only lever here: the alphabet is fixed by trap 2 (punctuation must be
        // excluded, because ALB treats `*` and `?` in a condition value as WILDCARDS, which would turn the
        // secret into a pattern matching values nobody generated).
        expect(EDGE_ORIGIN_HEADER_VALUE_LENGTH * Math.log2(62)).toBeGreaterThan(128);
    });
});
