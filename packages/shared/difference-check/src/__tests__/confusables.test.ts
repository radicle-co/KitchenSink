/**
 * The vendored Unicode `confusables.txt` and the module generated from it (KTD-2). The runtime imports only the
 * generated module, because `tsc` does not copy the `.txt` into `dist` and the service image copies only `dist`.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CONFUSABLES_V1 } from '../confusables/confusablesV1.generated.js';
import { parseConfusables, renderConfusablesModule } from '../confusables/parseConfusables.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const TXT = readFileSync(join(HERE, '..', 'confusables', 'confusables.txt'), 'utf8');
const LICENSE = readFileSync(join(HERE, '..', 'confusables', 'unicodeLicense.txt'), 'utf8');

/** The vendored file, Unicode Security Mechanisms 16.0.0, from unicode.org/Public/security/16.0.0/confusables.txt. */
const PINNED_SHA256 = '95bd0aad6dced5ebc63436f459c06ab21a8d107cd842fb57f5c3a1e91bca8611';

describe('the vendored confusables.txt', () => {
    it('is the pinned file, byte for byte', () => {
        expect(
            createHash('sha256')
                .update(readFileSync(join(HERE, '..', 'confusables', 'confusables.txt')))
                .digest('hex'),
        ).toBe(PINNED_SHA256);
    });

    it('says it is version 16.0.0', () => {
        expect(TXT).toMatch(/^# Version: 16\.0\.0$/m);
    });

    it('sits beside the Unicode License it is vendored under', () => {
        expect(LICENSE).toMatch(/^UNICODE LICENSE V3/);
    });
});

describe('parseConfusables', () => {
    it('reads `source ; target ; type # comment` lines and skips comments and blanks', () => {
        const map = parseConfusables('# comment\n\n0430 ;\t0061 ;\tMA\t# ( a ) CYRILLIC A → LATIN A\t# \n');

        expect(map).toEqual({ а: 'a' });
    });

    it('reads a target of several code points', () => {
        expect(parseConfusables('006D ;\t0072 006E ;\tMA\t# ( m → rn )\t# \n')).toEqual({ m: 'rn' });
    });

    it('ignores a byte order mark at the start of the file', () => {
        expect(parseConfusables('\ufeff0430 ;\t0061 ;\tMA\t# \n')).toEqual({ а: 'a' });
    });

    it('answers a map with one entry for every data line of the vendored file', () => {
        const dataLines = TXT.split('\n').filter(
            (line) => line.trim() !== '' && !line.startsWith('#') && !line.startsWith('\ufeff#'),
        );

        expect(Object.keys(parseConfusables(TXT)).length).toBe(dataLines.length);
    });

    it('maps every source of the vendored file to its target, pair by pair', () => {
        const map = parseConfusables(TXT);

        for (const line of TXT.split('\n')) {
            const match = /^\ufeff?([0-9A-F ]+);\t([0-9A-F ]+);/.exec(line);

            if (match === null) {
                continue;
            }

            const source = String.fromCodePoint(
                ...(match[1] ?? '')
                    .trim()
                    .split(' ')
                    .map((hex) => Number.parseInt(hex, 16)),
            );
            const target = String.fromCodePoint(
                ...(match[2] ?? '')
                    .trim()
                    .split(' ')
                    .map((hex) => Number.parseInt(hex, 16)),
            );

            expect(map[source]).toBe(target);
        }
    });
});

describe('the generated module', () => {
    it('is exactly what the generator renders from the vendored file', () => {
        const committed = readFileSync(join(HERE, '..', 'confusables', 'confusablesV1.generated.ts'), 'utf8');

        expect(committed).toBe(renderConfusablesModule(parseConfusables(TXT)));
    });

    it('carries the map the parser reads', () => {
        expect(CONFUSABLES_V1).toEqual(parseConfusables(TXT));
    });

    it.each([
        ['а', 'a'],
        ['с', 'c'],
        ['0', 'o'],
        ['1', 'l'],
        ['m', 'rn'],
    ])('maps %j to %j, the pair that makes a skeleton fold before the number fold wrong', (from, to) => {
        expect(CONFUSABLES_V1[from]?.toLowerCase()).toBe(to);
    });
});
