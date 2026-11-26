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
 * The wording of each statement choice. A `v2` is the `v1` text plus the lock note ("Once you confirm, this answer is locked."),
 * shown where confirming that answer locks it (ADR-0100), so the recorded version says which text the cook saw. The paid-site
 * wording always carried the note, so it has one version.
 *
 * Keyed by the choice's name in the attestation record. The ONE authority: the flat
 * {@link STATEMENT_WORDINGS} is derived from it.
 */
export const STATEMENT_WORDINGS_BY_CHOICE = {
    authored: ['statementAuthored.v1'],
    publicWeb: ['statementPublicWeb.v1', 'statementPublicWeb.v2'],
    book: ['statementBook.v1', 'statementBook.v2'],
    fromPerson: ['statementFromPerson.v1', 'statementFromPerson.v2'],
    paidSite: ['statementPaidSite.v1'],
} as const;

/**
 * The wording that includes the lock note, for each choice that has two. A client that drew the note records THIS key and
 * otherwise the choice's first one, so the choice never rests on a position in the list. A paid website has one wording and no
 * entry here: its `v1` already carries the note, so nobody adds a `v2` thinking the note is missing.
 */
export const LOCK_NOTE_WORDING_BY_CHOICE = {
    publicWeb: 'statementPublicWeb.v2',
    book: 'statementBook.v2',
    fromPerson: 'statementFromPerson.v2',
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
 * What an API writer sends as `publicConfirmation` when it makes a recipe public and no one was shown anything: a seed or a
 * script that runs as a test principal. It is a MARKER and not a wording. It satisfies the duty to confirm and records NO row,
 * because a row says "the cook saw this line" and no one did. The service accepts it only from a test principal; a real cook who
 * sends it is refused with `INVALID_VISIBILITY` and the reason `API_WRITER_CONFIRMATION_FORBIDDEN`.
 *
 * Only a seed, a test or a load script may name this constant (a repo guard holds it). A screen sends the wording it showed.
 */
export const PUBLIC_CONFIRMATION_FOR_API_WRITERS = { apiWriter: true } as const;
