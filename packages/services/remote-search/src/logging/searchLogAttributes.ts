/**
 * The fields of one search log line (`./searchLogger.ts` says what they may hold). Its own module, so the logger and
 * the error reporter each read it without reading each other.
 *
 * @module
 */

/** A log line's fields. */
export type SearchLogAttributes = Readonly<Record<string, string | number | readonly string[]>>;
