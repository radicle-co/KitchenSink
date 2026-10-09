/**
 * Native component tests for the Details leaf, `RecipeBasicsFields.native` (`docs/design/uiOverhaul/buildSpec.md` §7.4,
 * §7.12), rendered through react-native-web under jsdom. Mirrors `RecipeBasicsFields.test.tsx` across every state, plus
 * the native-only rules: both colour schemes from the theme, and the layout chosen by the container class of the
 * window's width.
 *
 * Moved here from `recipeFieldGroups.native.test.tsx`, whose basics blocks pinned the wizard-era layout.
 */
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { formatRgb } from 'culori';
import { useState, type FC } from 'react';

import { placeholderContrast } from '@commise/test-utils';
import { role, roleDark } from '@commise/ui/colors';
import { CUISINES, RecipeDifficulty } from '@kitchensink/recipe-core';

/** The system colour scheme and window width the next render sees. */
const device = vi.hoisted(() => ({ scheme: null as 'light' | 'dark' | null, width: 390 }));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        useColorScheme: () => device.scheme,
        useWindowDimensions: () => ({ ...actual.Dimensions.get('window'), width: device.width }),
    };
});

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { editorMessages } from '../../editor/messages.js';
import { RecipeBasicsFields } from '../RecipeBasicsFields.native.js';
import { DESCRIPTION_COUNTER_FROM, DESCRIPTION_MAX_LENGTH, TITLE_COUNTER_FROM, TITLE_MAX_LENGTH } from '../limits.js';
import { recipeFormMessages } from '../messages.js';
import type { RecipeFormErrors } from '../validate.js';
import { defaultRecipeFormValues, type RecipeFormValues } from '../values.js';

const m = recipeFormMessages.en;
const e = editorMessages.en;

afterEach(() => {
    cleanup();
    device.scheme = null;
    device.width = 390;
});

const filled = (over: Partial<RecipeFormValues> = {}): RecipeFormValues => ({
    ...defaultRecipeFormValues(),
    title: 'Herb risotto',
    description: 'Creamy and quick.',
    cuisine: 'Italian',
    tags: ['quick', 'dinner'],
    dietaryFlags: ['vegetarian'],
    servings: 4,
    prepTimeMinutes: 10,
    cookTimeMinutes: 25,
    ...over,
});

interface HarnessProps {
    readonly initial: RecipeFormValues;
    readonly errors?: RecipeFormErrors;
    readonly onChange?: (next: RecipeFormValues) => void;
}

const Harness: FC<HarnessProps> = ({ initial, errors, onChange }) => {
    const [values, setValues] = useState(initial);

    return (
        <RecipeBasicsFields
            values={values}
            {...(errors === undefined ? {} : { errors })}
            onChange={(next) => {
                setValues(next);
                onChange?.(next);
            }}
        />
    );
};

const renderLive = (props: Partial<Omit<HarnessProps, 'onChange'>> = {}) => {
    const onChange = vi.fn<(next: RecipeFormValues) => void>();
    render(<Harness initial={props.initial ?? filled()} {...props} onChange={onChange} />);

    return { onChange };
};

const lastValues = (onChange: Mock<(next: RecipeFormValues) => void>): RecipeFormValues => {
    const call = onChange.mock.calls.at(-1);

    if (call === undefined) {
        throw new Error('onChange was never called');
    }

    return call[0];
};

/**
 * The value react-native-web APPLIED for a CSS property, read from the element's atomic `r-*` classes' compiled rules,
 * then its inline style. `getComputedStyle` answers with the CSS initial value for an unset property — `flex-shrink` is
 * `1` by default in CSS and `0` in React Native — so it cannot tell a set style from an absent one. The house idiom
 * (`recipeFieldGroups.native.test.tsx`, `CollectionHeader.native.test.tsx`).
 */
