import { describe, expect, it } from 'vitest';

import { MAX_RECIPES_PER_PAGE } from '../pageCaps.js';
import { readPastedContent } from '../readPastedContent.js';
import { makePage, makeRecipeCard, makeRecipeNode } from '../__fixtures__/pageFixtures.js';

/**
 * Round 7: the page reader against hostile pages and against a schema that is not the whole of the card. Every case is a
 * verdict on a WHOLE page through `readPastedContent`, because a refusal that a stage returns and a caller drops is no
 * refusal.
 */

const INGREDIENTS = ['1 cup flour', '2 eggs', '1 tsp salt'];
const STEPS = ['Mix the flour and eggs.', 'Add the salt.', 'Bake until golden.'];
const NODE = makeRecipeNode({ recipeIngredient: INGREDIENTS, recipeInstructions: STEPS });

const items = (lines: readonly string[]): string => lines.map((line) => `<li>${line}</li>`).join('');

/** A page whose JSON-LD says `node` and whose card is written by hand from the two lists. */
function cardPage(
    node: Record<string, unknown>,
    shown: { readonly ingredients?: readonly string[]; readonly steps?: readonly string[]; readonly extra?: string },
): string {
    return makePage({
        jsonLd: [node],
        body: `<article><h1>Test</h1><ul>${items(shown.ingredients ?? INGREDIENTS)}</ul><ol>${items(shown.steps ?? STEPS)}</ol>${shown.extra ?? ''}</article>`,
    });
}

// The collapse's own work is counted in `collapseBracketGroups.test.ts`. Here, a line past the cap is refused for its
// length, which the reader checks before it collapses anything.
describe('a line the reader would collapse: bounded before it is read, linear when it is', () => {
    it.each([
        ['32,000 characters of nested brackets', `${'('.repeat(16_000)}salt${')'.repeat(16_000)}`],
        ['32,000 characters of nested brackets around words', `${'(a'.repeat(16_000)}${')'.repeat(16_000)} salt`],
        ['32,000 unclosed brackets', `${'['.repeat(32_000)} salt`],
    ])('refuses an ingredient line of %s as ingredientLineTooLong', (_name, line) => {
        const node = makeRecipeNode({ recipeIngredient: [line], recipeInstructions: STEPS });

        expect(readPastedContent(makePage({ jsonLd: [node], body: makeRecipeCard(node) }))).toMatchObject({
            kind: 'notExtractable',
            reason: 'ingredientLineTooLong',
        });
    });

    it('refuses a line past the cap even when cleaning would bring it under', () => {
        // 1,050 characters of doubled groups that collapse to 750: the cap is on the line as the page writes it.
        const line = '((ab)) '.repeat(150).trim();
        const node = makeRecipeNode({ recipeIngredient: [line], recipeInstructions: STEPS });

        expect(line.length).toBeGreaterThan(1_000);
        expect(readPastedContent(makePage({ jsonLd: [node], body: makeRecipeCard(node) }))).toMatchObject({
            kind: 'notExtractable',
            reason: 'ingredientLineTooLong',
        });
    });

    it('still reads a line at the length cap that nests 500 deep', () => {
        const line = `${'('.repeat(496)}salt${')'.repeat(496)}`;
        const node = makeRecipeNode({ recipeIngredient: [line], recipeInstructions: STEPS });

        expect(readPastedContent(makePage({ jsonLd: [node], body: makeRecipeCard(node) }))).toMatchObject({
            kind: 'extracted',
            recipe: { ingredientLines: ['(salt)'] },
        });
    });
});

describe('a value cut short inside the decode passes is never read half', () => {
    it('refuses a step written as entities that decode into more markup than the cap reads', () => {
        const step = `Boil the water. ${'&lt;b&gt;x&lt;/b&gt; '.repeat(12_000)} Then add the salt.`;
        const markup = step.replaceAll('&lt;', '<').replaceAll('&gt;', '>');
        const node = makeRecipeNode({ recipeIngredient: INGREDIENTS, recipeInstructions: [step] });
        const page = makePage({
            jsonLd: [node],
            body: `<article><ul>${items(INGREDIENTS)}</ul><ol><li>${markup}</li></ol></article>`,
        });

        expect(readPastedContent(page)).toMatchObject({ kind: 'notExtractable', reason: 'pageTooComplex' });
    });
});

describe('more recipes than the page cap is never read as the first of them', () => {
    const recipe = (index: number) => makeRecipeNode({ '@id': `r${String(index)}`, name: `Recipe ${String(index)}` });

    it('refuses a page with 65 JSON-LD recipes, the last of them different', () => {
        const same = Array.from({ length: MAX_RECIPES_PER_PAGE }, () => recipe(0));
        const page = makePage({ jsonLd: [{ '@graph': [...same, recipe(1)] }], body: makeRecipeCard(recipe(0)) });

        expect(readPastedContent(page)).toMatchObject({ kind: 'notExtractable', reason: 'pageTooComplex' });
    });

    it('refuses a page with 65 microdata recipes', () => {
        const one = (index: number) =>
            `<div itemscope itemtype="https://schema.org/Recipe"><h1 itemprop="name">R${String(index)}</h1><ul><li itemprop="recipeIngredient">1 egg</li></ul><ol><li itemprop="recipeInstructions">Boil it.</li></ol></div>`;
        const body = Array.from({ length: MAX_RECIPES_PER_PAGE + 1 }, (_, index) => one(index)).join('');

        expect(readPastedContent(makePage({ body }))).toMatchObject({
            kind: 'notExtractable',
            reason: 'pageTooComplex',
        });
    });
});

