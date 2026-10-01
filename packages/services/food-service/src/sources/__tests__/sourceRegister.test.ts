/**
 * The source register (plan R50, R52, R56): every source the catalog may cite or call, with its licence and, for
 * an API, its own rate-limit declaration.
 *
 * A source is admitted only when its licence allows commercial reuse and adds no share-alike term (016 FR-033), so
 * the refusal table below holds every source the 2026-09-30 licence review excluded, by its real licence.
 *
 * ADR-0053 adds to each API limit how long an outage blocks it and, where the publisher reports its own count, the
 * quota headers; and to each declaration an owner ruling that may hold it (ADR-0052 §8). The callable and mirror
 * sources are derived from the declarations, so a held source cannot be called by type.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import { foodSourceEnum } from '../../db/schema/index.js';
import {
    apiAccessOf,
    CALLABLE_API_SOURCES,
    isRegisteredSourceId,
    LICENCES,
    MIRROR_SOURCES,
    REGISTERED_SOURCE_IDS,
    SOURCE_REGISTER,
    parseSourceDeclaration,
    type CallableApiSourceId,
    type MirrorSourceId,
    type SourceDeclaration,
} from '../sourceRegister.js';

/** A file-only declaration that parses, for the refusal cases to vary one field at a time. */
const FILE_SOURCE: SourceDeclaration = {
    id: 'example',
    name: 'Example table',
    publisher: 'Example agency',
    edition: '2026',
    licence: 'CC-BY-4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
    attribution: 'Example table 2026, Example agency',
    attributionLanguage: 'en',
    homepage: 'https://example.org/table',
    basis: 'per100g',
    energyMethod: 'euRegulation1169',
    access: { kind: 'file' },
};

/** An API declaration that parses. */
const API_SOURCE: SourceDeclaration = {
    ...FILE_SOURCE,
    access: {
        kind: 'api',
        baseUrl: 'https://api.example.org/v1',
        remoteSearch: false,
        rateLimit: {
            requests: 600,
            windowSeconds: 3600,
            counts: 'clientAddress',
            stated: { by: 'us', reason: 'The publisher states no limit.' },
            breachBlockSeconds: 3600,
            outageBlockSeconds: 60,
        },
    },
};

/** An API declaration with every optional part: a quota the publisher reports, and a ruling that holds it. */
const FULL_API_SOURCE: SourceDeclaration = {
    ...API_SOURCE,
    ruling: { held: true, since: '2026-09-30', question: 'May the data be changed?' },
    access: {
        kind: 'api',
        baseUrl: 'https://api.example.org/v1',
        remoteSearch: true,
        rateLimit: {
            requests: 1000,
            windowSeconds: 3600,
            counts: 'apiKey',
            stated: { by: 'publisher', url: 'https://api.example.org/limits' },
            breachBlockSeconds: 3600,
            outageBlockSeconds: 60,
            quota: { remainingHeader: 'X-RateLimit-Remaining', limitHeader: 'X-RateLimit-Limit', probeSeconds: 300 },
        },
    },
};

