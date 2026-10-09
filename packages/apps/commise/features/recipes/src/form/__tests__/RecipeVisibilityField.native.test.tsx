/**
 * Native component tests for "Who can see it", `RecipeVisibilityField.native` (`docs/design/uiOverhaul/buildSpec.md`
 * §7.7 item 2), rendered through react-native-web under jsdom. Mirrors `RecipeVisibilityField.test.tsx`, plus both
 * colour schemes.
 *
 * Moved here from `recipeFieldGroups.native.test.tsx`, whose visibility block pinned the wizard-era switch.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { useState, type FC } from 'react';

import { role, roleDark } from '@commise/ui/colors';
import { rgb, systemScheme } from '@commise/ui/testing/system-color-scheme';

vi.mock('react-native', async (importOriginal) => {
    const { withSystemScheme } = await import('@commise/ui/testing/system-color-scheme');

    return withSystemScheme(await importOriginal<typeof import('react-native')>());
});

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { editorMessages } from '../../editor/messages.js';
import { RecipeVisibilityField } from '../RecipeVisibilityField.native.js';
import { recipeFormMessages } from '../messages.js';
import { defaultRecipeFormValues, type RecipeFormValues } from '../values.js';

const m = recipeFormMessages.en;
const v = editorMessages.en.visibility;

afterEach(() => {
    cleanup();
    systemScheme.current = null;
});

interface HarnessProps {
    readonly initial?: RecipeFormValues;
    readonly canGoPrivate: boolean;
    readonly onChange?: (next: RecipeFormValues) => void;
    readonly onPremiumRequired?: () => void;
}

const Harness: FC<HarnessProps> = ({ initial, canGoPrivate, onChange, onPremiumRequired }) => {
    const [values, setValues] = useState(initial ?? defaultRecipeFormValues());

    return (
        <RecipeVisibilityField
            values={values}
            canGoPrivate={canGoPrivate}
            {...(onPremiumRequired === undefined ? {} : { onPremiumRequired })}
            onChange={(next) => {
                setValues(next);
                onChange?.(next);
            }}
        />
    );
};

/**
 * A card by its title. Its accessible name is its whole text — title, hint and, when shown, the badge — which jsdom joins
 * with no space (it lays nothing out), so the names are matched as runs of words rather than as one sentence.
 */
const radio = (title: string): HTMLElement => screen.getByRole('radio', { name: new RegExp(`^${title}`, 'u') });

describe('RecipeVisibilityField (native)', () => {
    it('is a radio group named "Who can see it" of Public and Private, Public chosen by default', () => {
        render(<Harness canGoPrivate />);

        const group = screen.getByRole('radiogroup', { name: v.legend });

        expect(within(group).getAllByRole('radio')).toHaveLength(2);
        expect(radio(v.public).getAttribute('aria-checked')).toBe('true');
        expect(radio(v.private).getAttribute('aria-checked')).toBe('false');
        expect(screen.getByRole('radio', { name: new RegExp(`^${v.public}\\s*${v.publicHint}$`, 'u') })).toBeTruthy();
        expect(screen.getByRole('radio', { name: new RegExp(`^${v.private}\\s*${v.privateHint}$`, 'u') })).toBeTruthy();
    });

    it.each(['light', 'dark'] as const)('paints the chosen card in the selected fill in the %s scheme', (scheme) => {
        systemScheme.current = scheme;
        render(<Harness canGoPrivate />);
        const theme = scheme === 'dark' ? roleDark : role;

        expect(getComputedStyle(radio(v.public)).backgroundColor).toBe(rgb(theme.selectedFill));
        expect(getComputedStyle(radio(v.private)).backgroundColor).toBe(rgb(theme.paper));
        expect(getComputedStyle(radio(v.public)).minHeight).toBe('56px');
    });

    it('a cook who can go private chooses Private, and back', () => {
        const onChange = vi.fn();
        render(<Harness canGoPrivate onChange={onChange} />);

        fireEvent.click(radio(v.private));
        expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ visibility: 'private' }));
        expect(radio(v.private).getAttribute('aria-checked')).toBe('true');

        fireEvent.click(radio(v.public));
        expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ visibility: 'public' }));
        expect(screen.queryByText(m.premiumBadge)).toBeNull();
    });

    it('for a cook who cannot, Private shows Premium, asks for the upsell and leaves the value', () => {
        const onChange = vi.fn();
        const onPremiumRequired = vi.fn();
        render(<Harness canGoPrivate={false} onChange={onChange} onPremiumRequired={onPremiumRequired} />);

        expect(
            screen.getByRole('radio', {
                name: new RegExp(`^${v.private}\\s*${v.privateHint}\\s*${m.premiumBadge}$`, 'u'),
            }),
        ).toBeTruthy();

        fireEvent.click(radio(v.private));

        expect(onPremiumRequired).toHaveBeenCalledTimes(1);
        expect(onChange).not.toHaveBeenCalled();
        expect(radio(v.public).getAttribute('aria-checked')).toBe('true');
    });

    it('a recipe already private stays private, and can still go public', () => {
        const onChange = vi.fn();
        render(
            <Harness
                initial={{ ...defaultRecipeFormValues(), visibility: 'private' }}
                canGoPrivate={false}
                onChange={onChange}
            />,
        );

        expect(radio(v.private).getAttribute('aria-checked')).toBe('true');

        fireEvent.click(radio(v.public));

        expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ visibility: 'public' }));
    });
});
