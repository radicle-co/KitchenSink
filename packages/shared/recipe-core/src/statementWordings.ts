/**
 * The closed lists of wordings a cook can have been shown when they stated where a recipe came from, or confirmed Public
 * (the attestation record, migration 0088).
 *
 * DESIGN PATTERN: **Closed registry**. A wording key is a stable name for approved copy at one version: the record
 * stores the key and the locale the cook saw, never the text. The wire validates a request against these lists, so a new
 * wording is a change HERE plus `contract:generate`, and needs no migration (the database checks only the key's format).
 *
 * The two lists are separate because they answer different questions: a statement is the cook's explicit act on a choice
 * (`STATEMENT_WORDINGS_BY_CHOICE` keeps each wording under the choice it belongs to, so "I wrote this" cannot be recorded
 * against the cookbook wording); the confirmation is the passive line shown beside the Public choice.
 *
 * @pattern Registry — closed lists, validated at the wire
 */

/**
 * The wording of each statement choice, by the choice's name in the attestation record. The ONE authority: the flat
 * {@link STATEMENT_WORDINGS} is derived from it.
 */
export const STATEMENT_WORDINGS_BY_CHOICE = {
    authored: ['statementAuthored.v1'],
    publicWeb: ['statementPublicWeb.v1'],
    book: ['statementBook.v1'],
    fromPerson: ['statementFromPerson.v1'],
} as const;

/** Every statement wording, flat. */
export const STATEMENT_WORDINGS = Object.values(STATEMENT_WORDINGS_BY_CHOICE).flat();

/** One statement wording key. */
export type StatementWording = (typeof STATEMENT_WORDINGS)[number];

/** The passive confirmation shown beside the Public choice: what the cook saw when they chose to make a recipe public. */
export const PUBLIC_CONFIRM_WORDINGS = ['publicConfirm.v1'] as const;

/** One public-confirmation wording key. */
export type PublicConfirmWording = (typeof PUBLIC_CONFIRM_WORDINGS)[number];

/** The shortest locale tag the record stores (mirrors the database CHECK on `locale`). */
export const WORDING_LOCALE_MIN_LENGTH = 2;

/** The longest locale tag the record stores (BCP 47's own bound, mirrored by the database CHECK on `locale`). */
export const WORDING_LOCALE_MAX_LENGTH = 35;

/**
 * What an API writer (a seed, a test fixture, a script) sends as `publicConfirmation` when it makes a recipe public: the
 * current confirmation wording in English. One constant, so a writer never spells the wording itself and a new version is
 * one edit.
 */
export const PUBLIC_CONFIRMATION_FOR_API_WRITERS = {
    version: PUBLIC_CONFIRM_WORDINGS[0],
    locale: 'en',
} as const;