describe('G-CORR both ways: the card is the schema, no more and no less', () => {
    it('reads a page whose card is its schema', () => {
        expect(readPastedContent(cardPage(NODE, {}))).toMatchObject({ kind: 'extracted' });
    });

    it.each([
        ['one more ingredient than the schema', { ingredients: [...INGREDIENTS, '1 cup sugar'] }],
        ['one more ingredient, first', { ingredients: ['1 cup sugar', ...INGREDIENTS] }],
        ['one more step than the schema', { steps: [...STEPS, 'Serve warm.'] }],
        ['one more step, first', { steps: ['Heat the oven.', ...STEPS] }],
    ])('refuses a page whose visible card has %s', (_name, shown) => {
        expect(readPastedContent(cardPage(NODE, shown))).toMatchObject({
            kind: 'notExtractable',
            reason: 'pageDisagreesWithSchema',
        });
    });

    it('refuses a schema that is only the end of a longer visible ingredient line', () => {
        const node = makeRecipeNode({ recipeIngredient: ['flour', 'eggs', 'salt'], recipeInstructions: STEPS });

        expect(
            readPastedContent(cardPage(node, { ingredients: ['2 cups flour', '2 large eggs', '1 tsp salt'] })),
        ).toMatchObject({ kind: 'notExtractable', reason: 'pageDisagreesWithSchema' });
    });

    it('refuses a schema that is only the start of a longer visible ingredient line', () => {
        const node = makeRecipeNode({ recipeIngredient: ['1 cup flour'], recipeInstructions: STEPS });

        expect(readPastedContent(cardPage(node, { ingredients: ['1 cup flour, sifted twice'] }))).toMatchObject({
            kind: 'notExtractable',
            reason: 'pageDisagreesWithSchema',
        });
    });

    it('refuses steps that are only fragments of the visible method', () => {
        const node = makeRecipeNode({ recipeIngredient: INGREDIENTS, recipeInstructions: ['flour and', 'for 20'] });

        expect(
            readPastedContent(cardPage(node, { steps: ['Mix the flour and eggs well.', 'Bake for 20 minutes.'] })),
        ).toMatchObject({ kind: 'notExtractable', reason: 'pageDisagreesWithSchema' });
    });

    it('refuses a schema that leaves a step out of a method written in one paragraph', () => {
        const page = makePage({
            jsonLd: [makeRecipeNode({ recipeIngredient: INGREDIENTS, recipeInstructions: [STEPS[0], STEPS[2]] })],
            body: `<article><ul>${items(INGREDIENTS)}</ul><p>${STEPS.join(' ')}</p></article>`,
        });

        expect(readPastedContent(page)).toMatchObject({
            kind: 'notExtractable',
            reason: 'pageDisagreesWithSchema',
        });
    });

    it('reads steps written as sentences of one paragraph, and a heading above each list', () => {
        const page = makePage({
            jsonLd: [NODE],
            body: `<article><h2>Ingredients</h2><ul>${items(INGREDIENTS)}</ul><h2>Method</h2><p>${STEPS.join(' ')}</p></article>`,
        });

        expect(readPastedContent(page)).toMatchObject({ kind: 'extracted' });
    });

    it('reads ingredient groups, each under its own heading, as the one flat list the schema holds', () => {
        const page = makePage({
            jsonLd: [NODE],
            body: `<article><h3>Dough</h3><ul>${items(INGREDIENTS.slice(0, 2))}</ul><h3>Topping</h3><ul>${items(INGREDIENTS.slice(2))}</ul><ol>${items(STEPS)}</ol></article>`,
        });

        expect(readPastedContent(page)).toMatchObject({ kind: 'extracted' });
    });
});

