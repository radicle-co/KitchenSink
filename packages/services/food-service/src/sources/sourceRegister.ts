/**
 * The source register (plan R50, R52, R56): every source the catalog may cite or call. A source that is not here can
 * be neither cited by the seed nor called at run time.
 *
 * Each declaration states the source's licence, the attribution its licence requires, the basis its values are
 * published on, how it is reached, and, for an API, its own rate limit. A source is admitted only when its licence
 * allows commercial reuse and adds no share-alike term (016 FR-033); `LICENCES` holds that judgement once, including
 * for the licences the 2026-09-30 review refused, so a refused source cannot be re-added under its real licence.
 * ADR-0052 records each source and each exclusion.
 *
 * @pattern Registry — a typed Record over the source ids, so an id with no declaration fails to compile
 * @pattern Value Object — each declaration is frozen and parsed once at load
 * @module
 */
import { z } from 'zod';

import { sourceCeiling } from './transport/sourceCeiling.js';

/** Every licence the register knows, admitted or refused. */
const LICENCE_IDS = [
    'CC0-1.0',
    'CC-BY-4.0',
    'etalab-2.0',
    'OGL-UK-3.0',
    'OGL-Canada-2.0',
    'NLOD-2.0',
    'MEXT-site-terms',
    'opendata-swiss-terms-by',
    'ODbL-1.0',
    'CC-BY-SA-3.0-AU',
    'CC-BY-NC-SA-3.0-IGO',
    'CC-BY-NC-SA-4.0',
    'RIVM-NEVO-conditions',
] as const;

/** A licence the register knows. */
export type LicenceId = (typeof LICENCE_IDS)[number];

/** What a licence allows, as the review read its text. Admission needs commercial reuse and no share-alike term. */
export const LICENCES: Readonly<Record<LicenceId, { readonly commercial: boolean; readonly shareAlike: boolean }>> = {
    'CC0-1.0': { commercial: true, shareAlike: false },
    'CC-BY-4.0': { commercial: true, shareAlike: false },
    'etalab-2.0': { commercial: true, shareAlike: false },
    'OGL-UK-3.0': { commercial: true, shareAlike: false },
    'OGL-Canada-2.0': { commercial: true, shareAlike: false },
    'NLOD-2.0': { commercial: true, shareAlike: false },
    // MEXT's website terms allow commercial use and declare themselves compatible with CC BY 4.0.
    'MEXT-site-terms': { commercial: true, shareAlike: false },
    // opendata.swiss "terms_by": commercial use allowed, the source must be given.
    'opendata-swiss-terms-by': { commercial: true, shareAlike: false },
    'ODbL-1.0': { commercial: true, shareAlike: true },
    'CC-BY-SA-3.0-AU': { commercial: true, shareAlike: true },
    'CC-BY-NC-SA-3.0-IGO': { commercial: false, shareAlike: true },
    'CC-BY-NC-SA-4.0': { commercial: false, shareAlike: true },
    // NEVO's conditions: "The user is not allowed to charge (end)users for the use of" the data.
    'RIVM-NEVO-conditions': { commercial: false, shareAlike: false },
};

/** How a source computes energy. Stored as published, with this recorded (R53). */
const ENERGY_METHODS = ['usdaAtwater', 'euRegulation1169', 'ukCofid', 'japanStfcj2020', 'canadaCnf'] as const;

/** The basis a source publishes values on. CoFID gives alcoholic drinks per 100 mL and everything else per 100 g. */
const BASES = ['per100g', 'per100gDrinksPer100mL'] as const;

const httpsUrl = z.url({ protocol: /^https$/ });

const positiveSeconds = z.number().int().positive();

/** An HTTP field name: one or more token characters (RFC 9110 §5.1), here letters, digits and hyphens. */
const headerName = z.string().regex(/^[A-Za-z0-9-]+$/u, 'must be an HTTP header name');

/** The publisher's own count of its quota, reported on every response (ADR-0053 §5). */
const quotaSchema = z.strictObject({
    remainingHeader: headerName,
    limitHeader: headerName,
    /** How long the source is blocked once the publisher reports 10% or less of its quota left. */
    probeSeconds: positiveSeconds,
});

