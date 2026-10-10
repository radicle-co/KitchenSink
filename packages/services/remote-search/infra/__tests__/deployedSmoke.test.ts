/**
 * The post-deploy smoke's two judgements (ADR-0055 point 7): the CDN refuses an unsigned request ITSELF, and the
 * function URL refuses a request that did not come through the CDN. Each is a fixture table over the answers a
 * deployed stage can give, so a judgement that passes the wrong refusal fails here.
 */
import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { remoteSearchPath } from '@kitchensink/schema-remote-search';

import {
    classifyDirectFunctionUrlAnswer,
    classifySignedProbeAnswer,
    classifyUnsignedCdnAnswer,
    signedProbeUrl,
    type ProbeAnswer,
} from '../smoke/deployedSmoke.js';

/** CloudFront's own refusal of a request with no signature. */
const MISSING_KEY_BODY =
    '<?xml version="1.0" encoding="UTF-8"?><Error><Code>MissingKey</Code>' +
    '<Message>Missing Key-Pair-Id query parameter or cookie value</Message></Error>';

/**
 * An answer.
 *
 * @param overrides - Fields to replace.
 * @returns The answer.
 */
function answer(overrides: Partial<ProbeAnswer>): ProbeAnswer {
    return { status: 403, headers: {}, body: '', ...overrides };
}

describe('classifyUnsignedCdnAnswer', () => {
    it('passes CloudFront refusing a request that carries no key', () => {
        expect(
            classifyUnsignedCdnAnswer(
                answer({ headers: { 'x-cache': 'Error from cloudfront' }, body: MISSING_KEY_BODY }),
            ),
        ).toEqual({ ok: true });
    });

    it.each([
        [
            'an answer from the function: the signature is not enforced',
            answer({ status: 200, body: '{"outcome":"found"}' }),
        ],
        [
            'a "not admitted" from the function',
            answer({
                status: 200,
                headers: { 'x-search-rid': 'abc' },
                body: '{"outcome":"notAdmitted"}',
            }),
        ],
        ['a 403 the CDN did not produce', answer({ body: MISSING_KEY_BODY })],
        [
            'a CloudFront 403 for another reason',
            answer({
                headers: { 'x-cache': 'Error from cloudfront' },
                body: '<Error><Code>AccessDenied</Code></Error>',
            }),
        ],
        ['a 502 from the origin', answer({ status: 502, headers: { 'x-cache': 'Error from cloudfront' } })],
        ['no answer at all', answer({ status: 0 })],
    ])('fails %s', (_label, given) => {
        expect(classifyUnsignedCdnAnswer(given)).toEqual({ ok: false, reason: expect.any(String) });
    });
});

describe('classifyDirectFunctionUrlAnswer', () => {
    it.each([
        ['an IAM refusal with its error type', answer({ headers: { 'x-amzn-errortype': 'AccessDeniedException' } })],
        ['an IAM refusal with its message', answer({ body: '{"Message":"Forbidden"}' })],
    ])('passes %s', (_label, given) => {
        expect(classifyDirectFunctionUrlAnswer(given)).toEqual({ ok: true });
    });

    it.each([
        ['an answer: the URL is open to anyone', answer({ status: 200, body: '{"outcome":"found"}' })],
        [
            'a "not admitted": the function ran',
            answer({ status: 200, headers: { 'x-search-rid': 'abc' }, body: '{"outcome":"notAdmitted"}' }),
        ],
        [
            'a 403 the function itself sent',
            answer({ headers: { 'x-search-rid': 'abc', 'x-amzn-errortype': 'AccessDeniedException' } }),
        ],
        ['a 403 with no sign of IAM', answer({ body: 'denied' })],
        ['no answer at all', answer({ status: 0 })],
    ])('fails %s', (_label, given) => {
        expect(classifyDirectFunctionUrlAnswer(given)).toEqual({ ok: false, reason: expect.any(String) });
    });
});

/** This probe's request id. */
const RID = 'deployedsmoke0123456789abcdef';