describe('G-CORR per recipe card: every list in the card is the schema’s', () => {
    // The verification review's probes: a list the schema leaves out entirely, which the per-list check could not see
    // because no schema line sat in it. The card is the smallest element holding every line and step the schema has.
    it.each([
        [
            'an ingredient group the schema leaves out',
            '<h3>Frosting</h3><ul><li>1 cup icing sugar</li><li>2 tbsp milk</li></ul>',
        ],
        ['a second method list', '<ol><li>Let it cool for an hour.</li></ol>'],
    ])('refuses a card with %s after the method', (_name, extra) => {
        expect(readPastedContent(cardPage(NODE, { extra }))).toMatchObject({
            kind: 'notExtractable',
            reason: 'pageDisagreesWithSchema',
        });
    });

    // Round 8: a list before the first line the schema reads or after the last one is the card's furniture (its meta,
    // notes, nutrition, related recipes), not a part of the recipe the schema left out, unless it is numbered (a method)
    // or a line of it opens with an amount (an ingredient group). Rewritten: "a stray list" after the method
    // ("Serves four") was refused; it is the shape of every notes list, so it is read now.
    it.each([
        [
            'a notes list after the method',
            '<ul><li>Make ahead: chill it overnight.</li><li>Keeps for a week.</li></ul>',
        ],
        ['a stray list after the method', '<ul><li>Serves four</li></ul>'],
        ['a nutrition list after the method', '<ul><li>Calories: 250kcal</li><li>Protein: 8g</li></ul>'],
    ])('reads a card with %s in a container of its own', (_name, extra) => {
        expect(
            readPastedContent(cardPage(NODE, { extra: `<div class="notes"><div>${extra}</div></div>` })),
        ).toMatchObject({
            kind: 'extracted',
        });
    });

    // code-reviewer, round 8: a list beside a list the schema reads (the same parent, or the same group wrapper's parent)
    // is a sibling of a recipe list, never furniture, whatever it says: an amount written last ("砂糖 大さじ1") or a method
    // in a <ul> (as WP Recipe Maker writes one) reads no amount and is no <ol>.
    it.each([
        ['an unnumbered list right beside the method', '<ul><li>Let it cool for an hour.</li></ul>'],
        ['an ingredient group with its amounts last', '<ul><li>砂糖 大さじ1</li><li>Mehl, 200 g</li></ul>'],
    ])('refuses a card with %s', (_name, extra) => {
        expect(readPastedContent(cardPage(NODE, { extra }))).toMatchObject({
            kind: 'notExtractable',
            reason: 'pageDisagreesWithSchema',
        });
    });

    it('refuses an omitted method group in a group wrapper beside the read ones, as WP Recipe Maker writes groups', () => {
        const group = (lines: readonly string[]) => `<div class="instruction-group"><ul>${items(lines)}</ul></div>`;
        const page = makePage({
            jsonLd: [NODE],
            body: `<article><ul>${items(INGREDIENTS)}</ul><div class="instructions">${group(STEPS)}${group(['Glaze the cake while it is warm.'])}</div></article>`,
        });

        expect(readPastedContent(page)).toMatchObject({ kind: 'notExtractable', reason: 'pageDisagreesWithSchema' });
    });

    it('reads a card with a meta list before the ingredients, in a container of its own', () => {
        const page = makePage({
            jsonLd: [NODE],
            body: `<article><h1>Test</h1><div class="meta"><div><ul><li>Prep Time: 10 minutes</li><li>Yield: 4</li></ul></div></div><ul>${items(INGREDIENTS)}</ul><ol>${items(STEPS)}</ol></article>`,
        });

        expect(readPastedContent(page)).toMatchObject({ kind: 'extracted' });
    });

    // Rewritten for round 9 (re-review of cb509d1a4, MEDIUM 3): "Print" and "Jump to recipe" linked to #p and #r, which
    // name no element on the page, and read as furniture. A jump link counts only when its target holds the lines read
    // (the passing case is the test below with #ingredients and #instructions), so this card is refused now.
    it('refuses a card whose links before the lines jump to targets that hold no line it reads', () => {
        const page = makePage({
            jsonLd: [NODE],
            body: `<article><div class="jump"><div><ul><li><a href="#p">Print</a></li><li><a href="#r">Jump to recipe</a></li></ul></div></div><ul>${items(INGREDIENTS)}</ul><ol>${items(STEPS)}</ol></article>`,
        });

        expect(readPastedContent(page)).toMatchObject({ kind: 'notExtractable', reason: 'pageDisagreesWithSchema' });
    });

    // Rewritten for round 9 (code-reviewer HIGH 1 on #324): a list of links was furniture anywhere, so a linked sub-recipe
    // the schema left out read as yes. A links-only item now passes every other furniture check too: not between the read
    // lines, not beside a read list, not numbered, and no leading amount. Print and Rate between the lists is refused now.
    it.each([
        [
            'a links-only list between the lists, such as Print and Rate',
            `<ul>${items(INGREDIENTS)}</ul><ul><li><a href="#p">Print</a></li><li><a href="#r">Rate</a></li></ul><ol>${items(STEPS)}</ol>`,
        ],
        [
            'a links-only list of sub-recipes beside the read ingredient list',
            `<ul><li><a href="/dough">Pizza dough</a></li><li><a href="/sauce">Marinara sauce</a></li></ul><ul>${items(INGREDIENTS)}</ul><ol>${items(STEPS)}</ol>`,
        ],
        [
            'a linked ingredient group between the ingredients and the method',
            `<ul>${items(INGREDIENTS)}</ul><h3>Sauce</h3><ul><li><a href="/sauce">1 batch tomato sauce</a></li></ul><ol>${items(STEPS)}</ol>`,
        ],
        [
            'a numbered links-only list after the method',
            `<ul>${items(INGREDIENTS)}</ul><ol>${items(STEPS)}</ol><div class="x"><div><ol><li><a href="/glaze">Glaze it</a></li></ol></div></div>`,
        ],
        [
            'a links-only line that opens with an amount, before the lines',
            `<div class="x"><div><ul><li><a href="/stock">2 cups stock</a></li></ul></div></div><ul>${items(INGREDIENTS)}</ul><ol>${items(STEPS)}</ol>`,
        ],
    ])('refuses a card with %s', (_name, body) => {
        expect(readPastedContent(makePage({ jsonLd: [NODE], body: `<article>${body}</article>` }))).toMatchObject({
            kind: 'notExtractable',
            reason: 'pageDisagreesWithSchema',
        });
    });

    // Round 9 (code-reviewer HIGH 2 on #324): an amount written as words ("A pinch of", "Half a", "One") is no leading
    // amount, so an omitted group before the lines read as furniture. Before the lines, an unread item is furniture only
    // when it is a jump link (`href="#..."`) or a meta fact under a label on the closed list (`cardMetaLabels.ts`).
    // Re-review of d700c5ed1 (CRITICAL 1): the open "Label: value" rule read a group whose units the English unit list
    // does not know. Every label off the closed list is refused now. Re-review HIGH 2 and HIGH 3: a link to another page
    // is no jump link, so a linked group, or a line with one linked word, is refused too.
    it.each([
        ['an amount written as words', ['A pinch of saffron', 'Half a lemon', 'One onion']],
        ['no amount at all', ['Salt to taste', 'Fresh herbs']],
        ['a labelled line that names a measure', ['Flour: 200 g', 'Sugar: a pinch']],
        ['a label that is all a line says', ['Equipment', 'Air fryer']],
        ['a Russian labelled amount', ['Мука: 200 г']],
        ['Japanese labelled amounts', ['砂糖：大さじ1', '卵：2個']],
        ['Italian labelled amounts', ['Farina: 200 gr', 'Uova: 2']],
        ['an English labelled count', ['Eggs: 2']],
        ['a label off the list', ['Garnish: fresh parsley']],
        ['another label off the list', ['Optional: chopped chives']],
    ])('refuses an omitted group before the lines, nested deeper than the read lists, with %s', (_name, lines) => {
        const page = makePage({
            jsonLd: [NODE],
            body: `<article><div class="group"><div><ul>${items(lines)}</ul></div></div><ul>${items(INGREDIENTS)}</ul><ol>${items(STEPS)}</ol></article>`,
        });

        expect(readPastedContent(page)).toMatchObject({ kind: 'notExtractable', reason: 'pageDisagreesWithSchema' });
    });

    it.each([
        ['a linked line with its amount in words', '<li><a href="/x">One onion</a></li>'],
        ['a linked group', '<li><a href="/salt">Salt</a></li><li><a href="/pepper">Pepper</a></li>'],
        ['a line with one word linked to a page', '<li>A pinch of <a href="/saffron">saffron</a></li>'],
        ['a line with one word linked to a fragment', '<li>A pinch of <a href="#saffron">saffron</a></li>'],
    ])('refuses an omitted group before the lines, nested deeper than the read lists, with %s', (_name, lines) => {
        const page = makePage({
            jsonLd: [NODE],
            body: `<article><div class="group"><div><ul>${lines}</ul></div></div><ul>${items(INGREDIENTS)}</ul><ol>${items(STEPS)}</ol></article>`,
        });

        expect(readPastedContent(page)).toMatchObject({ kind: 'notExtractable', reason: 'pageDisagreesWithSchema' });
    });

    // Re-review of cb509d1a4, MEDIUM 3: a jump link is furniture only when it is a block's own link to the element that
    // holds the lines read. A line wrapped in a link to anywhere else, or a list opened inside a jump link, is refused.
    it.each([
        ['a line wrapped in a fragment link', '<ul><li><a href="#x">One onion</a></li></ul>'],
        ['a line whose words are two fragment links', '<ul><li><a href="#a">One</a> <a href="#b">onion</a></li></ul>'],
        ['a list opened inside a jump link', '<a href="#recipe"><ul><li>One onion</li><li>Salt to taste</li></ul></a>'],
        [
            'a list opened inside a jump link, with a jump link of its own',
            '<a href="#recipe"><ul><li>One onion <a href="#recipe">here</a></li></ul></a>',
        ],
    ])('refuses an omitted group before the lines, nested deeper than the read lists, with %s', (_name, group) => {
        const page = makePage({
            jsonLd: [NODE],
            body: `<article id="recipe"><div class="group"><div>${group}</div></div><ul>${items(INGREDIENTS)}</ul><ol>${items(STEPS)}</ol></article>`,
        });

        expect(readPastedContent(page)).toMatchObject({ kind: 'notExtractable', reason: 'pageDisagreesWithSchema' });
    });

    // Rewritten: the links said "Jump to ingredients" and "Jump to instructions", which no page of the tuning corpus
    // shows. A jump link's text must be on the closed list (`jumpPhrases.ts`), so the links say "Ingredients" and "Method".
    it('reads a card with jump links before the lines to the elements that hold them', () => {
        const page = makePage({
            jsonLd: [NODE],
            body: `<article><div class="jump"><div><ul><li><a href="#ingredients">Ingredients</a></li><li><a href="#instructions">Method</a></li></ul></div></div><div id="ingredients"><ul>${items(INGREDIENTS)}</ul></div><div id="instructions"><ol>${items(STEPS)}</ol></div></article>`,
        });

        expect(readPastedContent(page)).toMatchObject({ kind: 'extracted' });
    });

    // A jump link is furniture only when its text is on the closed list of jump phrases (`jumpPhrases.ts`), every target
    // holds a read line, and no target holds the item itself. The read lines sit in `#ing`; `#page` wraps the whole card.
    // Each structural case uses a phrase on the list, so only its own rule refuses it.
    describe('a jump link before the lines', () => {
        const jumpPage = (item: string, wrapperId?: string): string => {
            const card = `<article><div class="jump"><div><ul>${item}</ul></div></div><div id="ing"><ul>${items(INGREDIENTS)}</ul></div><ol>${items(STEPS)}</ol></article>`;

            return makePage({
                jsonLd: [NODE],
                body: wrapperId === undefined ? card : `<div id="${wrapperId}">${card}</div>`,
            });
        };

        const refused = { kind: 'notExtractable', reason: 'pageDisagreesWithSchema' };

        it.each([['Jump to recipe'], ['Ingredients'], ['  JUMP TO RECIPE ']])(
            'reads one to the read list that says %j',
            (text) => {
                expect(readPastedContent(jumpPage(`<li><a href="#ing">${text}</a></li>`))).toMatchObject({
                    kind: 'extracted',
                });
            },
        );

        it.each([
            ['an omitted ingredient', '<li><a href="#ing">One onion</a></li>'],
            ['a plural ingredient', '<li><a href="#ing">Onions</a></li>'],
            ['an amount in words', '<li><a href="#ing">Half a lemon</a></li>'],
            ['two ingredients, two links', '<li><a href="#ing">Onions</a>, <a href="#ing">garlic</a></li>'],
            ['an ingredient the schema names in another form', '<li><a href="#ing">Egg</a></li>'],
            ['an ingredient the schema names', '<li><a href="#ing">Salt</a></li>'],
            ['a phrase on the list with more words', '<li><a href="#ing">Jump to recipe now</a></li>'],
        ])('refuses a jump link whose text is not a jump phrase: %s', (_name, item) => {
            expect(readPastedContent(jumpPage(item))).toMatchObject(refused);
        });

        it('refuses an omitted ingredient linked to one step', () => {
            const page = makePage({
                jsonLd: [NODE],
                body: `<article><div class="jump"><div><ul><li><a href="#s2">One onion</a></li></ul></div></div><ul>${items(INGREDIENTS)}</ul><ol><li>${STEPS[0] ?? ''}</li><li id="s2">${STEPS[1] ?? ''}</li><li>${STEPS[2] ?? ''}</li></ol></article>`,
            });

            expect(readPastedContent(page)).toMatchObject(refused);
        });

        it.each([
            ['a link to an element around the whole card', '<li><a href="#page">Jump to recipe</a></li>', 'page'],
            ['a link with a block inside it', '<li><a href="#ing"><div></div>Ingredients</a></li>', undefined],
            [
                'one link to the read list and one to no read line',
                '<li><a href="#ing">Jump to</a> <a href="#notes">recipe</a></li>',
                undefined,
            ],
            ['a phrase only part of which is a link', '<li>Jump to <a href="#ing">recipe</a></li>', undefined],
            [
                'a list inside a jump link, its item holding a jump link of its own',
                '<a href="#ing"><li>Jump to <a href="#ing">recipe</a></li></a>',
                undefined,
            ],
        ])('refuses %s', (_name, item, wrapperId) => {
            expect(readPastedContent(jumpPage(item, wrapperId))).toMatchObject(refused);
        });

        it('refuses a link to an element that holds no read line', () => {
            const page = makePage({
                jsonLd: [NODE],
                body: `<article><div class="jump"><div><ul><li><a href="#notes">Ingredients</a></li></ul></div></div><ul>${items(INGREDIENTS)}</ul><ol>${items(STEPS)}</ol><div id="notes"><p>Serve warm.</p></div></article>`,
            });

            expect(readPastedContent(page)).toMatchObject(refused);
        });

        it('refuses a link to an element that holds read lines and the link itself', () => {
            const page = makePage({
                jsonLd: [NODE],
                body: `<article><div id="ing"><div class="jump"><div><ul><li><a href="#ing">Ingredients</a></li></ul></div></div><ul>${items(INGREDIENTS)}</ul></div><ol>${items(STEPS)}</ol></article>`,
            });

            expect(readPastedContent(page)).toMatchObject(refused);
        });

        // A browser follows the FIRST element with an id. Here that is the link's own container, not the read list.
        it.each([
            [
                'the jump list itself',
                `<article><div class="jump" id="ing"><div><ul><li><a href="#ing">Ingredients</a></li></ul></div></div><div id="ing"><ul>${items(INGREDIENTS)}</ul></div><ol>${items(STEPS)}</ol></article>`,
            ],
            [
                'the link item itself',
                `<article><div class="jump"><div><ul><li id="ing"><a href="#ing">Ingredients</a></li></ul></div></div><div id="ing"><ul>${items(INGREDIENTS)}</ul></div><ol>${items(STEPS)}</ol></article>`,
            ],
        ])('refuses a link whose id is first given to %s', (_name, body) => {
            expect(readPastedContent(makePage({ jsonLd: [NODE], body }))).toMatchObject(refused);
        });

        // Round-6, Medium 1: a browser follows the first element with the id, whatever it is: an inline one, or one the
        // cook cannot see. The read list further down is then not where the link goes, so the item refuses.
        const withFirstCarrier = (carrier: string, jump = '<li><a href="#ing">Ingredients</a></li>'): string =>
            makePage({
                jsonLd: [NODE],
                body: `<article><div class="jump"><div><ul>${jump}</ul></div></div>${carrier}<div id="ing"><ul>${items(INGREDIENTS)}</ul></div><ol>${items(STEPS)}</ol></article>`,
            });

        it.each([
            ['an inline element', '<span id="ing">x</span>'],
            ['a hidden element', '<div hidden id="ing">x</div>'],
            ['an element a style hides', '<div style="display:none" id="ing">x</div>'],
            ['an element inside a hidden one', '<div hidden><p id="ing">x</p></div>'],
            ['an element in a closed details', '<details><summary>More</summary><p id="ing">x</p></details>'],
            ['a template itself', '<template id="ing"><p>x</p></template>'],
        ])('refuses a link whose id is first given to %s', (_name, carrier) => {
            expect(readPastedContent(withFirstCarrier(carrier))).toMatchObject(refused);
        });

        // Round-7 ruling: ids compare EXACTLY, as a browser compares them (HTML Standard 7.4.6.4, "find a potential
        // indicated element": "an ID equal to fragment"). An id padded by white space is another id, so it does not
        // claim `#ing`, and the read list below it is where the link goes.
        it('reads a link past an element whose id is only padded by white space: exact compare', () => {
            expect(readPastedContent(withFirstCarrier('<span id=" ing ">x</span>'))).toMatchObject({
                kind: 'extracted',
            });
        });

        // The read list is the one with the padded id, so `#ing` names nothing a browser would find.
        it.each([
            ['an id padded by spaces', '<div id=" ing ">', '#ing'],
            ['an id with a no-break space (not stripped)', '<div id="ing\u00a0">', '#ing'],
            ['an id in another case', '<div id="ING">', '#ing'],
            ['an empty id and an empty target', '<div id="">', '#'],
            ['a no-break space before the #, which is no fragment link', '<div id="ing">', '\u00a0#ing'],
        ])('refuses a link when the read list has %s', (_name, listOpen, href) => {
            const page = makePage({
                jsonLd: [NODE],
                body: `<article><div class="jump"><div><ul><li><a href="${href}">Ingredients</a></li></ul></div></div>${listOpen}<ul>${items(INGREDIENTS)}</ul></div><ol>${items(STEPS)}</ol></article>`,
            });

            expect(readPastedContent(page)).toMatchObject(refused);
        });

        // URL standard: the parser strips leading and trailing C0 controls and spaces, then tabs and newlines anywhere.
        it.each([
            ['a tab inside', '#in\tg'],
            ['a newline inside', '#in\ng'],
            ['a carriage return inside', '#i\rng'],
            ['spaces and a C0 control around it', '\u0001 #ing \u001f'],
        ])('reads a jump link whose href has %s, as a browser strips it', (_name, href) => {
            const page = withFirstCarrier('', `<li><a href="${href}">Ingredients</a></li>`);

            expect(readPastedContent(page)).toMatchObject({ kind: 'extracted' });
        });

        // HTML Standard 7.4.6.4: the fragment is percent-decoded when no element matches it as written, so `#ing%20x`
        // may reach an element the id never spells. A fragment with a % is refused, whatever the ids say.
        it('refuses a link whose target holds a percent sign, even when an id spells it', () => {
            const page = makePage({
                jsonLd: [NODE],
                body: `<article><div class="jump"><div><ul><li><a href="#ing%20x">Ingredients</a></li></ul></div></div><div id="ing%20x"><ul>${items(INGREDIENTS)}</ul></div><ol>${items(STEPS)}</ol></article>`,
            });

            expect(readPastedContent(page)).toMatchObject(refused);
        });

        // One id on two elements anywhere in the document, the head, `<html>` and `<body>` included, and a browser may
        // follow either. The body walk sees only the shown body, so the page counts every element once.
        describe('an id that occurs twice in the document', () => {
            const page = (edit: (html: string) => string, head = ''): string =>
                edit(
                    makePage({
                        jsonLd: [NODE],
                        head,
                        body: `<article><div class="jump"><div><ul><li><a href="#ing">Ingredients</a></li></ul></div></div><div id="ing"><ul>${items(INGREDIENTS)}</ul></div><ol>${items(STEPS)}</ol></article>`,
                    }),
                );

            it('reads the page when the id occurs once', () => {
                expect(readPastedContent(page((html) => html))).toMatchObject({ kind: 'extracted' });
            });

            it.each([
                ['a meta in the head', (html: string) => html, '<meta id="ing" name="x" content="y">'],
                ['the body element', (html: string) => html.replace('<body>', '<body id="ing">'), ''],
                ['the html element', (html: string) => html.replace('<html>', '<html id="ing">'), ''],
                ['a flow element inside the head', (html: string) => html, '<div id="ing"></div>'],
                [
                    'a hidden element after the list',
                    (html: string) => html.replace('</article>', '<div hidden id="ing"></div></article>'),
                    '',
                ],
            ])('refuses it when %s carries the id too', (_name, edit, head) => {
                expect(readPastedContent(page(edit, head))).toMatchObject(refused);
            });
        });

        // A browser may read the link against another document (`<base>`), or find the read list inside a shadow root.
        // The reader models neither, so a page with one is refused whole.
        describe('a page the reader cannot model as a browser builds it', () => {
            const card = `<article><div class="jump"><div><ul><li><a href="#ing">Ingredients</a></li></ul></div></div><div id="ing"><ul>${items(INGREDIENTS)}</ul></div><ol>${items(STEPS)}</ol></article>`;

            it.each([
                ['a base element', '<base href="https://other.example/">', card],
                [
                    'a declarative shadow root beside the card',
                    '',
                    `${card}<div><template shadowrootmode="open"><p>x</p></template></div>`,
                ],
                [
                    'a legacy declarative shadow root beside the card',
                    '',
                    `${card}<div><template shadowroot="open"><p>x</p></template></div>`,
                ],
                [
                    'a declarative shadow root around the card',
                    '',
                    `<div><template shadowrootmode="open">${card}</template></div>`,
                ],
            ])('refuses a page with %s', (_name, head, body) => {
                expect(readPastedContent(makePage({ jsonLd: [NODE], head, body }))).toMatchObject(refused);
            });
        });

        // HTML Standard 13.2.6.1 ("the appropriate place for inserting a node", foster parenting): content a table
        // cannot hold is moved out in front of the table, so the table is not where a browser keeps these lines.
        describe('a read list a browser would not keep where the markup puts it', () => {
            const jump = '<div class="jump"><div><ul><li><a href="#ing">Ingredients</a></li></ul></div></div>';
            const withList = (list: string): string =>
                makePage({ jsonLd: [NODE], body: `<article>${jump}${list}<ol>${items(STEPS)}</ol></article>` });

            it.each([
                ['items straight in a table', `<table id="ing">${items(INGREDIENTS)}</table>`],
                ['items in a row but no cell', `<table id="ing"><tr>${items(INGREDIENTS)}</tr></table>`],
                ['items in a table body', `<table><tbody id="ing">${items(INGREDIENTS)}</tbody></table>`],
                ['items in a table head', `<table><thead id="ing">${items(INGREDIENTS)}</thead></table>`],
                ['items in a table foot', `<table><tfoot id="ing">${items(INGREDIENTS)}</tfoot></table>`],
                ['a list in a paragraph', `<p id="ing"><ul>${items(INGREDIENTS)}</ul></p>`],
            ])('refuses a link to %s', (_name, list) => {
                expect(readPastedContent(withList(list))).toMatchObject(refused);
            });

            it('reads a link to a list inside a table cell', () => {
                const list = `<table id="ing"><tbody><tr><td><ul>${items(INGREDIENTS)}</ul></td></tr></tbody></table>`;

                expect(readPastedContent(withList(list))).toMatchObject({ kind: 'extracted' });
            });
        });

        // A browser closes the open link when another opens (adoption agency), so the inner link is no part of the first.
        // htmlparser2 closes an open link itself when another opens directly in it, as a browser does. Through an inline
        // element it does not, and the browser's adoption agency still does: the two trees then differ, so it refuses.
        it.each([
            ['a link', '<li><a href="#ing">Jump <b><a href="#ing">to</a></b> recipe</a></li>'],
            ['an anchor with no href', '<li><a href="#ing">Jump <b><a name="x">to</a></b> recipe</a></li>'],
        ])('refuses a jump link with %s opened inside it', (_name, item) => {
            expect(readPastedContent(withFirstCarrier('', item))).toMatchObject(refused);
        }); // An element inside a template is not in the page, and a link's trailing space is not part of its target.
        it.each([
            [
                'an id inside a template',
                '<template><p id="ing">x</p></template>',
                '<li><a href="#ing">Ingredients</a></li>',
            ],
            ['a target with a trailing space', '', '<li><a href="#ing ">Ingredients</a></li>'],
        ])('still reads a jump link with %s', (_name, carrier, jump) => {
            expect(readPastedContent(withFirstCarrier(carrier, jump))).toMatchObject({ kind: 'extracted' });
        });
    });

    // An omitted group after the read lines that opens with amounts is refused, in a container of its own too.
    it('refuses an omitted group after the read lines whose lines open with amounts', () => {
        const page = makePage({
            jsonLd: [NODE],
            body: `<article><ul>${items(INGREDIENTS)}</ul><ol>${items(STEPS)}</ol><section><div><ul><li>3 tbsp butter</li><li>1 tsp salt</li></ul></div></section></article>`,
        });

        expect(readPastedContent(page)).toMatchObject({ kind: 'notExtractable', reason: 'pageDisagreesWithSchema' });
    });

    // A line shown beside the read lines, in the same container, is refused when they are paragraphs.
    it('refuses an unread paragraph beside the read ingredient paragraphs', () => {
        const page = makePage({
            jsonLd: [makeRecipeNode({ recipeIngredient: ['1 cup flour', '2 eggs'], recipeInstructions: STEPS })],
            body: `<article><div><p>1 cup flour</p><p>2 eggs</p><p>3 tbsp butter</p></div><ol>${items(STEPS)}</ol></article>`,
        });

        expect(readPastedContent(page)).toMatchObject({ kind: 'notExtractable', reason: 'pageDisagreesWithSchema' });
    });

    // Re-review of cb509d1a4, LOW 5: a listed label is meta only when its value has that label's shape. A time needs a
    // duration, a count a number with at most a count word, and a text label refuses a leading amount or a measure word.
    it.each([
        ['a text label holding an amount and a unit', ['Category: Flour 200 g']],
        ['a count label holding an ingredient', ['Calories: 2 eggs']],
        ['a Russian count label holding an ingredient', ['Выход: 2 яйца']],
        ['a count label holding a count word and an ingredient', ['Yield: 6 slices bacon']],
        ['a count label holding two ingredients', ['Servings: 2 slices bread, 1 egg']],
        ['a count label holding two counts', ['Yield: 6 slices 2 pieces']],
        ['a count label with a count word and no number', ['Yield: slices']],
        ['a count label holding a word off the list', ['Calories: 350 kcal']],
        ['a Russian count label holding a word the corpus does not show', ['Выход: 4 порции']],
        ['a text label holding a leading amount', ['Keywords: 2 eggs, 1 onion']],
        ['a time label holding an ingredient', ['Prep Time: 2 eggs']],
        ['a time label holding a duration and an ingredient', ['Prep Time: 10 minutes, 2 eggs']],
        ['a time label holding a bare number', ['Cook Time: 2']],
        ['a time label holding a unit and no number', ['Prep Time: minutes']],
    ])('refuses an omitted group before the lines, nested deeper than the read lists, with %s', (_name, lines) => {
        const page = makePage({
            jsonLd: [NODE],
            body: `<article><div class="group"><div><ul>${items(lines)}</ul></div></div><ul>${items(INGREDIENTS)}</ul><ol>${items(STEPS)}</ol></article>`,
        });

        expect(readPastedContent(page)).toMatchObject({ kind: 'notExtractable', reason: 'pageDisagreesWithSchema' });
    });

    it.each([
        ['English', ['Prep Time: 10 minutes', 'Category: Dessert', 'Diet: Gluten-Free, Vegetarian']],
        ['English time and count', ['Total Time: 1 hour and 10 minutes', 'Servings: 4-6 people', 'Calories: 350']],
        ['yield in slices', ['Yield: 6 slices']],
        ['Italian count', ['Dosi per: 4 persone']],
        ['Italian', ['Tempo totale: 3h e 20 min', 'Calorie: 778']],
        ['Russian', ['Сложность: сложно']],
        ['Russian time and count', ['Время приготовления: 1 час 30 минут', 'Выход: 4 шт']],
        ['Japanese, with a full-width colon', ['調理時間：30分']],
        ['English, with spaces around the label', ['Prep  Time : 10 minutes', '  Servings :4']],
    ])('reads a card with a %s meta list of labelled facts before the lines', (_name, lines) => {
        const page = makePage({
            jsonLd: [NODE],
            body: `<article><div class="meta"><div><ul>${items(lines)}</ul></div></div><ul>${items(INGREDIENTS)}</ul><ol>${items(STEPS)}</ol></article>`,
        });

        expect(readPastedContent(page)).toMatchObject({ kind: 'extracted' });
    });

    // ⚠️ ACCEPTED RISK, pinned (staff-architect, round 8): an omitted ingredient group after the method with no line that
    // opens with an amount reads as furniture. Telling it from a notes list needs a signal no structure gives.
    it('reads, as furniture, an omitted group after the method, in a container of its own, whose lines state no amount', () => {
        const extra = '<div class="extra"><div><ul><li>Salt to taste</li><li>Fresh herbs</li></ul></div></div>';

        expect(readPastedContent(cardPage(NODE, { extra }))).toMatchObject({ kind: 'extracted' });
    });

    // ⚠️ ACCEPTED RISK, pinned (re-review of d700c5ed1, item 6): after the method, an omitted group whose amounts are
    // written as words reads as furniture too. After the lines, a notes list and such a group have the same structure,
    // so refusing it would refuse every notes list.
    it('reads, as furniture, an omitted group after the method whose amounts are written as words', () => {
        const extra = '<div class="extra"><div><ul><li>A pinch of saffron</li><li>One onion</li></ul></div></div>';

        expect(readPastedContent(cardPage(NODE, { extra }))).toMatchObject({ kind: 'extracted' });
    });

    // code-reviewer, round 8. PINNED REFUSAL: when every section of a card is wrapped once, a notes list in its own one
    // wrapper shares a grandparent (the card) with the read lists, so it counts as beside them and the card is refused.
    it('refuses a card whose notes list is wrapped once, like its read sections', () => {
        const page = makePage({
            jsonLd: [NODE],
            body: `<article><div class="ingredients"><ul>${items(INGREDIENTS)}</ul></div><div class="method"><ol>${items(STEPS)}</ol></div><div class="notes"><ul><li>Keeps for a week.</li></ul></div></article>`,
        });

        expect(readPastedContent(page)).toMatchObject({ kind: 'notExtractable', reason: 'pageDisagreesWithSchema' });
    });

    // ⚠️ ACCEPTED RISK, pinned (code-reviewer, round 8): the beside test compares lists at the same depth only. An omitted
    // group after the method, one level deeper than the read lists (wrapped with its heading), unnumbered and with no
    // leading amount, reads as furniture.
    it('reads, as furniture, an omitted group after the method nested one level deeper than the read lists', () => {
        const page = makePage({
            jsonLd: [NODE],
            body: `<article><ul>${items(INGREDIENTS)}</ul><div class="method"><ol>${items(STEPS)}</ol><div class="group"><h4>Glaze</h4><ul><li>Brush with milk.</li></ul></div></div></article>`,
        });

        expect(readPastedContent(page)).toMatchObject({ kind: 'extracted' });
    });

    it('refuses a list before the ingredients whose line opens with an amount', () => {
        const page = makePage({
            jsonLd: [NODE],
            body: `<article><ul><li>2 cups stock</li></ul><ul>${items(INGREDIENTS)}</ul><ol>${items(STEPS)}</ol></article>`,
        });

        expect(readPastedContent(page)).toMatchObject({ kind: 'notExtractable', reason: 'pageDisagreesWithSchema' });
    });

    it('refuses an ingredient group the schema leaves out, between the ingredients and the method', () => {
        const page = makePage({
            jsonLd: [NODE],
            body: `<article><ul>${items(INGREDIENTS)}</ul><h3>Frosting</h3><ul><li>1 cup icing sugar</li></ul><ol>${items(STEPS)}</ol></article>`,
        });

        expect(readPastedContent(page)).toMatchObject({ kind: 'notExtractable', reason: 'pageDisagreesWithSchema' });
    });

    it('refuses a list the schema leaves out in a microdata card', () => {
        const page = makePage({
            body: [
                '<div itemscope itemtype="https://schema.org/Recipe"><h1 itemprop="name">Test</h1><ul>',
                INGREDIENTS.map((line) => `<li itemprop="recipeIngredient">${line}</li>`).join(''),
                '</ul><ul><li>1 cup icing sugar</li></ul><ol>',
                STEPS.map((step) => `<li itemprop="recipeInstructions">${step}</li>`).join(''),
                '</ol></div>',
            ].join(''),
        });

        expect(readPastedContent(page)).toMatchObject({ kind: 'notExtractable', reason: 'pageDisagreesWithSchema' });
    });

    it('reads a card with a note in a paragraph, and the page’s own lists outside the card', () => {
        const page = makePage({
            jsonLd: [NODE],
            body: `<nav><ul><li>Home</li><li>Recipes</li></ul></nav><article><h1>Test</h1><ul>${items(INGREDIENTS)}</ul><ol>${items(STEPS)}</ol><p>Keeps for a week.</p></article><footer><ul><li>About</li></ul></footer>`,
        });

        expect(readPastedContent(page)).toMatchObject({ kind: 'extracted' });
    });

    // The limits `schemaCorroboration.ts` names: lines the per-card rule does not see. Each is pinned so that a change to
    // the rule changes a test, not only a comment.
    it.each([
        ['a table row', '<table><tr><td>Calories</td><td>250</td></tr></table>'],
        ['a paragraph', '<p>Serve with rice.</p>'],
        ['a line after a <br>', '<p>Serves 4<br>Keeps a week</p>'],
    ])('does not see %s in the card that the schema leaves out', (_name, extra) => {
        expect(readPastedContent(cardPage(NODE, { extra }))).toMatchObject({ kind: 'extracted' });
    });

    it('does not see an ingredient group rendered after the card element', () => {
        const page = makePage({
            jsonLd: [NODE],
            body: `<article><h1>Test</h1><ul>${items(INGREDIENTS)}</ul><ol>${items(STEPS)}</ol></article><aside><ul><li>1 cup icing sugar</li></ul></aside>`,
        });

        expect(readPastedContent(page)).toMatchObject({ kind: 'extracted' });
    });
});

