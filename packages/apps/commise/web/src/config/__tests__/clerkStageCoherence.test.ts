/**
 * Build-time guard against the 2026-08-07 production outage.
 *
 * WHAT HAPPENED. Vercel's Production environment carried a SANDBOX Clerk publishable key
 * (`pk_test_…` decoding to `nice-fowl-6.clerk.accounts.dev`) while `NEXT_PUBLIC_IDENTITY_API_URL` and
 * `NEXT_PUBLIC_RECIPE_API_URL` pointed at the PRODUCTION services. The identity service verifies Clerk
 * tokens networklessly against the production PEM, so every token the browser minted failed signature
 * verification, `GET /api/v1/users/me` returned a permanent 401, and the app's redirect-to-sign-in
 * handler turned that into an infinite loop between `/en` and `/en/sign-in?redirect_url=%2Fen`.
 *
 * WHY NOTHING CAUGHT IT. `src/config/env.ts` exists precisely to stop a wrong endpoint reaching
 * browsers — its docblock recounts the `http://localhost:3000` fallback incident — but its `client`
 * schema declared only the two API URLs. `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` was in NO schema and read
 * by NO source file: `@clerk/nextjs` picks it up implicitly, so its only existence was a string typed
 * into a dashboard. No IaC, no drift check, no review. `.env.template` says as much: "CI cannot catch
 * this class of gap… The only signal is a production deployment."
 *
 * WHY COHERENCE, NOT "PROD MUST BE pk_live". The defect was that the token ISSUER and the token
 * VERIFIER were different Clerk instances. That can happen in either direction — a `pk_live` key
 * against sandbox endpoints is equally broken, and would be equally invisible. Asserting coherence
 * catches both and stays stage-agnostic, so this guard does not need to know which stage it is running
 * in. That matters because the build does not reliably know either.
 *
 * KNOWN DUPLICATION, stated rather than hidden: `packages/infra/global/__tests__/prodWebSurface.ts`
 * implements the same classification for the RUNTIME probe against live production. The rule
 * ("production endpoints require a production Clerk instance") is one piece of knowledge in two places
 * — a build-time check in this package and a post-deploy check in another. Extracting it to a shared
 * package is the correct end state and is recorded as follow-up; it is not done here because the other
 * copy lives in a test directory that this package cannot import from.
 */
import { describe, it, expect } from 'vitest';

import { classifyClerkKey, classifyEndpointStage, findStageIncoherence } from '../clerkStageCoherence.js';

/** The real sandbox key shape: base64 payload decodes to `nice-fowl-6.clerk.accounts.dev$`. */
const SANDBOX_KEY = 'pk_test_bmljZS1mb3dsLTYuY2xlcmsuYWNjb3VudHMuZGV2JA';
/** The real production key shape: decodes to `clerk.commise.app$`. */
const PROD_KEY = 'pk_live_Y2xlcmsuY29tbWlzZS5hcHAk';

describe('classifyClerkKey', () => {
    it('decodes a production key to its Frontend API host', () => {
        expect(classifyClerkKey(PROD_KEY)).toEqual({ kind: 'live', fapiHost: 'clerk.commise.app' });
    });

    it('decodes a sandbox/development key to its Frontend API host', () => {
        expect(classifyClerkKey(SANDBOX_KEY)).toEqual({
            kind: 'test',
            fapiHost: 'nice-fowl-6.clerk.accounts.dev',
        });
    });

    it('returns null for a value that is not a Clerk publishable key', () => {
        expect(classifyClerkKey('sk_live_abc')).toBeNull();
        expect(classifyClerkKey('not-a-key')).toBeNull();
        expect(classifyClerkKey('')).toBeNull();
    });
});