/** A source's own rate limit (R56). */
const rateLimitSchema = z
    .strictObject({
        requests: z.number().int().positive(),
        windowSeconds: positiveSeconds,
        /** What the publisher counts calls against. */
        counts: z.enum(['apiKey', 'clientAddress']),
        /** Who states the limit: the publisher, with the page that says so, or us, with the reason. */
        stated: z.discriminatedUnion('by', [
            z.strictObject({ by: z.literal('publisher'), url: httpsUrl }),
            z.strictObject({ by: z.literal('us'), reason: z.string().min(1) }),
        ]),
        /** How long a breach blocks the source: a 429, or the publisher's quota at 0. */
        breachBlockSeconds: positiveSeconds,
        /**
         * How long a 502, 503 or 504 blocks the source. An outage is not a breach: blocking USDA for its hour-long
         * breach block on one gateway error would stop every caller for an hour (U27 blueprint, amendment A1).
         */
        outageBlockSeconds: positiveSeconds,
        /** The publisher's own count, when it reports one. Only that count sees the key's other users. */
        quota: quotaSchema.optional(),
    })
    .refine((limit) => sourceCeiling(limit.requests) >= 1, 'the 90% ceiling of this limit admits no call');

/**
 * An open owner ruling on a source (ADR-0052 §8). A held source is neither cited, mirrored nor called until the owner
 * rules; the ruling is recorded here so the hold is a fact of the register, not a comment beside it.
 */
const rulingSchema = z.strictObject({
    held: z.boolean(),
    /** The day the question was put to the owner. ISO 8601 date. */
    since: z.iso.date(),
    question: z.string().min(1),
});

const accessSchema = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('file') }),
    z.strictObject({
        kind: z.literal('api'),
        baseUrl: httpsUrl,
        /** Whether the API can search by name. A source that cannot is searched through its mirror (R57). */
        remoteSearch: z.boolean(),
        rateLimit: rateLimitSchema,
    }),
]);

const declarationSchema = z.strictObject({
    /** Lowercase letters only, so an id never carries an edition (`ciqual`, not `ciqual2025`). */
    id: z.string().regex(/^[a-z]+$/u, 'a source id is lowercase letters only, with no edition'),
    name: z.string().min(1),
    publisher: z.string().min(1),
    edition: z.string().min(1),
    licence: z
        .enum(LICENCE_IDS)
        .refine(
            (licence) => LICENCES[licence].commercial && !LICENCES[licence].shareAlike,
            'licence does not allow commercial reuse without share-alike terms',
        ),
    licenceUrl: httpsUrl,
    attribution: z.string().min(1),
    /** The BCP 47 tag of the attribution's language, so a page can mark text not in its own (WCAG 2.2 SC 3.1.2). */
    attributionLanguage: z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/u, 'must be a BCP 47 language tag'),
    homepage: httpsUrl,
    basis: z.enum(BASES),
    energyMethod: z.enum(ENERGY_METHODS),
    access: accessSchema,
    ruling: rulingSchema.optional(),
});

/** One admitted source's declaration. */
export type SourceDeclaration = z.input<typeof declarationSchema>;

/** A source's rate limit (R56). */
export type RateLimitDeclaration = z.infer<typeof rateLimitSchema>;

/** How an API source is reached: its base URL, whether it searches by name, and its limit. */
export type ApiAccess = Extract<SourceDeclaration['access'], { kind: 'api' }>;

/**
 * Parse one declaration, refusing a source that cannot be cited or called.
 *
 * @param declaration - The declaration to check.
 * @returns The parsed declaration.
 * @throws {z.ZodError} naming the refused field.
 */
export function parseSourceDeclaration(declaration: unknown): z.infer<typeof declarationSchema> {
    return declarationSchema.parse(declaration);
}

/** Every registered source id, in register order. The `food_source` database enum holds exactly these (0018). */
export const REGISTERED_SOURCE_IDS = [
    'usda',
    'ciqual',
    'cofid',
    'bls',
    'stfcj',
    'matvaretabellen',
    'livsmedelsverket',
    'fsvo',
    'cnf',
] as const;

/** A registered source id. */
export type RegisteredSourceId = (typeof REGISTERED_SOURCE_IDS)[number];

/**
 * Whether a text is a registered source id. Pure.
 *
 * @param value - The text, for example a command-line argument.
 * @returns True for a registered id, exactly as registered.
 */
export function isRegisteredSourceId(value: string): value is RegisteredSourceId {
    return REGISTERED_SOURCE_IDS.some((id) => id === value);
}

