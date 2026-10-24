/**
 * Unit tests for the Project Gutenberg cookbook ADAPTER — plain text in, titled prose blocks out.
 *
 * Written against a COMMITTED fixture of verbatim excerpts from three public-domain cookbooks
 * (`fixtures/cookbookExcerpts.txt`), because the shapes that break a segmenter are the ones a real book
 * actually contains and a hand-written sample would not: a heading with no body under it, a heading whose
 * text ends in a period, an inline `*emphasis*` run that must NOT read as a heading, and a body whose
 * sentences are hard-wrapped mid-phrase.
 *
 * ⚠️ The adapter is deliberately DUMB. It adds no behaviour — no title casing, no ingredient extraction,
 * no skipping of bodiless headings. That is the Adapter contract, and it is what keeps "which blocks are
 * worth importing?" a decision made once, in the recipe mapper, where it can be reported on.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { segmentCookbook, stripGutenbergBoilerplate } from '../gutenbergBook.adapter.js';

const FIXTURE = readFileSync(join(import.meta.dirname, '../../fixtures/cookbookExcerpts.txt'), 'utf-8');

const blocks = segmentCookbook(FIXTURE);

/** Find the one block with this title, failing loudly rather than returning undefined into an assertion. */
function block(title: string): { title: string; paragraphs: readonly string[] } {
    const found = blocks.find((candidate) => candidate.title === title);

    if (!found) {
        throw new Error(`fixture has no block titled ${title}; got ${blocks.map((b) => b.title).join(' | ')}`);
    }

    return found;
}

describe('stripGutenbergBoilerplate', () => {
    it('drops everything outside the START/END markers', () => {
        const stripped = stripGutenbergBoilerplate(
            [
                'legal header',
                '*** START OF THE PROJECT GUTENBERG EBOOK X ***',
                'body',
                '*** END OF X ***',
                'licence',
            ].join('\n'),
        );

        expect(stripped.trim()).toBe('body');
    });

    it('returns the text unchanged when the markers are absent, rather than returning nothing', () => {
        // A silent empty return here would present as "this book has no recipes", which is the most
        // expensive possible failure: a zero-yield run that looks like a parser problem.
        expect(stripGutenbergBoilerplate('no markers here').trim()).toBe('no markers here');
    });
});

describe('segmentCookbook — heading detection', () => {
    it('treats an ALL-CAPS line as a recipe title', () => {
        expect(block('BEET SOUP--RUSSIAN STYLE (FLEISCHIG)').paragraphs.length).toBeGreaterThan(0);
    });

    it('accepts a title that ends in a period, and strips it (Gutenberg #12327 style)', () => {
        // `The Jewish Manual` prints `CURRIED VEAL.`; the trailing period is typography, not the name.
        expect(blocks.some((b) => b.title === 'CURRIED VEAL')).toBe(true);
        expect(blocks.some((b) => b.title === 'CURRIED VEAL.')).toBe(false);
    });

    it('keeps a heading that has NO body, as an EMPTY block rather than dropping it', () => {
        // `BARLEY AND VEGETABLE SOUP` appears in the fixture with nothing under it. The adapter must not
        // silently swallow it: a dropped block is invisible, whereas an empty one is counted and reported
        // as a skip with a reason.
        expect(block('BARLEY AND VEGETABLE SOUP').paragraphs).toHaveLength(0);
    });

    it('does NOT read an inline *emphasis* run as a heading', () => {
        // `*For Fleischig Soup.*--This soup may be made with fat…` is a note inside POTATO SOUP's body.
        expect(blocks.some((b) => b.title.includes('For Fleischig Soup'))).toBe(false);
        expect(block('POTATO SOUP').paragraphs.join(' ')).toContain('For Fleischig Soup');
    });

    it('does not emit a block for text appearing before the first heading', () => {
        expect(blocks[0]?.title).toBe('BEET SOUP--RUSSIAN STYLE (FLEISCHIG)');
    });
});

describe('segmentCookbook — body assembly', () => {
    it('joins a hard-wrapped paragraph into one line, so a phrase split across lines stays readable', () => {
        // The source wraps `one-half\ntablespoon of flour` mid-phrase. A quantity phrase broken by a
        // newline is invisible to every downstream scanner, so this un-wrapping is load-bearing rather
        // than cosmetic.
        const body = block('POTATO SOUP').paragraphs[0] ?? '';

        expect(body).toContain('one-half tablespoon of flour');
        expect(body).not.toContain('\n');
    });

    it('keeps a recipe’s separate paragraphs separate', () => {
        expect(block('BORSHT').paragraphs.length).toBeGreaterThan(1);
    });

    it('assigns each body paragraph to the heading ABOVE it, not the one below', () => {
        expect(block('POTATO SOUP').paragraphs.join(' ')).toContain('Boil and mash three or four potatoes');
        expect(block('BORSHT').paragraphs.join(' ')).not.toContain('Boil and mash three or four potatoes');
        expect(block('BORSHT').paragraphs.join(' ')).toContain('Take some red beetroots');
    });
});
