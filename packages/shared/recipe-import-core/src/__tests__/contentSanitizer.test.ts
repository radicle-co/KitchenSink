/**
 * MOD-021 ContentSanitizer (HAZ-029).
 *
 * | Requirement | Test |
 * | ----------- | ---- |
 * | HAZ-029 — no extracted text field may carry markup into the draft | "strips" cases |
 * | MOD-021 — sanitize, then entity-decode to PLAIN TEXT                | "decodes" cases |
 *
 * ⛔ The ordering cases are the security-bearing ones. `sanitize-html` RE-ESCAPES its own output, so the
 * obvious `decode(sanitize(x))` reconstitutes markup that was double-encoded on the way in. Measured
 * 2026-08-19: `decode(sanitize('&amp;lt;script&amp;gt;…'))` === `'&lt;script&gt;…'` — one decode away from
 * live markup. These tests fail on that ordering.
 */
import { describe, it, expect } from 'vitest';

import { sanitizeToPlainText } from '../contentSanitizer.js';

describe('sanitizeToPlainText', () => {
    describe('strips markup', () => {
        it.each([
            ['<p>One cup of flour</p>', 'One cup of flour'],
            ['<b>Salt</b> and <i>pepper</i>', 'Salt and pepper'],
            ['<script>alert(1)</script>Salt', 'Salt'],
            ['<img src=x onerror=alert(1)>Flour', 'Flour'],
            ['<a href="javascript:alert(1)">click</a>', 'click'],
            ['plain text', 'plain text'],
            ['', ''],
        ])('turns %j into %j', (input, expected) => {
            expect(sanitizeToPlainText(input)).toBe(expected);
        });
    });

    describe('decodes entities to plain text', () => {
        it.each([
            ['Salt &amp; pepper', 'Salt & pepper'],
            ['Caf&eacute; au lait', 'Café au lait'],
            ['&#189; cup', '½ cup'],
            ['<p>One &amp; a <b>half</b> cups</p>', 'One & a half cups'],
            ['5 &lt; 6', '5 < 6'],
        ])('turns %j into %j', (input, expected) => {
            expect(sanitizeToPlainText(input)).toBe(expected);
        });
    });

    describe('⛔ decode/sanitize ORDERING — the control against resurrecting markup', () => {
        it('does not reconstitute a DOUBLE-encoded script tag', () => {
            const doubleEncoded = '&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;';
            const output = sanitizeToPlainText(doubleEncoded);

            expect(output).not.toContain('<script');
            expect(output).not.toContain('&lt;script');
            expect(output).toBe('');
        });

        it('does not reconstitute a TRIPLE-encoded script tag', () => {
            const tripleEncoded = '&amp;amp;lt;script&amp;amp;gt;alert(1)&amp;amp;lt;/script&amp;amp;gt;';
            expect(sanitizeToPlainText(tripleEncoded)).not.toMatch(/<[a-zA-Z]/);
        });

        it.each([
            ['&lt;img src=x onerror=alert(1)&gt;'],
            ['&amp;lt;img src=x onerror=alert(1)&amp;gt;'],
            ['&#60;script&#62;alert(1)&#60;/script&#62;'],
            ['&lt;svg onload=alert(1)&gt;'],
        ])('leaves no markup opener in the output for %j', (input) => {
            expect(sanitizeToPlainText(input)).not.toMatch(/<[a-zA-Z]/);
        });

        it('still preserves a legitimate less-than that is NOT a tag', () => {
            expect(sanitizeToPlainText('heat to &lt; 200 degrees')).toBe('heat to < 200 degrees');
        });
    });

    describe('totality', () => {
        it.each([[''], ['   '], ['<'], ['&'], ['&amp'], ['<<<<'], ['</>'], ['&#x0;']])(
            'never throws on %j',
            (input) => {
                expect(() => sanitizeToPlainText(input)).not.toThrow();
            },
        );

        it('is idempotent — sanitizing an already-sanitized field changes nothing further', () => {
            const once = sanitizeToPlainText('<p>Salt &amp; pepper</p>');
            expect(sanitizeToPlainText(once)).toBe(once);
        });
    });
});
