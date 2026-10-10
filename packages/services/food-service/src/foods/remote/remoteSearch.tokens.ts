/**
 * The injection tokens of food's remote search (ADR-0055). Each names an interface Nest cannot resolve by type.
 *
 * @module
 */

/** The remote search settings, read once at boot (`remoteSearchSettingsFromEnv`). */
export const REMOTE_SEARCH_SETTINGS = Symbol('RemoteSearchSettings');

/** The `RemoteSearchPort` every remote source is asked through. */
export const REMOTE_SEARCH_PORT = Symbol('RemoteSearchPort');

/** The sealer of the reference a remote hit carries. */
export const REMOTE_REFERENCE_SEALER = Symbol('RemoteReferenceSealer');
