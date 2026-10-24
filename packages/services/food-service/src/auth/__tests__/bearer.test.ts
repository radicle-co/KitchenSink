/**
 * Unit tests for {@link extractBearer} — the food service's one authoritative
 * `Authorization: Bearer <token>` parse, and the first thing every authenticated request runs through.
 *
 * It had no direct test before this file: both guards that depend on it were covered, so the parse was
 * only ever exercised through a happy-path `Bearer <token>` header and none of its rejection arms were
 * pinned. The two that matter most are the ones a caller cannot see:
 *
 *  1. **A whitespace-only credential is `undefined`, not `''`.** Every caller currently treats the empty
 *     string as absent, so the old pattern's `''` was masked rather than harmless — a future caller that
 *     checks `!== undefined` would have accepted "no credential" as a credential.
 *  2. **The parse is LINEAR in the header's length.** This is the assertion the ReDoS fix exists for, and
 *     it is pinned twice over: once behaviourally (case 1 above is impossible under the vulnerable
 *     pattern, so it fails on any revert with no reliance on the clock) and once on complexity.
 */
import { describe, expect, it } from 'vitest';

import { extractBearer } from '../bearer.js';

const TOKEN = 'eyJhbGciOiJSUzI1NiJ9.payload.signature';

describe('extractBearer — the credential every authenticated request is read from', () => {
    it('extracts the token from a well-formed header', () => {
        expect(extractBearer(`Bearer ${TOKEN}`)).toBe(TOKEN);
    });

    it('is case-insensitive on the scheme and tolerates surrounding whitespace', () => {
        expect(extractBearer(`bearer   ${TOKEN}  `)).toBe(TOKEN);
        expect(extractBearer(`BEARER\t${TOKEN}`)).toBe(TOKEN);
    });

    it.each([
        ['absent', undefined],
        ['empty', ''],
        ['whitespace only', '   '],
        ['the scheme alone', 'Bearer'],
        // The behavioural discriminator for the ReDoS fix: the vulnerable `(.+)` pattern MATCHES this and
        // trims the captured spaces down to `''`, so this case fails the moment the pattern regresses.
        ['the scheme with no credential', 'Bearer    '],
        ['a different scheme', `Basic ${TOKEN}`],
        // `Bearer` must be the whole scheme, not a prefix of one.
        ['a scheme merely starting with Bearer', `Bearertoken ${TOKEN}`],
    ])('returns undefined for %s', (_label, header) => {
        expect(extractBearer(header)).toBeUndefined();
    });

    /**
     * The complexity guard. The vulnerable `(.+)` form is quadratic here because `.` and the preceding
     * `\s+` both match a space, so a header the pattern must REJECT forces a retry of every split of the
     * whitespace run — measured at 1.67s for 100KB and 6.76s for 200KB, versus 0.1ms for the current
     * pattern at both sizes.
     *
     * The oracle is vitest's own timeout rather than a stopwatch assertion, and the margin it leaves is
     * ~67,000x (0.1ms against a 5s budget), so this cannot fail for a scheduling or load reason the way a
     * millisecond-scale timing assertion would — only for an algorithmic one. The rejection is forced with
     * a line terminator, which `\s` accepts and `.` does not.
     */
    it('parses a 200KB adversarial header in linear time rather than quadratic', () => {
        const adversarial = `Bearer ${' '.repeat(200_000)}\n`;

        expect(extractBearer(adversarial)).toBeUndefined();
    }, 5_000);
});
