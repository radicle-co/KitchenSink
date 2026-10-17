import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CONTENT_DIR } from '../../config.js';
import { BOARDS_DIR } from '../boards.js';

/**
 * The system ships its own font files (`tokens.css` registers Inter and Playfair Display from them), so no authored
 * page may also fetch them from a font host: that is a second source for the same faces, and a network dependency
 * that made the board render flaky.
 */
const FONT_HOST = /fonts\.(?:googleapis|gstatic)\.com/u;

const authoredPages = (): readonly string[] => [
    ...readdirSync(BOARDS_DIR)
        .filter((name) => name.endsWith('.dc.html'))
        .map((name) => join(BOARDS_DIR, name)),
    join(CONTENT_DIR, 'designSystem/cover.html'),
];

describe('authored pages load fonts only from the system', () => {
    it('finds the boards and the cover, so an empty scan cannot pass', () => {
        expect(authoredPages().length).toBe(44);
    });

    it.each(authoredPages())('%s fetches no webfont', (page) => {
        expect(readFileSync(page, 'utf8')).not.toMatch(FONT_HOST);
    });
});
