/**
 * Repo-wide guard: an environment value survives the generated compose file intact.
 *
 * ⛔ WHY THIS EXISTS. The compose writer emitted `KEY: 'value'` on one line. A single-quoted YAML scalar that
 * spans lines FOLDS its newlines into spaces, so a multi-line value arrived in the container mangled — and
 * silently, because the variable was present and looked plausible.
 *
 * Measured: `CLERK_JWT_KEY` is a 9-line PEM in SSM and reached the container as ONE line with spaces where
 * the newlines belonged. Every service then rejected every real Clerk token with a bare 401, which reads
 * exactly like an authorization decision rather than a corrupted key.
 */
import { describe, expect, it } from 'vitest';

import { composeValue } from '../composeValue.js';

describe('composeValue', () => {
    it('keeps newlines in a multi-line value', () => {
        const pem = '-----BEGIN PUBLIC KEY-----\nMIIBIjANBg\n-----END PUBLIC KEY-----';

        // A JSON string is a valid YAML double-quoted scalar, and YAML reads `\n` in one as a newline.
        expect(composeValue(pem)).toBe('"-----BEGIN PUBLIC KEY-----\\nMIIBIjANBg\\n-----END PUBLIC KEY-----"');
    });

    it('round-trips through a YAML parser back to the original', async () => {
        const { parse } = await import('yaml');
        const pem = '-----BEGIN PUBLIC KEY-----\nabc\ndef\n-----END PUBLIC KEY-----';

        expect((parse(`v: ${composeValue(pem)}`) as { v: string }).v).toBe(pem);
    });

    it('quotes a value containing a quote without breaking the document', async () => {
        const { parse } = await import('yaml');
        const value = `it's "quoted"`;

        expect((parse(`v: ${composeValue(value)}`) as { v: string }).v).toBe(value);
    });

    it('keeps a plain value readable', () => {
        expect(composeValue('postgres')).toBe('"postgres"');
    });

    it('does not turn a numeric-looking value into a number', async () => {
        const { parse } = await import('yaml');

        expect((parse(`v: ${composeValue('3000')}`) as { v: unknown }).v).toBe('3000');
    });
});
