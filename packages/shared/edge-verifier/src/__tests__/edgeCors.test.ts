/**
 * The edge's CORS headers are the headers the origins' `cors` middleware sends, row for row.
 *
 * The oracle is the real middleware, at the version `@nestjs/platform-express` pins, driven with the same options. A
 * row passes only when the adapter and the middleware emit the same header set AND that set says what the row
 * expects, so the table cannot pass by both sides agreeing on nothing.
 */
import { createRequire } from 'node:module';

import cors from 'cors';
import { describe, expect, it } from 'vitest';
import type { CloudFrontHeaders } from 'aws-lambda';

import { resolveCorsPolicy, type AppCorsOptions } from '@kitchensink/clerk-verify';

import { edgeCorsHeaders } from '../edgeCors.js';

/** Prod's exact party list, with credentials on, so the table also covers the header that switch adds. */
const PROD: AppCorsOptions = resolveCorsPolicy({
    deployed: true,
    authorizedPartiesRaw: 'https://commise.app,https://www.commise.app',
    previewBaseDomain: undefined,
    previewMode: undefined,
    credentials: true,
}).options;

/** A response as the oracle sees it: header names lower-cased, one value each. */
type SentHeaders = Readonly<Record<string, string>>;

/** The response half of the middleware's contract, plus the `getHeader` its `vary` dependency reads. */
interface RecordingResponse {
    statusCode?: number;
    getHeader(name: string): string | undefined;
    setHeader(name: string, value: string): void;
    end(): void;
}

/**
 * Run the real `cors` middleware on a non-preflight GET from `origin`, and return what it set.
 *
 * @param options - The policy's options, handed to the middleware unchanged.
 * @param origin - The request's `Origin`, or `undefined` for none.
 * @returns The headers the middleware set.
 */
function middlewareHeaders(options: AppCorsOptions, origin: string | undefined): SentHeaders {
    const sent = new Map<string, string>();
    const response: RecordingResponse = {
        getHeader: (name) => sent.get(name.toLowerCase()),
        setHeader: (name, value) => {
            sent.set(name.toLowerCase(), value);
        },
        end: () => undefined,
    };
    let passedOn = false;

    cors(options)({ method: 'GET', headers: origin === undefined ? {} : { origin } }, response, () => {
        passedOn = true;
    });

    // A non-preflight request is decorated and handed on synchronously for static options. A middleware that
    // answered the request itself, or never called `next`, would make this oracle say nothing.
    expect(passedOn).toBe(true);

    return Object.fromEntries(sent);
}

/** The adapter's CloudFront headers, flattened to the oracle's shape. */
function flatten(headers: CloudFrontHeaders): SentHeaders {
    return Object.fromEntries(Object.entries(headers).map(([name, [entry]]) => [name, entry?.value ?? '']));
}

describe('the oracle is the middleware the services run', () => {
    it('is cors@2.8.6, the version @nestjs/platform-express pins', () => {
        const manifest: { readonly version: string } = createRequire(import.meta.url)('cors/package.json');

        expect(manifest.version).toBe('2.8.6');
    });
});

describe('edgeCorsHeaders — the prod policy, against the middleware', () => {
    it.each<[string, string | undefined, boolean]>([
        ['an exact match', 'https://commise.app', true],
        ['the second listed party', 'https://www.commise.app', true],
        ['a trailing slash', 'https://commise.app/', false],
        ['a different case', 'https://Commise.app', false],
        ['a listed origin as a prefix of another host', 'https://commise.app.evil.example', false],
        ['the opaque `null` origin', 'null', false],
        ['an empty Origin header', '', false],
        ['no Origin header', undefined, false],
    ])('%s (%s): admitted=%s', (_label, origin, admitted) => {
        const edge = flatten(edgeCorsHeaders(PROD, origin));

        expect(edge).toEqual(middlewareHeaders(PROD, origin));
        expect(edge).toEqual({
            ...(admitted && origin !== undefined ? { 'access-control-allow-origin': origin } : {}),
            vary: 'Origin',
            'access-control-allow-credentials': 'true',
            'access-control-expose-headers': 'Retry-After',
        });
    });
});

describe('edgeCorsHeaders — every other shape the policy can take', () => {
    const WITHOUT_CREDENTIALS = resolveCorsPolicy({
        deployed: true,
        authorizedPartiesRaw: 'https://commise.app',
        previewBaseDomain: undefined,
        previewMode: undefined,
    }).options;
    const CLOSED = resolveCorsPolicy({
        deployed: true,
        authorizedPartiesRaw: undefined,
        previewBaseDomain: undefined,
        previewMode: undefined,
    }).options;
    const PREVIEW = resolveCorsPolicy({
        deployed: true,
        authorizedPartiesRaw: undefined,
        previewBaseDomain: 'sandbox.commise.app',
        previewMode: undefined,
    }).options;

    it.each<[string, AppCorsOptions, string, string | undefined]>([
        ['credentials off: no Allow-Credentials', WITHOUT_CREDENTIALS, 'https://commise.app', 'https://commise.app'],
        ['the closed policy admits nothing', CLOSED, 'https://commise.app', undefined],
        ['a preview-pattern match', PREVIEW, 'https://pr-7.sandbox.commise.app', 'https://pr-7.sandbox.commise.app'],
        ['a preview-pattern near miss', PREVIEW, 'https://pr-7.sandbox.commise.app.evil.example', undefined],
    ])('%s', (_label, options, origin, allowOrigin) => {
        const edge = flatten(edgeCorsHeaders(options, origin));

        expect(edge).toEqual(middlewareHeaders(options, origin));
        expect(edge['access-control-allow-origin']).toBe(allowOrigin);
        expect(edge['access-control-allow-credentials']).toBe(options.credentials ? 'true' : undefined);
        expect(edge['vary']).toBe('Origin');
    });

    it('omits Expose-Headers when the policy exposes nothing, as the middleware does', () => {
        const bare: AppCorsOptions = { ...PROD, exposedHeaders: [] };

        expect(flatten(edgeCorsHeaders(bare, 'https://commise.app'))).toEqual(
            middlewareHeaders(bare, 'https://commise.app'),
        );
        expect(edgeCorsHeaders(bare, 'https://commise.app')).not.toHaveProperty('access-control-expose-headers');
    });
});

describe("edgeCorsHeaders — CloudFront's header shape", () => {
    it('keys each header by its lower-cased name, with one entry carrying the canonical name', () => {
        for (const [name, entries] of Object.entries(edgeCorsHeaders(PROD, 'https://commise.app'))) {
            expect(entries).toHaveLength(1);
            expect(entries[0]?.key?.toLowerCase()).toBe(name);
        }
    });
});
