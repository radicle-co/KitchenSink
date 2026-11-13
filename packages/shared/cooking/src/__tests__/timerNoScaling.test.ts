/**
 * Cook time does not scale with yield (FR-034a), so no part of the timer may be able to take a servings figure. The
 * rule is structural: neither module imports anything about scaling, so a scale factor has no way in. Ported from the
 * kept timer engine's guard.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe.each(['../timer.ts', '../duration.ts'])('%s has no way to take a servings figure', (path) => {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    const importLines = source.split('\n').filter((line) => /^\s*(import|export)\b.*\bfrom\b/u.test(line));

    it('imports nothing about scaling', () => {
        expect(importLines.length).toBeGreaterThan(0);
        expect(importLines.filter((line) => /scal|serving|yield/iu.test(line))).toEqual([]);
    });

    it('never reads the ambient clock', () => {
        expect(source).not.toMatch(/Date\s*\.\s*now\s*\(/u);
        expect(source).not.toMatch(/new\s+Date\s*\(/u);
        expect(source).not.toMatch(/performance\s*\.\s*now/u);
    });
});