// `as const satisfies`, not an annotation: each declaration keeps its literal type, so the callable and mirror
// source sets below are DERIVED from what is declared here rather than kept beside it as a second list.
const DECLARATIONS = {
    usda: {
        id: 'usda',
        name: 'FoodData Central',
        publisher: 'U.S. Department of Agriculture, Agricultural Research Service',
        edition: 'SR Legacy 2018-04, Foundation 2026-04-30, FNDDS 2021-2023, Branded 2026-04-30',
        licence: 'CC0-1.0',
        licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
        attribution:
            'U.S. Department of Agriculture, Agricultural Research Service, Beltsville Human Nutrition Research Center. FoodData Central.',
        attributionLanguage: 'en',
        homepage: 'https://fdc.nal.usda.gov/',
        basis: 'per100g',
        energyMethod: 'usdaAtwater',
        access: {
            kind: 'api',
            baseUrl: 'https://api.nal.usda.gov/fdc/v1',
            remoteSearch: true,
            // ⚠️ The limit counts per API KEY, across every api.data.gov request made with it (api.data.gov developer
            // manual). Sandbox and every preview share the sandbox key while each counts its calls in its own
            // database, so together they can exceed it and block the key for an hour. Fixing that is deferred
            // (owner, 2026-09-30; plan R56). The FDC page says "per IP address". The stricter per-key reading is kept.
            rateLimit: {
                requests: 1000,
                windowSeconds: 3600,
                counts: 'apiKey',
                stated: { by: 'publisher', url: 'https://fdc.nal.usda.gov/api-guide' },
                breachBlockSeconds: 3600,
                // Today's 429 failsafe (`RollingWindowLimiter`'s 60 s), kept for a gateway error.
                outageBlockSeconds: 60,
                // api.data.gov reports the key's own count on every response (plan U26). It is the only count that
                // sees the key's other users, so it is read as well as our call log.
                quota: {
                    remainingHeader: 'X-RateLimit-Remaining',
                    limitHeader: 'X-RateLimit-Limit',
                    probeSeconds: 300,
                },
            },
        },
    },
    ciqual: {
        id: 'ciqual',
        name: 'Ciqual French food composition table',
        publisher: 'Anses',
        edition: '2025',
        licence: 'etalab-2.0',
        licenceUrl: 'https://www.etalab.gouv.fr/licence-ouverte-open-licence/',
        attribution: 'Anses. 2025. Table de composition nutritionnelle des aliments Ciqual.',
        attributionLanguage: 'fr',
        homepage: 'https://ciqual.anses.fr/',
        basis: 'per100g',
        energyMethod: 'euRegulation1169',
        access: { kind: 'file' },
    },
    cofid: {
        id: 'cofid',
        name: "McCance and Widdowson's Composition of Foods Integrated Dataset",
        publisher: 'Public Health England',
        edition: '2021',
        licence: 'OGL-UK-3.0',
        licenceUrl: 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/',
        attribution:
            "Contains public sector information licensed under the Open Government Licence v3.0: McCance and Widdowson's Composition of Foods Integrated Dataset 2021.",
        attributionLanguage: 'en',
        homepage: 'https://www.gov.uk/government/publications/composition-of-foods-integrated-dataset-cofid',
        basis: 'per100gDrinksPer100mL',
        energyMethod: 'ukCofid',
        access: { kind: 'file' },
    },
    bls: {
        id: 'bls',
        name: 'Bundeslebensmittelschlüssel (German Nutrient Database)',
        publisher: 'Max Rubner-Institut',
        edition: '4.0',
        licence: 'CC-BY-4.0',
        licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
        attribution:
            'Max Rubner-Institut (2025): Bundeslebensmittelschlüssel (BLS), Version 4.0. DOI 10.25826/Data20251217-134202-0.',
        attributionLanguage: 'de',
        homepage: 'https://www.blsdb.de/',
        basis: 'per100g',
        energyMethod: 'euRegulation1169',
        access: { kind: 'file' },
    },
    stfcj: {
        id: 'stfcj',
        name: 'Standard Tables of Food Composition in Japan',
        publisher: 'Ministry of Education, Culture, Sports, Science and Technology',
        edition: 'Eighth edition, 2023 supplement, updated 2026-03-27',
        licence: 'MEXT-site-terms',
        licenceUrl: 'https://www.mext.go.jp/b_menu/1351168.htm',
        attribution: '出典：日本食品標準成分表（八訂）増補2023年',
        attributionLanguage: 'ja',
        homepage: 'https://www.mext.go.jp/a_menu/syokuhinseibun/index.htm',
        basis: 'per100g',
        energyMethod: 'japanStfcj2020',
        access: { kind: 'file' },
    },
    matvaretabellen: {
        id: 'matvaretabellen',
        name: 'Matvaretabellen (Norwegian Food Composition Table)',
        publisher: 'Mattilsynet',
        edition: '2026',
        // NLOD 2.0 covers the dataset and its matvaretabellen.no distribution, which publishes the 2026 table:
        // https://data.norge.no/en/datasets/bc57cc76-4d20-3c21-ae1b-c5a3cdcb58f7/matvaretabellen (read 2026-10-01).
        // The download page asks for the reference below.
        licence: 'NLOD-2.0',
        licenceUrl: 'https://data.norge.no/nlod/en/2.0',
        attribution:
            'Norwegian Food Composition Table 2026. The Norwegian Food Safety Authority. www.matvaretabellen.no',
        attributionLanguage: 'en',
        homepage: 'https://www.matvaretabellen.no/',
        basis: 'per100g',
        energyMethod: 'euRegulation1169',
        access: {
            kind: 'api',
            // The "API" is the whole table as five static JSON files, which the publisher invites callers to cache.
            baseUrl: 'https://www.matvaretabellen.no/api',
            remoteSearch: false,
            rateLimit: {
                requests: 24,
                windowSeconds: 86400,
                counts: 'clientAddress',
                stated: {
                    by: 'us',
                    reason: 'Mattilsynet states no limit and updates yearly. A mirror sync is one GET of the whole foods table.',
                },
                breachBlockSeconds: 3600,
                outageBlockSeconds: 60,
            },
        },
    },
    livsmedelsverket: {
        id: 'livsmedelsverket',
        name: 'Livsmedelsdatabasen (Swedish Food Composition Database)',
        publisher: 'Livsmedelsverket',
        edition: '2026-07-01',
        // ⚠️ Held: the `ruling` below. Until the owner rules it is neither cited, mirrored nor called (ADR-0052 §8).
        ruling: {
            held: true,
            since: '2026-09-30',
            question:
                'The API page grants CC BY 4.0 with adaptations, and the Excel download page adds "får data inte förändras" (the data must not be changed). Which governs the data?',
        },
        licence: 'CC-BY-4.0',
        licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
        attribution: 'Livsmedelsverkets Livsmedelsdatabas version 2026-07-01.',
        attributionLanguage: 'sv',
        homepage: 'https://www.livsmedelsverket.se/en/about-us/open-data/food-composition-data/',
        basis: 'per100g',
        energyMethod: 'euRegulation1169',
        access: {
            kind: 'api',
            baseUrl: 'https://dataportal.livsmedelsverket.se/livsmedel/api/v1',
            remoteSearch: false,
            rateLimit: {
                requests: 600,
                windowSeconds: 3600,
                counts: 'clientAddress',
                stated: {
                    by: 'us',
                    reason: 'Livsmedelsverket states no limit. One call every 6 s keeps a 2,600-food mirror sync under 5 h.',
                },
                breachBlockSeconds: 3600,
                outageBlockSeconds: 60,
            },
        },
    },
    fsvo: {
        id: 'fsvo',
        name: 'Swiss Food Composition Database',
        publisher: 'Federal Food Safety and Veterinary Office',
        edition: 'Recorded with its operator download (plan U24)',
        licence: 'opendata-swiss-terms-by',
        licenceUrl: 'https://opendata.swiss/en/terms-of-use',
        attribution:
            'Swiss Food Composition Database, Federal Food Safety and Veterinary Office, https://naehrwertdaten.ch/.',
        attributionLanguage: 'en',
        homepage: 'https://naehrwertdaten.ch/',
        basis: 'per100g',
        energyMethod: 'euRegulation1169',
        // A file source until one read of the API's own description succeeds: on 2026-10-01 both hosts served a
        // default certificate and answered 404, so its search and its terms are unknown (U26).
        access: { kind: 'file' },
    },
    cnf: {
        id: 'cnf',
        name: 'Canadian Nutrient File',
        publisher: 'Health Canada',
        edition: '2015',
        licence: 'OGL-Canada-2.0',
        licenceUrl: 'https://open.canada.ca/en/open-government-licence-canada',
        attribution:
            'Contains information licensed under the Open Government Licence – Canada: Canadian Nutrient File, Health Canada, 2015.',
        attributionLanguage: 'en',
        homepage: 'https://www.canada.ca/en/health-canada/services/food-nutrition/healthy-eating/nutrient-data.html',
        basis: 'per100g',
        energyMethod: 'canadaCnf',
        // A file source: the API states no edition and its open-data record answered 404 on 2026-10-01, so no live
        // record licenses its data (U26). The 2026 edition's files are OGL-Canada, but open.canada.ca refuses scripted
        // downloads, so moving to them waits for an operator download.
        access: { kind: 'file' },
    },
} as const satisfies Record<RegisteredSourceId, SourceDeclaration>;

