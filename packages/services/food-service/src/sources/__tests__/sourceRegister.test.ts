/**
 * The source register (plan R50, R52, R56): every source the catalog may cite or call, with its licence and, for
 * an API, its own rate-limit declaration.
 *
 * A source is admitted only when its licence allows commercial reuse and adds no share-alike term (016 FR-033), so
 * the refusal table below holds every source the 2026-09-30 licence review excluded, by its real licence.
 *
 * ADR-0053 adds to each API limit how long an outage blocks it and, where the publisher reports its own count, the
 * quota headers; and to each declaration an owner ruling that may hold it (ADR-0052 §8). The callable sources are
 * derived from the declarations, so a held source cannot be called by type.
 *
 * Runtime search calls only a source whose API can search by name; every static download belongs in the seed (owner,
 * 2026-10-01). So an API declaration states that it searches, a declaration whose API cannot is refused, and
 * Matvaretabellen and Livsmedelsdatabasen are file sources.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import { foodSourceEnum } from '../../db/schema/index.js';
import {
    apiAccessOf,
    admitsCalls,
    CALLABLE_API_SOURCES,
    isRegisteredSourceId,
    LICENCES,
    REGISTERED_SOURCE_IDS,
    SOURCE_REGISTER,
    parseSourceDeclaration,
    type CallableApiSourceId,
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
        remoteSearch: true,
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

    // The owner ruled on 2026-10-01 to use Livsmedelsdatabasen under CC BY 4.0, so no ruling holds any source now
    // (ADR-0052 §8). A source held later declares a `ruling`, and the derived sets below drop it by type.
    it('holds no source, so Livsmedelsdatabasen is cited under CC BY 4.0 (ADR-0052 §8)', () => {
        const held = REGISTERED_SOURCE_IDS.filter((id) => SOURCE_REGISTER[id].ruling?.held === true);

        expect(held).toEqual([]);
        expect(SOURCE_REGISTER.livsmedelsverket.licence).toBe('CC-BY-4.0');
    });
});

describe('the derived source sets', () => {
    // No registered source is held today, so the register alone never reaches the held branch. The rule is pinned
    // over declarations instead, so a source held later is refused by the rule this test proves (ADR-0052 §8).
    it.each<[string, SourceDeclaration, boolean]>([
        ['an API source with no ruling', API_SOURCE, true],
        [
            'an API source whose ruling the owner settled',
            { ...FULL_API_SOURCE, ruling: { held: false, since: '2026-09-30', question: 'May the data be changed?' } },
            true,
        ],
        ['an API source an open ruling holds', FULL_API_SOURCE, false],
        ['a file source', FILE_SOURCE, false],
    ])('admits calls to %s, or not', (_label, declaration, admitted) => {
        expect(admitsCalls(declaration)).toBe(admitted);
    });

    it('calls every API source that no ruling holds, which today is USDA alone (R57)', () => {
        expect(CALLABLE_API_SOURCES).toEqual(['usda']);
        expectTypeOf<CallableApiSourceId>().toEqualTypeOf<'usda'>();
    });

    it("reads a callable source's access as the register's own frozen declaration", () => {
        for (const id of CALLABLE_API_SOURCES) {
            expect(apiAccessOf(id)).toBe(SOURCE_REGISTER[id].access);
        }
    });

    // Matvaretabellen's API is its whole table as static files, and Livsmedelsdatabasen's can only list and fetch by
    // id. Neither can search, so both are read from their published files into the seed and never called (owner,
    // 2026-10-01): they declare no API and no rate limit.
    it('reaches only USDA through an API, and every other source, Matvaretabellen and Livsmedelsdatabasen included, through its file', () => {
        const access = Object.fromEntries(REGISTERED_SOURCE_IDS.map((id) => [id, SOURCE_REGISTER[id].access.kind]));

        expect(access).toEqual({
            usda: 'api',
            ciqual: 'file',
            cofid: 'file',
            bls: 'file',
            stfcj: 'file',
            matvaretabellen: 'file',
            livsmedelsverket: 'file',
            fsvo: 'file',
            cnf: 'file',
        });
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
            { ...API_SOURCE, access: { kind: 'api', baseUrl: 'https://api.example.org', remoteSearch: true } },
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
        ['an empty short name', { ...FILE_SOURCE, shortName: '' }],
        ['a short name as long as the name', { ...FILE_SOURCE, shortName: FILE_SOURCE.name }],
        ['a ruling with no question', { ...FILE_SOURCE, ruling: { held: true, since: '2026-09-30', question: '' } }],
        [
            'a ruling dated in a form that is not ISO 8601',
            { ...FILE_SOURCE, ruling: { held: true, since: '30/09/2026', question: 'May the data be changed?' } },
        ],
    ])('refuses %s', (_, declaration) => {
        expect(() => parseSourceDeclaration(declaration)).toThrow();
    });

    // Runtime search calls only a source whose API can search by name (owner, 2026-10-01). An API that can only list
    // or fetch by id is not called at all: its published file is read into the seed, so it is declared a file source.
    it.each([
        ['an API that cannot search by name', { ...API_SOURCE.access, remoteSearch: false }],
        ['an API that does not say whether it searches', withoutField({ ...API_SOURCE.access }, 'remoteSearch')],
    ])('refuses %s, which is a file source for the seed', (_, access) => {
        expect(() => parseSourceDeclaration({ ...API_SOURCE, access })).toThrow(/file source/u);
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

// What the Data sources page shows for a source (plan R55, design §S16): its short name as the card heading and the
// live search's hit tag, and its licence by name. The page never maps an id to either, so both live here.
describe('the names a reader sees', () => {
    it('accepts a declaration with a short name (positive control)', () => {
        expect(parseSourceDeclaration({ ...FILE_SOURCE, shortName: 'Example' }).shortName).toBe('Example');
    });

    it('names every licence it knows, admitted or refused, each differently', () => {
        const names = Object.values(LICENCES).map((licence) => licence.name);

        expect(names.every((name) => name.trim().length > 0)).toBe(true);
        expect(new Set(names).size).toBe(names.length);
    });

    it('names CC0 by its own title, as the design shows it', () => {
        expect(LICENCES['CC0-1.0'].name).toBe('CC0 1.0 Universal');
    });

    it('gives no two sources one short name, so two hit tags never read alike', () => {
        const shortNames = REGISTERED_SOURCE_IDS.flatMap((id) => {
            const { shortName } = SOURCE_REGISTER[id];

            return shortName === undefined ? [] : [shortName];
        });

        expect(new Set(shortNames).size).toBe(shortNames.length);
    });

    it('gives USDA the short name a cook knows it by', () => {
        expect(SOURCE_REGISTER.usda.shortName).toBe('USDA');
    });
});

describe('isRegisteredSourceId', () => {
    it.each(['usda', 'cofid', 'cnf'])('accepts the registered id %s', (id) => {
        expect(isRegisteredSourceId(id)).toBe(true);
    });

    it.each(['nevo', 'USDA', 'ciqual2025', '', 'manufacturerLabel'])('refuses %j', (id) => {
        expect(isRegisteredSourceId(id)).toBe(false);
    });
});