/**
 * A recipe card shaped like a common WordPress recipe plugin's: a container, an equipment list, ingredient groups whose
 * lines are spans of amount, unit and name, an instructions list, a nutrition list, and jump links, all inside the card.
 * Written by hand for this test: no page's HTML is copied.
 */
function pluginStyleCard(lists: {
    readonly equipment: boolean;
    readonly nutrition: boolean;
    readonly jumps: boolean;
}): string {
    const ingredient = (amount: string, unit: string, name: string): string =>
        `<li class="recipe-ingredient"><span class="amount">${amount}</span> <span class="unit">${unit}</span> <span class="name">${name}</span></li>`;
    const step = (text: string): string =>
        `<li class="recipe-instruction"><div class="instruction-text">${text}</div></li>`;

    return [
        '<div class="recipe-container"><div class="recipe-card">',
        '<h2 class="recipe-name">Test</h2>',
        lists.jumps
            ? '<ul class="recipe-jump-links"><li><a href="#ingredients">Ingredients</a></li><li><a href="#instructions">Instructions</a></li></ul>'
            : '',
        lists.equipment
            ? '<div class="recipe-equipment"><h3>Equipment</h3><ul><li class="equipment-item">Mixing bowl</li><li class="equipment-item">Baking tray</li></ul></div>'
            : '',
        '<div class="recipe-ingredients" id="ingredients"><h3>Ingredients</h3>',
        '<div class="ingredient-group"><h4>Dough</h4><ul>',
        ingredient('1', 'cup', 'flour'),
        ingredient('2', '', 'eggs'),
        '</ul></div><div class="ingredient-group"><h4>Seasoning</h4><ul>',
        ingredient('1', 'tsp', 'salt'),
        '</ul></div></div>',
        `<div class="recipe-instructions" id="instructions"><h3>Instructions</h3><div class="instruction-group"><ul>${STEPS.map(step).join('')}</ul></div></div>`,
        lists.nutrition
            ? '<div class="recipe-nutrition"><h3>Nutrition</h3><ul><li>Calories: 250kcal</li><li>Protein: 8g</li></ul></div>'
            : '',
        '</div></div>',
    ].join('');
}