function appliedStyle(element: Element, property: string): string | undefined {
    const classNames = element.className.split(' ').filter((name) => name.startsWith('r-'));
    let resolved: string | undefined;

    for (const className of classNames) {
        for (const sheet of [...document.styleSheets]) {
            for (const rule of [...sheet.cssRules]) {
                if (rule instanceof CSSStyleRule && rule.selectorText === `.${className}`) {
                    const value = rule.style.getPropertyValue(property);

                    if (value !== '') {
                        resolved = value;
                    }
                }
            }
        }
    }

    return (resolved ?? (element as HTMLElement).style.getPropertyValue(property)) || undefined;
}

const field = (name: string): HTMLInputElement | HTMLTextAreaElement =>
    screen.getByRole<HTMLInputElement | HTMLTextAreaElement>('textbox', { name });

describe('RecipeBasicsFields (native) — headings', () => {
    it('renders the four group headings as headers, and no section heading of its own', () => {
        renderLive();

        expect(screen.getAllByRole('heading').map((heading) => heading.textContent)).toEqual([
            m.groups.about,
            m.groups.timeAndServings,
            m.groups.kindOfDish,
            m.groups.dietAndTags,
        ]);
    });

    it.each(['light', 'dark'] as const)('paints a group heading muted in the %s scheme', (scheme) => {
        device.scheme = scheme;
        renderLive();

        expect(getComputedStyle(screen.getByRole('heading', { name: m.groups.about })).color).toBe(
            formatRgb((scheme === 'dark' ? roleDark : role).inkMuted),
        );
    });
});

describe('RecipeBasicsFields (native) — title', () => {
    it('is a multi-line field with no maxLength', () => {
        renderLive();

        expect(field(m.titleLabel).value).toBe('Herb risotto');
        expect(field(m.titleLabel).hasAttribute('maxlength')).toBe(false);
    });

    it('shows no counter below 100 characters', () => {
        renderLive({ initial: filled({ title: 'a'.repeat(TITLE_COUNTER_FROM - 1) }) });

        expect(screen.queryByText(`${String(TITLE_COUNTER_FROM - 1)}/${String(TITLE_MAX_LENGTH)}`)).toBeNull();
    });

    it('shows the counter from 100, muted, and the field stays valid', () => {
        renderLive({ initial: filled({ title: 'a'.repeat(TITLE_COUNTER_FROM) }) });

        const counter = screen.getByText(`${String(TITLE_COUNTER_FROM)}/${String(TITLE_MAX_LENGTH)}`);

        expect(getComputedStyle(counter).color).toBe(formatRgb(role.inkMuted));
        expect(field(m.titleLabel).getAttribute('aria-invalid')).not.toBe('true');
    });

    it.each(['light', 'dark'] as const)(
        'past 120 the counter turns danger in the %s scheme, the field is invalid and says why, live',
        (scheme) => {
            device.scheme = scheme;
            renderLive({ initial: filled({ title: 'a'.repeat(TITLE_MAX_LENGTH) }) });

            fireEvent.change(field(m.titleLabel), { target: { value: 'a'.repeat(TITLE_MAX_LENGTH + 1) } });

            const counter = screen.getByText(`${String(TITLE_MAX_LENGTH + 1)}/${String(TITLE_MAX_LENGTH)}`);
            const message = screen.getByText(e.details.titleLimit);

            expect(getComputedStyle(counter).color).toBe(formatRgb((scheme === 'dark' ? roleDark : role).dangerText));
            expect(field(m.titleLabel).getAttribute('aria-invalid')).toBe('true');
            expect(field(m.titleLabel).getAttribute('aria-describedby')?.split(' ')).toContain(message.id);
            expect(field(m.titleLabel).value).toHaveLength(TITLE_MAX_LENGTH + 1);
        },
    );

    it('keeps the title one line: a return or a pasted break becomes a space', () => {
        const { onChange } = renderLive();

        fireEvent.change(field(m.titleLabel), { target: { value: 'Herb\nrisotto' } });

        expect(lastValues(onChange).title).toBe('Herb risotto');
    });

    it.each(['light', 'dark'] as const)(
        'gives the title a placeholder that clears 4.5:1 in the %s scheme',
        (scheme) => {
            device.scheme = scheme;
            renderLive({ initial: filled({ title: '' }) });

            expect(placeholderContrast(field(m.titleLabel))).toBeGreaterThanOrEqual(4.5);
        },
    );

    it('a refused publish shows its title message, linked to the field', () => {
        renderLive({ initial: filled({ title: '' }), errors: { title: 'titleRequired' } });

        const message = screen.getByRole('alert');

        expect(message.textContent).toBe(m.errors.titleRequired);
        expect(field(m.titleLabel).getAttribute('aria-describedby')?.split(' ')).toContain(message.id);
    });

    it('a refused publish for a long title says the limit once', () => {
        renderLive({ initial: filled({ title: 'a'.repeat(TITLE_MAX_LENGTH + 5) }), errors: { title: 'titleTooLong' } });

        expect(screen.getAllByText(e.details.titleLimit)).toHaveLength(1);
    });
});

