/**
 * The native editor section's heading row (build spec §1.1, §7.1). At 320 dp with font scale 2.0 a heading and its
 * trailing action (Paste steps, Paste a list) are wider than the row: the row must wrap so the action drops under the
 * heading, and the heading may shrink only to its own line, so it breaks between words and never inside one.
 */
import { cleanup, screen } from '@testing-library/react';
import { Text } from 'react-native';
import { afterEach, describe, expect, it } from 'vitest';

import { EditorSection } from '../EditorSection.native.js';
import { nativeTokens } from '@commise/ui/native';
import { render, renderWithTamagui } from '@commise/ui/testing/tamagui';

afterEach(cleanup);

const renderSection = (): HTMLElement => {
    render(
        <EditorSection id="steps" title="Steps" action={<Text>Paste steps</Text>} current={false}>
            <Text>body</Text>
        </EditorSection>,
    );

    const row = screen.getByRole('heading', { name: 'Steps' }).parentElement;

    if (row === null) {
        throw new Error('the heading has no row');
    }

    return row;
};

describe('EditorSection (native): the heading row at large text', () => {
    it('⛔ wraps, so the trailing action moves under the heading instead of squeezing it mid-word', () => {
        expect(getComputedStyle(renderSection()).flexWrap).toBe('wrap');
    });

    it('keeps the heading before its action', () => {
        const row = renderSection();

        expect(row.firstElementChild?.textContent).toBe('Steps');
        expect(row.lastElementChild?.textContent).toBe('Paste steps');
    });
});

describe('EditorSection (native): the heading at the largest text size', () => {
    // ADR-0080 §8, designer ruling 2026-11-01: a section title stops at 1.5× its base size. The heading was a raw React
    // Native Text, which iOS scaled without a cap (about 48 pt, larger than the page title).
    it('⛔ draws the heading at 1.5× its base size at a system text scale of 3.1, not 3.1×', () => {
        renderWithTamagui(
            <EditorSection id="ingredients" title="Ingredients" current={false}>
                <Text>body</Text>
            </EditorSection>,
            'light',
            3.1,
        );

        const heading = getComputedStyle(screen.getByRole('heading', { name: 'Ingredients' }));

        expect(heading.fontSize).toBe(`${String(nativeTokens.type.sectionTitle.fontSize * 1.5)}px`);
        expect(heading.lineHeight).toBe(`${String(nativeTokens.type.sectionTitle.lineHeight * 1.5)}px`);
    });
});
