/**
 * The function URL request, parsed into a typed search or a typed refusal at the boundary. `rid` is read first, so
 * every later refusal can echo it.
 */
import { describe, expect, it } from 'vitest';

import { makeSearchEvent, VALID_RID } from '../__fixtures__/searchEvent.js';
import { REMOTE_SEARCH_ADAPTER_REVISIONS, remoteSearchPath } from '../remoteSearch.schema.js';
import { parseSearchRequest } from '../searchRequest.js';

/** The served USDA path, and its revision: each refused path below differs from it in one way. */
const USDA_PATH = remoteSearchPath('usda');
const USDA_REVISION = REMOTE_SEARCH_ADAPTER_REVISIONS.usda;

describe('parseSearchRequest', () => {
    it('parses a search at the current USDA revision', () => {
        expect(parseSearchRequest(makeSearchEvent())).toStrictEqual({
            kind: 'search',
            rid: VALID_RID,
            source: 'usda',
            term: 'chicken breast',
            admitted: true,
        });
    });

    it('reads admit=0 as a search that may not call the source', () => {
        expect(parseSearchRequest(makeSearchEvent({ query: { admit: '0' } }))).toMatchObject({
            kind: 'search',
            admitted: false,
        });
    });

    it.each<[string, string]>([
        ['an older contract major', `/v0/usda/${String(USDA_REVISION)}/search`],
        ['a newer contract major', `/v2/usda/${String(USDA_REVISION)}/search`],
        ['a retired adapter revision', '/v1/usda/1/search'],
        ['a revision not yet cut', `/v1/usda/${String(USDA_REVISION + 1)}/search`],
        ['a source with no adapter', `/v1/ciqual/${String(USDA_REVISION)}/search`],
        ['a trailing slash', `${USDA_PATH}/`],
        ['an extra segment', `${USDA_PATH}/more`],
        ['no search segment', `/v1/usda/${String(USDA_REVISION)}`],
        ['the root', '/'],
        ['a different case', USDA_PATH.toUpperCase()],
    ])('refuses %s as not found', (_label, rawPath) => {
        expect(parseSearchRequest(makeSearchEvent({ rawPath }))).toStrictEqual({
            kind: 'refused',
            rid: VALID_RID,
            refusal: { reason: 'notFound' },
        });
    });

    it.each(['POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'])('refuses %s as a method not allowed', (method) => {
        expect(parseSearchRequest(makeSearchEvent({ method }))).toStrictEqual({
            kind: 'refused',
            rid: VALID_RID,
            refusal: { reason: 'methodNotAllowed' },
        });
    });

    it.each<[string, string | undefined]>([
        ['a ULID', '01J9ZK8N7QF3B2X4M6T0V5C1AB'],
        ['a UUID', '0f8fad5b-d9cb-469f-a165-70867728950e'],
        ['the shortest', 'a'.repeat(16)],
        ['the longest', 'a'.repeat(64)],
    ])('admits %s as a rid', (_label, rid) => {
        expect(parseSearchRequest(makeSearchEvent({ query: { rid } }))).toMatchObject({ kind: 'search', rid });
    });

    it.each<[string, Record<string, string | readonly string[] | undefined>]>([
        ['an absent rid', { rid: undefined }],
        ['an empty rid', { rid: '' }],
        ['a rid one short', { rid: 'a'.repeat(15) }],
        ['a rid one long', { rid: 'a'.repeat(65) }],
        ['a rid with a space', { rid: '01J9ZK8N7QF3B2X4M6T0V5C1A ' }],
        ['a rid that would split a header', { rid: '01J9ZK8N7QF3B2X4\r\nx-injected: 1' }],
        ['a rid given twice', { rid: [VALID_RID, VALID_RID] }],
    ])('refuses %s, and echoes nothing', (_label, query) => {
        expect(parseSearchRequest(makeSearchEvent({ query }))).toStrictEqual({
            kind: 'refused',
            rid: undefined,
            refusal: { reason: 'invalidParameter', parameter: 'rid' },
        });
    });

    it('reads rid before the method, so a refused method still echoes it', () => {
        expect(parseSearchRequest(makeSearchEvent({ method: 'POST', query: { rid: '' } }))).toMatchObject({
            refusal: { reason: 'invalidParameter', parameter: 'rid' },
        });
    });

    it.each<[string, Record<string, string | readonly string[] | undefined>]>([
        ['an absent term', { q: undefined }],
        ['an empty term', { q: '' }],
        ['a term that is not canonical', { q: 'Chicken Breast' }],
        ['a term given twice', { q: ['chicken breast', 'chicken breast'] }],
    ])('refuses %s', (_label, query) => {
        expect(parseSearchRequest(makeSearchEvent({ query }))).toStrictEqual({
            kind: 'refused',
            rid: VALID_RID,
            refusal: { reason: 'invalidParameter', parameter: 'q' },
        });
    });

    it.each<[string, Record<string, string | readonly string[] | undefined>]>([
        ['an absent admit', { admit: undefined }],
        ['admit=true', { admit: 'true' }],
        ['admit=2', { admit: '2' }],
        ['admit given twice', { admit: ['1', '1'] }],
    ])('refuses %s', (_label, query) => {
        expect(parseSearchRequest(makeSearchEvent({ query }))).toStrictEqual({
            kind: 'refused',
            rid: VALID_RID,
            refusal: { reason: 'invalidParameter', parameter: 'admit' },
        });
    });

    it('decodes a percent-encoded term before it checks the form', () => {
        const event = makeSearchEvent({ rawQueryString: `q=cr%C3%A8me%20fra%C3%AEche&admit=1&rid=${VALID_RID}` });

        expect(parseSearchRequest(event)).toMatchObject({ kind: 'search', term: 'crème fraîche' });
    });

    // The answer depends on q, admit and rid alone, so a parameter it does not read cannot change it.
    it('ignores a parameter it does not read', () => {
        expect(parseSearchRequest(makeSearchEvent({ query: { Signature: 'abc', 'Key-Pair-Id': 'K1' } }))).toMatchObject(
            { kind: 'search', term: 'chicken breast' },
        );
    });
});