describe('RecipeBasicsFields (native) — description', () => {
    it('reports an edit', () => {
        const { onChange } = renderLive();

        fireEvent.change(field(m.descriptionLabel), { target: { value: 'Rich.' } });

        expect(lastValues(onChange).description).toBe('Rich.');
    });

    it('shows the counter from 80% of its cap, not before', () => {
        renderLive({ initial: filled({ description: 'a'.repeat(DESCRIPTION_COUNTER_FROM - 1) }) });
        expect(screen.queryByText(new RegExp(`/${String(DESCRIPTION_MAX_LENGTH)}$`, 'u'))).toBeNull();
        cleanup();

        renderLive({ initial: filled({ description: 'a'.repeat(DESCRIPTION_COUNTER_FROM) }) });
        expect(screen.getByText(`${String(DESCRIPTION_COUNTER_FROM)}/${String(DESCRIPTION_MAX_LENGTH)}`)).toBeTruthy();
    });

    it('past its cap the counter turns danger, the field is NOT marked invalid, and nothing is cut', () => {
        renderLive({ initial: filled({ description: 'a'.repeat(DESCRIPTION_MAX_LENGTH + 1) }) });

        expect(
            getComputedStyle(
                screen.getByText(`${String(DESCRIPTION_MAX_LENGTH + 1)}/${String(DESCRIPTION_MAX_LENGTH)}`),
            ).color,
        ).toBe(formatRgb(role.dangerText));
        expect(field(m.descriptionLabel).getAttribute('aria-invalid')).not.toBe('true');
        expect(field(m.descriptionLabel).value).toHaveLength(DESCRIPTION_MAX_LENGTH + 1);
    });
});

describe('RecipeBasicsFields (native) — servings, prep, cook and total', () => {
    const box = (name: string, unit: 'hours' | 'minutes'): HTMLInputElement =>
        screen.getByLabelText<HTMLInputElement>(
            (unit === 'hours' ? m.durationHoursLabel : m.durationMinutesLabel).replace('{field}', name),
        );

    it('steps the servings, and stops at 1', () => {
        const { onChange } = renderLive({ initial: filled({ servings: 2 }) });

        fireEvent.click(screen.getByRole('button', { name: m.servingsIncrease }));
        expect(lastValues(onChange).servings).toBe(3);

        fireEvent.click(screen.getByRole('button', { name: m.servingsDecrease }));
        fireEvent.click(screen.getByRole('button', { name: m.servingsDecrease }));
        fireEvent.click(screen.getByRole('button', { name: m.servingsDecrease }));
        expect(lastValues(onChange).servings).toBe(1);
    });

    it('shows prep and cook EMPTY, never "0", when no time is stated', () => {
        renderLive({ initial: filled({ prepTimeMinutes: 0, cookTimeMinutes: 0 }) });

        for (const name of [m.prepTimeLabel, m.cookTimeLabel]) {
            expect(box(name, 'hours').value).toBe('');
            expect(box(name, 'minutes').value).toBe('');
        }
    });

    it('stores an entered duration as minutes', () => {
        const { onChange } = renderLive({ initial: filled({ prepTimeMinutes: 0 }) });

        fireEvent.change(box(m.prepTimeLabel, 'hours'), { target: { value: '1' } });

        expect(lastValues(onChange).prepTimeMinutes).toBe(60);
    });

    it('hides the total while both are empty, and shows it formatted otherwise', () => {
        renderLive({ initial: filled({ prepTimeMinutes: 0, cookTimeMinutes: 0 }) });
        expect(screen.queryByText(/^Total/u)).toBeNull();
        cleanup();

        renderLive({ initial: filled({ prepTimeMinutes: 30, cookTimeMinutes: 300 }) });
        expect(screen.getByText('Total 5 h 30 min')).toBeTruthy();
    });

    it('a refused publish shows the servings and times messages', () => {
        renderLive({ errors: { servings: 'servingsPositive', times: 'timesNonNegative' } });

        expect(screen.getAllByRole('alert').map((alert) => alert.textContent)).toEqual([
            m.errors.servingsPositive,
            m.errors.timesNonNegative,
        ]);
    });
});

