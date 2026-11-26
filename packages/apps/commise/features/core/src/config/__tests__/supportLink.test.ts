/**
 * The "Ask us to change it" link (ADR-0100): the configured support address with the recipe's id as a `recipe` query
 * parameter. Unset or not an https address is no link at all, so a mistyped variable never ships a dead or unsafe link.
 */
import { describe, expect, it } from 'vitest';

import { supportLinkOf } from '../supportLink.js';

const ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

describe('supportLinkOf', () => {
    it('adds the recipe id to the address', () => {
        expect(supportLinkOf('https://commise.app/support', ID)).toBe(`https://commise.app/support?recipe=${ID}`);
    });

    it('keeps the query the address already has and replaces a recipe parameter it carries', () => {
        expect(supportLinkOf('https://commise.app/help?topic=source', ID)).toBe(
            `https://commise.app/help?topic=source&recipe=${ID}`,
        );
        expect(supportLinkOf('https://commise.app/help?recipe=old', ID)).toBe(`https://commise.app/help?recipe=${ID}`);
    });

    it.each([undefined, '', '   ', 'support', 'http://commise.app/support', 'javascript:alert(1)', 'ftp://x.test/a'])(
        'is no link for %j',
        (address) => {
            expect(supportLinkOf(address, ID)).toBeUndefined();
        },
    );

    it('encodes an id that is not a plain token, so it cannot add a parameter', () => {
        expect(supportLinkOf('https://commise.app/support', 'a&b=c')).toBe(
            'https://commise.app/support?recipe=a%26b%3Dc',
        );
    });
});