describe('G-CORR on a card shaped like a recipe plugin’s', () => {
    const page = (lists: Parameters<typeof pluginStyleCard>[0]): string =>
        makePage({
            jsonLd: [NODE],
            body: `<article><p>A story about the recipe.</p>${pluginStyleCard(lists)}</article>`,
        });

    it('reads the card when it holds only what the schema holds', () => {
        expect(readPastedContent(page({ equipment: false, nutrition: false, jumps: false }))).toMatchObject({
            kind: 'extracted',
            recipe: { ingredientLines: INGREDIENTS },
        });
    });

    // Round 8 ruling: jump links are links, and the nutrition list sits after the method, so neither is a part of the
    // recipe the schema left out.
    it.each([
        ['a nutrition list', { equipment: false, nutrition: true, jumps: false }],
        ['jump links', { equipment: false, nutrition: false, jumps: true }],
    ])('reads the card when it also holds %s', (_name, lists) => {
        expect(readPastedContent(page(lists))).toMatchObject({ kind: 'extracted' });
    });

    // Rewritten for round 9 (code-reviewer HIGH 2 on #324): an equipment list before the ingredients ("Mixing bowl") was
    // read as furniture. It is not a meta fact under a label on the closed list (`cardMetaLabels.ts`), and it cannot be told from an omitted group whose amounts are words
    // ("One onion"), so any doubt is no: the card is refused.
    it.each([
        ['an equipment list before the ingredients', { equipment: true, nutrition: false, jumps: false }],
        ['all three', { equipment: true, nutrition: true, jumps: true }],
    ])('refuses the card when it also holds %s', (_name, lists) => {
        expect(readPastedContent(page(lists))).toMatchObject({
            kind: 'notExtractable',
            reason: 'pageDisagreesWithSchema',
        });
    });

    // An equipment list between the ingredients and the method sits where an omitted ingredient group would, and is not
    // told apart from one by structure: any doubt is no.
    it('refuses the card when its equipment list sits between the ingredients and the method', () => {
        const card = pluginStyleCard({ equipment: false, nutrition: false, jumps: false }).replace(
            '<div class="recipe-instructions"',
            '<div class="recipe-equipment"><h3>Equipment</h3><ul><li>Mixing bowl</li></ul></div><div class="recipe-instructions"',
        );

        expect(card).toContain('Mixing bowl');
        expect(
            readPastedContent(
                makePage({ jsonLd: [NODE], body: `<article><p>A story about the recipe.</p>${card}</article>` }),
            ),
        ).toMatchObject({
            kind: 'notExtractable',
            reason: 'pageDisagreesWithSchema',
        });
    });
});