describe('RecipeBasicsFields (native) — cuisine, meal type and difficulty', () => {
    it('opens the cuisine list and reports a choice', () => {
        const { onChange } = renderLive();

        fireEvent.click(screen.getByRole('button', { name: m.cuisineLabel }));
        fireEvent.click(screen.getByRole('menuitem', { name: CUISINES[0] }));

        expect(lastValues(onChange).cuisine).toBe(CUISINES[0]);
    });

    it('shows the current cuisine on a collapsed trigger, and offers "No cuisine" then the curated list', () => {
        renderLive({ initial: filled({ cuisine: '' }) });

        expect(screen.queryByRole('menuitem', { name: CUISINES[0] })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: m.cuisineLabel }));

        expect(screen.getAllByRole('menuitem').map((item) => item.getAttribute('aria-label'))).toEqual([
            m.cuisineUnsetOption,
            ...CUISINES,
        ]);
    });

    it('keeps a custom cuisine visible and selected, and clears with "No cuisine"', () => {
        const { onChange } = renderLive({ initial: filled({ cuisine: 'Grandma’s Secret Blend' }) });

        expect(screen.getByText('Grandma’s Secret Blend')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: m.cuisineLabel }));
        expect(screen.getByRole('menuitem', { name: 'Grandma’s Secret Blend' }).getAttribute('aria-selected')).toBe(
            'true',
        );

        fireEvent.click(screen.getByRole('menuitem', { name: m.cuisineUnsetOption }));
        expect(lastValues(onChange).cuisine).toBe('');
    });

    it.each(['light', 'dark'] as const)('paints the cuisine trigger from the %s theme', (scheme) => {
        device.scheme = scheme;
        renderLive();
        const theme = scheme === 'dark' ? roleDark : role;
        const trigger = screen.getByRole('button', { name: m.cuisineLabel });

        expect(getComputedStyle(trigger).backgroundColor).toBe(formatRgb(theme.paper));
        expect(getComputedStyle(screen.getByText('Italian')).color).toBe(formatRgb(theme.ink));
    });

    it('lets a long custom cuisine shrink, so the chevron stays on the field', () => {
        renderLive({ initial: filled({ cuisine: 'Coastal Ligurian home cooking with a Provençal accent' }) });

        expect(
            appliedStyle(screen.getByText('Coastal Ligurian home cooking with a Provençal accent'), 'flex-shrink'),
        ).toBe('1');
    });

    it('offers every meal type and no "not stated" option', () => {
        renderLive();

        const row = screen.getByRole('radiogroup', { name: m.mealTypeLabel });

        expect(
            within(row)
                .getAllByRole('radio')
                .map((radio) => radio.getAttribute('aria-label')),
        ).toEqual(Object.values(m.mealTypeOptions));
    });

    it('chooses a meal type, and pressing it again clears it', () => {
        const { onChange } = renderLive();
        const lunch = (): HTMLElement => screen.getByRole('radio', { name: m.mealTypeOptions.lunch });

        fireEvent.click(lunch());
        expect(lastValues(onChange).mealType).toBe('lunch');

        fireEvent.click(lunch());
        expect('mealType' in lastValues(onChange)).toBe(false);
    });

    it('offers Easy, Medium and Hard with no "Not stated" chip; pressing the chosen one clears it', () => {
        const { onChange } = renderLive({ initial: filled({ difficulty: RecipeDifficulty.MEDIUM }) });

        const row = screen.getByRole('radiogroup', { name: m.difficultyLabel });
        expect(
            within(row)
                .getAllByRole('radio')
                .map((radio) => radio.getAttribute('aria-label')),
        ).toEqual([m.difficultyEasy, m.difficultyMedium, m.difficultyHard]);
        expect(screen.getByRole('radio', { name: m.difficultyMedium }).getAttribute('aria-checked')).toBe('true');

        fireEvent.click(screen.getByRole('radio', { name: m.difficultyMedium }));
        expect('difficulty' in lastValues(onChange)).toBe(false);

        fireEvent.click(screen.getByRole('radio', { name: m.difficultyHard }));
        expect(lastValues(onChange).difficulty).toBe(RecipeDifficulty.HARD);
    });
});