type Declarations = typeof DECLARATIONS;

/** A source reached through an API, read from its declaration. */
type ApiSourceId = {
    [Id in RegisteredSourceId]: Declarations[Id]['access'] extends { readonly kind: 'api' } ? Id : never;
}[RegisteredSourceId];

/** A source an owner ruling holds, read from its declaration. */
type HeldSourceId = {
    [Id in RegisteredSourceId]: Declarations[Id] extends { readonly ruling: { readonly held: true } } ? Id : never;
}[RegisteredSourceId];

/** An API source no ruling holds: the only sources the rate-limited transport may call (ADR-0052 §8, ADR-0053). */
export type CallableApiSourceId = Exclude<ApiSourceId, HeldSourceId>;

/** A callable source that cannot search by name, so it is searched through its local mirror (R57, R60). */
export type MirrorSourceId = {
    [Id in CallableApiSourceId]: Declarations[Id]['access'] extends { readonly remoteSearch: false } ? Id : never;
}[CallableApiSourceId];

/**
 * Freeze a value and every object inside it.
 *
 * @param value - The object to freeze.
 * @returns The same object, frozen.
 * @sideEffect Freezes its argument and every object inside it.
 */
function freezeDeep<T extends object>(value: T): T {
    for (const child of Object.values(value)) {
        if (typeof child === 'object' && child !== null) {
            freezeDeep(child);
        }
    }

    return Object.freeze(value);
}