/** The function's "not admitted", for this request, not kept by the CDN. */
const NOT_ADMITTED = answer({
    status: 200,
    headers: { 'x-search-rid': RID, 'x-cache': 'Miss from cloudfront' },
    body: '{"outcome":"notAdmitted"}',
});

describe('classifySignedProbeAnswer', () => {
    it('passes the function answering "not admitted" for this request, through the CDN', () => {
        expect(classifySignedProbeAnswer(NOT_ADMITTED, RID)).toEqual({ ok: true });
    });

    it.each([
        [
            'CloudFront refusing the signature food makes',
            answer({
                headers: { 'x-cache': 'Error from cloudfront' },
                body: '<Error><Code>AccessDenied</Code></Error>',
            }),
        ],
        [
            'a "not admitted" for another request',
            answer({ ...NOT_ADMITTED, headers: { 'x-search-rid': 'deployedsmokeOTHER00000000' } }),
        ],
        ['a "not admitted" with no echo', answer({ ...NOT_ADMITTED, headers: { 'x-cache': 'Miss from cloudfront' } })],
        [
            'a "not admitted" the CDN kept',
            answer({ ...NOT_ADMITTED, headers: { 'x-search-rid': RID, 'x-cache': 'Hit from cloudfront' } }),
        ],
        ['a 200 whose body is not "not admitted"', answer({ ...NOT_ADMITTED, body: '{"outcome":"found","items":[]}' })],
        ['a 200 whose body is not JSON', answer({ ...NOT_ADMITTED, body: 'not admitted' })],
        [
            'a 428 from an older build: the status moved to 200 so a cached 4xx can no longer poison the slot',
            answer({ ...NOT_ADMITTED, status: 428 }),
        ],
        [
            'an answer: the term was not new, so this probe proves nothing about a miss',
            answer({ status: 200, headers: { 'x-search-rid': RID }, body: '{"outcome":"empty"}' }),
        ],
        ['the function failing', answer({ status: 502, headers: { 'x-search-rid': RID }, body: '{}' })],
        ['no answer at all', answer({ status: 0 })],
    ])('fails %s', (_label, given) => {
        expect(classifySignedProbeAnswer(given, RID)).toEqual({ ok: false, reason: expect.any(String) });
    });
});

describe('signedProbeUrl', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    const NOW = Date.UTC(2026, 9, 3, 6, 0, 0);
    const ORIGIN = 'https://remote-search-pr-7.example.com';
    const signed = signedProbeUrl(
        ORIGIN,
        'deployed smoke qwertyuiop',
        RID,
        { keyPairId: 'K2JCJMDEHXQW5F', privateKey },
        NOW,
    );
    const resource = signed.slice(0, signed.indexOf('&Expires='));
    const params = new URL(signed).searchParams;

    it('asks the source’s search path with the term, admission OFF and this request’s id, inside the signature', () => {
        const url = new URL(resource);

        expect(`${url.origin}${url.pathname}`).toBe(`${ORIGIN}${remoteSearchPath('usda')}`);
        expect(Object.fromEntries(url.searchParams)).toEqual({ q: 'deployed smoke qwertyuiop', admit: '0', rid: RID });
    });

    it('signs as food does: a canned policy, SHA-256, for one minute, under the key-pair id', () => {
        const expires = NOW / 1_000 + 60;
        const policy = JSON.stringify({
            Statement: [{ Resource: resource, Condition: { DateLessThan: { 'AWS:EpochTime': expires } } }],
        });
        const signature = Buffer.from(
            (params.get('Signature') ?? '').replaceAll('-', '+').replaceAll('_', '=').replaceAll('~', '/'),
            'base64',
        );

        expect(params.get('Hash-Algorithm')).toBe('SHA256');
        expect(params.get('Key-Pair-Id')).toBe('K2JCJMDEHXQW5F');
        expect(Number(params.get('Expires'))).toBe(expires);
        expect(verify('sha256', Buffer.from(policy), createPublicKey(publicKey), signature)).toBe(true);
    });
});