describe('RecipeBasicsFields (native) — tags and dietary flags', () => {
    it('shows each tag as a chip named "Remove {tag}", and an empty field to add more', () => {
        renderLive();

        expect(screen.getByRole('button', { name: 'Remove quick' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Remove vegetarian' })).toBeTruthy();
        expect(field(m.tagsLabel).value).toBe('');
    });

    it('adds a tag on return', () => {
        const { onChange } = renderLive();

        fireEvent.change(field(m.tagsLabel), { target: { value: 'easy' } });
        fireEvent.keyDown(field(m.tagsLabel), { key: 'Enter' });

        expect(lastValues(onChange).tags).toEqual(['quick', 'dinner', 'easy']);
    });

    it('adds a tag on a comma, without the comma', () => {
        const { onChange } = renderLive({ initial: filled({ tags: [] }) });

        fireEvent.change(field(m.tagsLabel), { target: { value: 'gluten free,' } });

        expect(lastValues(onChange).tags).toEqual(['gluten free']);
        expect(field(m.tagsLabel).value).toBe('');
    });

    it('adds a dietary flag with the Add control', () => {
        const { onChange } = renderLive();

        fireEvent.change(field(m.dietaryFlagsLabel), { target: { value: 'vegan' } });
        fireEvent.click(screen.getByRole('button', { name: m.addChipLabel.replace('{field}', m.dietaryFlagsLabel) }));

        expect(lastValues(onChange).dietaryFlags).toEqual(['vegetarian', 'vegan']);
    });

    it('removes a tag when its chip is pressed', () => {
        const { onChange } = renderLive();

        fireEvent.click(screen.getByRole('button', { name: 'Remove quick' }));

        expect(lastValues(onChange).tags).toEqual(['dinner']);
    });
});

describe('RecipeBasicsFields (native) — layout by container width', () => {
    const rowOf = (name: string): HTMLElement | null => screen.getByRole('group', { name }).parentElement;

    it('below 600: prep and cook share a row, servings sits above them', () => {
        device.width = 360;
        renderLive();

        const times = rowOf(m.prepTimeLabel);

        expect(times !== null && appliedStyle(times, 'flex-direction')).toBe('row');
        expect(times?.contains(screen.getByRole('group', { name: m.cookTimeLabel }))).toBe(true);
        expect(times?.contains(screen.getByRole('group', { name: m.servingsLabel }))).toBe(false);
    });

    it('from 600: servings, prep and cook share one row', () => {
        device.width = 800;
        renderLive();

        const row = rowOf(m.prepTimeLabel);

        expect(row !== null && appliedStyle(row, 'flex-direction')).toBe('row');
        expect(row?.contains(screen.getByRole('group', { name: m.servingsLabel }))).toBe(true);
    });
});