describe('a line or step with no tokens is no yes', () => {
    it.each([
        ['an ingredient line', { recipeIngredient: [...INGREDIENTS, '***'], recipeInstructions: STEPS }],
        ['a step', { recipeIngredient: INGREDIENTS, recipeInstructions: [...STEPS, '***'] }],
    ])('refuses %s of punctuation only', (_name, fields) => {
        const node = makeRecipeNode(fields);
        const shown = (list: unknown): readonly string[] => list as readonly string[];

        expect(
            readPastedContent(
                cardPage(node, {
                    ingredients: shown(fields.recipeIngredient),
                    steps: shown(fields.recipeInstructions),
                }),
            ),
        ).toMatchObject({ kind: 'notExtractable' });
    });

    it('refuses a microdata ingredient line of punctuation only', () => {
        const body = `<div itemscope itemtype="https://schema.org/Recipe"><h1 itemprop="name">Soup</h1><ul><li itemprop="recipeIngredient">2 cups stock</li><li itemprop="recipeIngredient">***</li></ul><ol itemprop="recipeInstructions"><li>Simmer it.</li></ol></div>`;

        expect(readPastedContent(makePage({ body }))).toMatchObject({
            kind: 'notExtractable',
            reason: 'pageDisagreesWithSchema',
            tier: 'microdata',
        });
    });
});