describe('SOURCE_REGISTER', () => {
    it('declares every registered source under its own id, and each declaration parses', () => {
        for (const id of REGISTERED_SOURCE_IDS) {
            expect(SOURCE_REGISTER[id].id).toBe(id);
            expect(() => parseSourceDeclaration(SOURCE_REGISTER[id])).not.toThrow();
        }
    });

    it('tags each attribution with the language it is written in, so a page can mark it (WCAG 2.2 SC 3.1.2)', () => {
        const languages = Object.fromEntries(
            REGISTERED_SOURCE_IDS.map((id) => [id, SOURCE_REGISTER[id].attributionLanguage]),
        );

        expect(languages).toEqual({
            usda: 'en',
            ciqual: 'fr',
            cofid: 'en',
            bls: 'de',
            stfcj: 'ja',
            matvaretabellen: 'en',
            livsmedelsverket: 'sv',
            fsvo: 'en',
            cnf: 'en',
        });
    });

    it('holds every id the database enum allows, so a stored source always has a declaration', () => {
        // Equal, in order, since 0018 widened the enum to the register (plan U4); the database side is
        // tests/e2e/catalogSchema.e2e.test.ts's enum parity case.
        expect([...foodSourceEnum.enumValues]).toStrictEqual([...REGISTERED_SOURCE_IDS]);
    });

    it('freezes each declaration, down to its access and rate limit', () => {
        for (const id of REGISTERED_SOURCE_IDS) {
            const { access } = SOURCE_REGISTER[id];

            expect(Object.isFrozen(SOURCE_REGISTER[id])).toBe(true);
            expect(Object.isFrozen(access)).toBe(true);
            expect(access.kind === 'file' || Object.isFrozen(access.rateLimit)).toBe(true);
        }
    });

    // ADR-0053 §5 as amended by the U27 blueprint: an outage is not a breach, so a 5xx blocks USDA for today's 60 s,
    // not the hour a 429 earns (A1); and USDA's own `X-RateLimit-*` count blocks for five minutes once it shows 10%
    // or less left (A2), because only that count sees the key's other users.
    it("declares USDA's published limit, its hour-long breach block, a 60 s outage block and its quota headers", () => {
        const { access } = SOURCE_REGISTER.usda;

        expect(access.kind).toBe('api');
        expect(access.kind === 'api' && access.rateLimit).toEqual({
            requests: 1000,
            windowSeconds: 3600,
            counts: 'apiKey',
            stated: { by: 'publisher', url: 'https://fdc.nal.usda.gov/api-guide' },
            breachBlockSeconds: 3600,
            outageBlockSeconds: 60,
            quota: { remainingHeader: 'X-RateLimit-Remaining', limitHeader: 'X-RateLimit-Limit', probeSeconds: 300 },
        });
        expect(access.kind === 'api' && access.remoteSearch).toBe(true);
    });

    it('declares a quota only for USDA, the one publisher that reports its own count', () => {
        const withQuota = REGISTERED_SOURCE_IDS.filter((id) => {
            const { access } = SOURCE_REGISTER[id];

            return access.kind === 'api' && access.rateLimit.quota !== undefined;
        });

        expect(withQuota).toEqual(['usda']);
    });

    it('holds Livsmedelsdatabasen under an owner ruling, and no other source (ADR-0052 §8)', () => {
        const held = REGISTERED_SOURCE_IDS.flatMap((id) => {
            const { ruling } = SOURCE_REGISTER[id];

            return ruling?.held === true ? [{ id, since: ruling.since }] : [];
        });

        expect(held).toEqual([{ id: 'livsmedelsverket', since: '2026-09-30' }]);
        expect(SOURCE_REGISTER.livsmedelsverket.ruling?.question).toMatch(/får data inte förändras/u);
    });
});

describe('the derived source sets', () => {
    it('calls every API source that no ruling holds', () => {
        expect(CALLABLE_API_SOURCES).toEqual(['usda', 'matvaretabellen']);
        expectTypeOf<CallableApiSourceId>().toEqualTypeOf<'usda' | 'matvaretabellen'>();
    });

    it('mirrors every callable source that cannot search remotely (R57)', () => {
        expect(MIRROR_SOURCES).toEqual(['matvaretabellen']);
        expectTypeOf<MirrorSourceId>().toEqualTypeOf<'matvaretabellen'>();
    });

    it("reads a callable source's access as the register's own frozen declaration", () => {
        for (const id of CALLABLE_API_SOURCES) {
            expect(apiAccessOf(id)).toBe(SOURCE_REGISTER[id].access);
        }
    });

    it('lets only USDA search remotely today (R57)', () => {
        const remote = REGISTERED_SOURCE_IDS.filter((id) => {
            const { access } = SOURCE_REGISTER[id];

            return access.kind === 'api' && access.remoteSearch;
        });

        expect(remote).toEqual(['usda']);
    });

    it('admits every licence the register uses', () => {
        for (const id of REGISTERED_SOURCE_IDS) {
            const { commercial, shareAlike } = LICENCES[SOURCE_REGISTER[id].licence];

            expect({ id, commercial, shareAlike }).toEqual({ id, commercial: true, shareAlike: false });
        }
    });
});