describe('classifyEndpointStage', () => {
    it('recognises the production hosts', () => {
        expect(classifyEndpointStage('https://identity.commise.app')).toBe('production');
        expect(classifyEndpointStage('https://recipe.commise.app')).toBe('production');
    });

    it('recognises sandbox and per-PR hosts as non-production', () => {
        expect(classifyEndpointStage('https://identity.sandbox.commise.app')).toBe('non-production');
        expect(classifyEndpointStage('https://recipe-pr-73.commise.app')).toBe('non-production');
    });

    it('recognises localhost as local', () => {
        expect(classifyEndpointStage('http://localhost:3000')).toBe('local');
    });

    it('returns unknown for a host it cannot place — never a silent pass', () => {
        expect(classifyEndpointStage('https://example.org')).toBe('unknown');
    });
});

describe('findStageIncoherence — the outage, as an assertion', () => {
    it('REJECTS the exact production configuration that shipped on 2026-08-07', () => {
        const problems = findStageIncoherence({
            clerkPublishableKey: SANDBOX_KEY,
            endpoints: {
                NEXT_PUBLIC_IDENTITY_API_URL: 'https://identity.commise.app',
                NEXT_PUBLIC_RECIPE_API_URL: 'https://recipe.commise.app',
            },
        });

        expect(problems).not.toEqual([]);
        expect(problems.join(' ')).toContain('nice-fowl-6.clerk.accounts.dev');
        expect(problems.join(' ')).toContain('identity.commise.app');
    });

    it('accepts a coherent production configuration', () => {
        expect(
            findStageIncoherence({
                clerkPublishableKey: PROD_KEY,
                endpoints: {
                    NEXT_PUBLIC_IDENTITY_API_URL: 'https://identity.commise.app',
                    NEXT_PUBLIC_RECIPE_API_URL: 'https://recipe.commise.app',
                },
            }),
        ).toEqual([]);
    });

    it('accepts a coherent sandbox configuration', () => {
        expect(
            findStageIncoherence({
                clerkPublishableKey: SANDBOX_KEY,
                endpoints: {
                    NEXT_PUBLIC_IDENTITY_API_URL: 'https://identity.sandbox.commise.app',
                    NEXT_PUBLIC_RECIPE_API_URL: 'https://recipe-pr-73.commise.app',
                },
            }),
        ).toEqual([]);
    });

    it('REJECTS the mirror image — a production key against sandbox endpoints', () => {
        // Equally broken and equally invisible, which is why the rule is coherence and not "prod needs live".
        const problems = findStageIncoherence({
            clerkPublishableKey: PROD_KEY,
            endpoints: {
                NEXT_PUBLIC_IDENTITY_API_URL: 'https://identity.sandbox.commise.app',
                NEXT_PUBLIC_RECIPE_API_URL: 'https://recipe-pr-73.commise.app',
            },
        });

        expect(problems).not.toEqual([]);
    });

    it('allows a development key against localhost — the everyday local case', () => {
        expect(
            findStageIncoherence({
                clerkPublishableKey: SANDBOX_KEY,
                endpoints: {
                    NEXT_PUBLIC_IDENTITY_API_URL: 'http://localhost:3000',
                    NEXT_PUBLIC_RECIPE_API_URL: 'http://localhost:3001',
                },
            }),
        ).toEqual([]);
    });

    it('REJECTS a production key against localhost — pk_live is domain-locked and cannot work there', () => {
        // Recorded in this repo: clerk-js aborts on localhost with a production key. Catching it at build
        // time beats discovering it as a blank page.
        expect(
            findStageIncoherence({
                clerkPublishableKey: PROD_KEY,
                endpoints: { NEXT_PUBLIC_IDENTITY_API_URL: 'http://localhost:3000' },
            }),
        ).not.toEqual([]);
    });

    it('reports an unparseable key rather than passing it through', () => {
        expect(
            findStageIncoherence({
                clerkPublishableKey: 'garbage',
                endpoints: { NEXT_PUBLIC_IDENTITY_API_URL: 'https://identity.commise.app' },
            }),
        ).not.toEqual([]);
    });

    it('reports an unknown endpoint host rather than passing it through', () => {
        // A host nobody classified is exactly where the next variant of this bug hides.
        expect(
            findStageIncoherence({
                clerkPublishableKey: PROD_KEY,
                endpoints: { NEXT_PUBLIC_IDENTITY_API_URL: 'https://who-knows.example' },
            }),
        ).not.toEqual([]);
    });
});