/**
 * Parse every declaration and freeze the register, so a bad declaration fails the process at load, before any use.
 *
 * @param declarations - One declaration per registered id.
 * @returns The same declarations, parsed and frozen, with their own types.
 * @throws {z.ZodError} naming the first refused declaration.
 */
function loadRegister<Loaded extends Record<RegisteredSourceId, SourceDeclaration>>(declarations: Loaded): Loaded {
    for (const id of REGISTERED_SOURCE_IDS) {
        parseSourceDeclaration(declarations[id]);
    }

    return freezeDeep(declarations);
}

/** The parsed, frozen declarations with their literal types, for the typed reads below. */
const REGISTER = loadRegister(DECLARATIONS);

/** Every admitted source. */
export const SOURCE_REGISTER: Readonly<Record<RegisteredSourceId, SourceDeclaration>> = REGISTER;

/**
 * How a callable source is reached. Typed by the declarations, so no caller narrows on `kind` and no held or file
 * source can be asked for. Pure.
 *
 * @param id - A callable API source.
 * @returns Its declared access, the register's own frozen object.
 */
export function apiAccessOf(id: CallableApiSourceId): ApiAccess {
    return REGISTER[id].access;
}

/**
 * Whether a source is an API source no ruling holds. Pure. The two source lists are pinned by tests against
 * {@link CallableApiSourceId} and {@link MirrorSourceId}, so this predicate and those types cannot disagree unseen.
 *
 * @param id - A registered source.
 * @returns True for a callable API source.
 */
function isCallableApiSource(id: RegisteredSourceId): id is CallableApiSourceId {
    const declaration: SourceDeclaration = SOURCE_REGISTER[id];

    return declaration.access.kind === 'api' && declaration.ruling?.held !== true;
}

/**
 * Whether a callable source is searched through its mirror. Pure.
 *
 * @param id - A callable API source.
 * @returns True when the source cannot search by name.
 */
function isMirrorSource(id: CallableApiSourceId): id is MirrorSourceId {
    return !apiAccessOf(id).remoteSearch;
}

/** Every callable API source, in register order. */
export const CALLABLE_API_SOURCES: readonly CallableApiSourceId[] = REGISTERED_SOURCE_IDS.filter(isCallableApiSource);

/** Every mirror source, in register order. */
export const MIRROR_SOURCES: readonly MirrorSourceId[] = CALLABLE_API_SOURCES.filter(isMirrorSource);

/**
 * Whether a text names a callable API source, for example a key read from configuration. Pure.
 *
 * @param value - The text.
 * @returns True for a callable source id, exactly as registered.
 */
export function isCallableApiSourceId(value: string): value is CallableApiSourceId {
    return CALLABLE_API_SOURCES.some((id) => id === value);
}
