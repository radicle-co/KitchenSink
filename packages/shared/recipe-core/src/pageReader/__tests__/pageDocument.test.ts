import { describe, expect, it } from 'vitest';

import { MAX_VISIBLE_NODES, MAX_WALK_NODES } from '../pageCaps.js';
import { MAX_ELEMENT_DEPTH, PARSE_CHUNK_CHARS, isTextCut, parsePage, plainText, textBlocks } from '../pageDocument.js';

describe('textBlocks', () => {
    it('splits on block elements, line breaks and newlines', () => {
        expect(
            textBlocks('<p>Mix.</p><div>Bake.</div><ul><li>Cool.</li><li>Serve.</li></ul>Eat.<br>Enjoy.\nRest.'),
        ).toEqual(['Mix.', 'Bake.', 'Cool.', 'Serve.', 'Eat.', 'Enjoy.', 'Rest.']);
    });

    it('keeps inline markup inside one block and collapses whitespace', () => {
        expect(textBlocks('<p>Add  <b>two</b> cups   of <a href="/x">flour</a>.</p>')).toEqual([
            'Add two cups of flour.',
        ]);
    });

    it('decodes entities and drops blank blocks', () => {
        expect(textBlocks('<p>Salt &amp; pepper &frac12; tsp</p><p>  </p>\n\n<p>&nbsp;</p>')).toEqual([
            'Salt & pepper ½ tsp',
        ]);
    });

    it('never reads the content of a script or a style', () => {
        expect(textBlocks('Keep<script>var a = "x";</script><style>p{}</style> this')).toEqual(['Keep this']);
    });

    it.each([
        ['a template', '<template><p>no</p></template>'],
        ['a noscript', '<noscript>no</noscript>'],
        ['a textarea', '<textarea>no</textarea>'],
        ['an element marked hidden', '<p hidden>no</p>'],
        ['an inline element marked hidden', '<span hidden="">no</span>'],
        ['an element nested in a hidden one', '<div hidden><ul><li>no</li></ul></div>'],
    ])('never reads text a cook cannot see: %s', (_name, markup) => {
        expect(textBlocks(`Keep ${markup}`)).toEqual(['Keep']);
    });

    it('returns nothing for blank input', () => {
        expect(textBlocks('')).toEqual([]);
        expect(textBlocks('   \n  ')).toEqual([]);
    });
});

describe('isTextCut', () => {
    it('sees a cut made in the SECOND decode pass: entities that decode into more markup than a read holds', () => {
        const entities = '&lt;b&gt;x&lt;/b&gt; '.repeat(MAX_WALK_NODES);

        // No `<` at all, so the first pass reads one text node; the second reads 2 x MAX_WALK_NODES elements and cuts.
        expect(entities.includes('<')).toBe(false);
        expect(isTextCut(entities)).toBe(true);
        expect(isTextCut('&lt;b&gt;x&lt;/b&gt; fine')).toBe(false);
    });

    it('stays cut when a later pass is not: a cut in the first pass is never undone', () => {
        // Pass 1 reads the text, hits the node cap in the comments and stops; pass 2 reads the decoded text, whole.
        expect(isTextCut(`a &amp;amp; b${'<!---->'.repeat(MAX_WALK_NODES + 5)}`)).toBe(true);
    });

    it('is false for text, markup and entities within the budget', () => {
        expect(isTextCut('Bake 20 min.')).toBe(false);
        expect(isTextCut('a &amp; b')).toBe(false);
        expect(isTextCut('<p>Mix.</p><b>well</b>')).toBe(false);
    });

    it('is true when the markup runs past the node budget', () => {
        expect(isTextCut(`Mix.${'<!---->'.repeat(MAX_WALK_NODES + 5)}Bake.`)).toBe(true);
    });

    it('is true when the markup nests past the parse depth cap', () => {
        expect(isTextCut(`${'<div>'.repeat(MAX_ELEMENT_DEPTH + 5)}x`)).toBe(true);
    });
});

describe('plainText', () => {
    it('removes tags and decodes entities', () => {
        expect(plainText('1 cup <b>sugar</b> &amp; spice')).toBe('1 cup sugar & spice');
    });

    it('reads text that was encoded twice', () => {
        expect(plainText('Mac &amp;amp; Cheese')).toBe('Mac & Cheese');
        expect(plainText('&amp;frac12; cup milk')).toBe('½ cup milk');
        expect(plainText('1 cup &lt;b&gt;sugar&lt;/b&gt;')).toBe('1 cup sugar');
    });

    it('leaves a lone ampersand and a less-than sign in a quantity alone', () => {
        expect(plainText('Salt & pepper')).toBe('Salt & pepper');
        expect(plainText('Under 5 < 6 minutes')).toBe('Under 5 < 6 minutes');
    });

    it('joins the blocks of a multi-line value with one space', () => {
        expect(plainText('1 cup\nsugar<br>sifted')).toBe('1 cup sugar sifted');
    });

    it('returns an empty string for blank text', () => {
        expect(plainText('  \n ')).toBe('');
    });
});