describe('parseSourceDeclaration', () => {
    it('accepts a file source, an API source, and an API source with a quota and a ruling (positive controls)', () => {
        expect(parseSourceDeclaration(FILE_SOURCE).id).toBe('example');
        expect(parseSourceDeclaration(API_SOURCE).id).toBe('example');
        expect(parseSourceDeclaration(FULL_API_SOURCE).id).toBe('example');
    });

    // Every source the 2026-09-30 licence review excluded, by its real licence.
    it.each([
        ['NEVO, whose terms forbid charging end users', 'RIVM-NEVO-conditions'],
        ['Open Food Facts, share-alike', 'ODbL-1.0'],
        ['the Australian Food Composition Database, share-alike', 'CC-BY-SA-3.0-AU'],
        ['the FAO/INFOODS tables, non-commercial', 'CC-BY-NC-SA-3.0-IGO'],
        ["CoFID's API, non-commercial", 'CC-BY-NC-SA-4.0'],
    ] as const)('refuses %s', (_, licence) => {
        expect(() => parseSourceDeclaration({ ...FILE_SOURCE, licence })).toThrow(/licence/u);
    });

    it.each([
        ['a licence the register does not know', { ...FILE_SOURCE, licence: 'Proprietary-1.0' }],
        ['an id that carries an edition', { ...FILE_SOURCE, id: 'ciqual2025' }],
        ['an empty attribution', { ...FILE_SOURCE, attribution: '' }],
        ['an attribution language that is not a language tag', { ...FILE_SOURCE, attributionLanguage: 'French' }],
        ['a licence URL that is not https', { ...FILE_SOURCE, licenceUrl: 'http://example.org/licence' }],
        [
            'an API with no rate limit',
            { ...API_SOURCE, access: { kind: 'api', baseUrl: 'https://api.example.org', remoteSearch: false } },
        ],
        [
            'a limit the publisher states with no URL',
            {
                ...API_SOURCE,
                access: {
                    ...API_SOURCE.access,
                    rateLimit: { ...apiLimit(), stated: { by: 'publisher' } },
                },
            },
        ],
        [
            'a limit we impose with no reason',
            {
                ...API_SOURCE,
                access: { ...API_SOURCE.access, rateLimit: { ...apiLimit(), stated: { by: 'us', reason: '' } } },
            },
        ],
        [
            'a limit of zero requests',
            { ...API_SOURCE, access: { ...API_SOURCE.access, rateLimit: { ...apiLimit(), requests: 0 } } },
        ],
        [
            'a window of zero seconds',
            { ...API_SOURCE, access: { ...API_SOURCE.access, rateLimit: { ...apiLimit(), windowSeconds: 0 } } },
        ],
        ['remote search on a file source', { ...FILE_SOURCE, access: { kind: 'file', remoteSearch: true } }],
        [
            'a limit with no outage block',
            {
                ...API_SOURCE,
                access: { ...API_SOURCE.access, rateLimit: withoutField(apiLimit(), 'outageBlockSeconds') },
            },
        ],
        [
            'an outage block of zero seconds',
            { ...API_SOURCE, access: { ...API_SOURCE.access, rateLimit: { ...apiLimit(), outageBlockSeconds: 0 } } },
        ],
        [
            'a limit whose 90% ceiling admits no call',
            { ...API_SOURCE, access: { ...API_SOURCE.access, rateLimit: { ...apiLimit(), requests: 1 } } },
        ],
        [
            'a quota with no probe block',
            {
                ...API_SOURCE,
                access: {
                    ...API_SOURCE.access,
                    rateLimit: { ...apiLimit(), quota: { remainingHeader: 'X-Left', limitHeader: 'X-Limit' } },
                },
            },
        ],
        [
            'a quota header that is not a header name',
            {
                ...API_SOURCE,
                access: {
                    ...API_SOURCE.access,
                    rateLimit: {
                        ...apiLimit(),
                        quota: { remainingHeader: 'X Left', limitHeader: 'X-Limit', probeSeconds: 300 },
                    },
                },
            },
        ],
        ['a ruling with no question', { ...FILE_SOURCE, ruling: { held: true, since: '2026-09-30', question: '' } }],
        [
            'a ruling dated in a form that is not ISO 8601',
            { ...FILE_SOURCE, ruling: { held: true, since: '30/09/2026', question: 'May the data be changed?' } },
        ],
    ])('refuses %s', (_, declaration) => {
        expect(() => parseSourceDeclaration(declaration)).toThrow();
    });
});

/** The API fixture's rate limit, for the cases that vary one of its fields. */
function apiLimit(): Record<string, unknown> {
    const { access } = API_SOURCE;

    return access.kind === 'api' ? { ...access.rateLimit } : {};
}

/** A copy of a record without one field, for the cases that leave a required field out. */
function withoutField(record: Record<string, unknown>, field: string): Record<string, unknown> {
    return Object.fromEntries(Object.entries(record).filter(([key]) => key !== field));
}

describe('isRegisteredSourceId', () => {
    it.each(['usda', 'cofid', 'cnf'])('accepts the registered id %s', (id) => {
        expect(isRegisteredSourceId(id)).toBe(true);
    });

    it.each(['nevo', 'USDA', 'ciqual2025', '', 'manufacturerLabel'])('refuses %j', (id) => {
        expect(isRegisteredSourceId(id)).toBe(false);
    });
});