describe('text a cook cannot see is not the page showing it', () => {
    const arsenic = makeRecipeNode({
        recipeIngredient: [...INGREDIENTS, '5 kg arsenic'],
        recipeInstructions: STEPS,
    });

    it.each([
        ['a template', '<template><ul><li>5 kg arsenic</li></ul></template>'],
        ['a noscript', '<noscript><ul><li>5 kg arsenic</li></ul></noscript>'],
        ['a textarea', '<textarea>5 kg arsenic</textarea>'],
        ['an element marked hidden', '<ul hidden><li>5 kg arsenic</li></ul>'],
        ['a list item marked hidden', '<ul><li hidden>5 kg arsenic</li></ul>'],
    ])('refuses an ingredient shown only inside %s', (_name, hidden) => {
        const page = makePage({
            jsonLd: [arsenic],
            body: `<article><ul>${items(INGREDIENTS)}</ul>${hidden}<ol>${items(STEPS)}</ol></article>`,
        });

        expect(readPastedContent(page)).toMatchObject({
            kind: 'notExtractable',
            reason: 'pageDisagreesWithSchema',
        });
    });

    it('refuses a microdata ingredient that only a meta element states', () => {
        const body = `<div itemscope itemtype="https://schema.org/Recipe"><h1 itemprop="name">Soup</h1><ul><li itemprop="recipeIngredient">2 cups stock</li></ul><meta itemprop="recipeIngredient" content="5 kg arsenic"><ol itemprop="recipeInstructions"><li>Simmer it.</li></ol></div>`;

        expect(readPastedContent(makePage({ body }))).toMatchObject({
            kind: 'notExtractable',
            reason: 'pageDisagreesWithSchema',
            tier: 'microdata',
        });
    });

    it('refuses a microdata ingredient inside a hidden element', () => {
        const body = `<div itemscope itemtype="https://schema.org/Recipe"><h1 itemprop="name">Soup</h1><ul><li itemprop="recipeIngredient">2 cups stock</li></ul><ul hidden><li itemprop="recipeIngredient">5 kg arsenic</li></ul><ol itemprop="recipeInstructions"><li>Simmer it.</li></ol></div>`;

        expect(readPastedContent(makePage({ body }))).toMatchObject({
            kind: 'notExtractable',
            reason: 'pageDisagreesWithSchema',
        });
    });
});

describe('a JSON-LD block that does not parse is unread, not skipped', () => {
    it("does not let a second block's recipe win when the first block is broken", () => {
        const page = makePage({ jsonLd: ['{"@type": "Recipe", broken', NODE], body: makeRecipeCard(NODE) });

        expect(readPastedContent(page)).toMatchObject({ kind: 'notExtractable', reason: 'pageTooComplex' });
    });
});