describe('parsePage', () => {
    const page = parsePage(
        [
            '<html><head>',
            '<link rel="canonical" href="https://example.com/a">',
            '<script type="application/ld+json">{"a":"&amp;"}</script>',
            '</head><body><div itemscope itemtype="https://schema.org/Recipe">',
            '<span itemprop="name">Pie <i>deluxe</i></span>',
            '</div></body></html>',
        ].join(''),
    );

    it('finds elements by tag and by attribute, in document order', () => {
        expect(page.byTag('link').map((element) => element.attr('href'))).toEqual(['https://example.com/a']);
        expect(page.withAttribute('itemprop').map((element) => element.tag)).toEqual(['span']);
        expect(page.byTag('missing')).toEqual([]);
    });

    it('reads an attribute, and nothing for an absent one', () => {
        const [link] = page.byTag('link');

        expect(link?.attr('rel')).toBe('canonical');
        expect(link?.attr('nope')).toBeUndefined();
    });

    it('gives a script its raw text, with entities left alone', () => {
        expect(page.byTag('script')[0]?.rawText()).toBe('{"a":"&amp;"}');
    });

    it('gives an element its text blocks and its child elements', () => {
        const [root] = page.withAttribute('itemscope');

        expect(root?.children().map((child) => child.tag)).toEqual(['span']);
        expect(root?.blocks()).toEqual({ blocks: ['Pie deluxe'], truncated: false });
    });

    it('does not split an element on a newline inside its text', () => {
        const [paragraph] = parsePage('<p>one\ntwo</p>').byTag('p');

        expect(paragraph?.blocks()).toEqual({ blocks: ['one two'], truncated: false });
    });

    // ⛔ Work is COUNTED, never timed: the parser's cost grows with the square of the depth, so what bounds it is how many
    // elements it was fed before it stopped. One chunk past the cap holds at most a chunk's worth of `<div>`.
    it('stops at 400,000 nested elements one chunk past the depth cap, and says the page was cut short', () => {
        const depth = 400_000;
        const deep = parsePage(`<i>kept</i>${'<div>'.repeat(depth)}core${'</div>'.repeat(depth)}`);

        expect(deep.truncated).toBe(true);
        expect(deep.byTag('i')[0]?.blocks()).toEqual({ blocks: ['kept'], truncated: false });
        expect(deep.byTag('div').length).toBeLessThanOrEqual(MAX_ELEMENT_DEPTH + PARSE_CHUNK_CHARS / '<div>'.length);
    });

    it('reads a page nested to the cap in full', () => {
        const page = parsePage(`${'<div>'.repeat(MAX_ELEMENT_DEPTH)}core${'</div>'.repeat(MAX_ELEMENT_DEPTH)}`);

        expect(page.truncated).toBe(false);
        expect(page.byTag('div')).toHaveLength(MAX_ELEMENT_DEPTH);
    });

    it('reads at most the node budget of one element, so a huge value costs a bounded walk', () => {
        const [huge] = parsePage(`<div>${'<b>x</b>'.repeat(MAX_WALK_NODES * 3)}</div>`).byTag('div');
        const read = huge?.blocks();
        const text = read?.blocks.join(' ') ?? '';

        expect(read?.truncated).toBe(true);

        expect(text.length).toBeGreaterThan(MAX_WALK_NODES / 4);
        expect(text.length).toBeLessThanOrEqual(MAX_WALK_NODES / 2);
    });

    it('reads a whole body past the property budget, and says so when even the visible budget cuts it', () => {
        const paragraphs = MAX_WALK_NODES * 2;
        const [body] = parsePage(`<body>${'<p>x</p>'.repeat(paragraphs)}</body>`).byTag('body');
        const all = body?.visibleText();

        expect(all?.truncated).toBe(false);
        expect(all?.blocks).toHaveLength(paragraphs);

        const [wide] = parsePage(`<body>${'<b>x</b>'.repeat(MAX_VISIBLE_NODES)}</body>`).byTag('body');

        expect(wide?.visibleText().truncated).toBe(true);
        expect(wide?.blocks().blocks.join('').length).toBeLessThanOrEqual(MAX_WALK_NODES);
    });

    it('counts its nodes once, a lookup as free, and every node a read visits', () => {
        const page = parsePage('<div><p>one</p><p>two</p></div>');
        const indexed = page.work();

        // div, two p, two text nodes: the one indexing walk visits each once.
        expect(indexed).toEqual({ nodes: 5, visits: 5 });

        const [div] = page.byTag('div');

        expect(page.work().visits).toBe(5);
        expect(div?.blocks().blocks).toEqual(['one', 'two']);
        // The read inside the div: two p and two text nodes, and the end of each p.
        expect(page.work().visits).toBe(5 + 4 + 2);
    });

    it('reads 200,000 sibling elements: width is not depth, so nothing is cut', () => {
        const wide = parsePage(`<div>${'<i>a</i>'.repeat(200_000)}</div>`);

        expect(wide.truncated).toBe(false);
        expect(wide.byTag('i')).toHaveLength(200_000);
    });
});
