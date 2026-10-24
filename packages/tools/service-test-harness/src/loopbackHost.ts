/**
 * @module loopbackHost — the one rule for "this address can only mean this machine", read by every harness door that
 * must refuse a remote target: the admin PostgreSQL server and the LOCAL e2e tier's AWS endpoint.
 */

/** Hosts that can only ever mean "this machine", as `URL.hostname` spells them. */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Whether a URL's host can only mean this machine.
 *
 * @param hostname - `URL.hostname`.
 * @returns `true` for a loopback spelling. Pure.
 */
export function isLoopbackHost(hostname: string): boolean {
    return LOOPBACK_HOSTS.has(hostname);
}
