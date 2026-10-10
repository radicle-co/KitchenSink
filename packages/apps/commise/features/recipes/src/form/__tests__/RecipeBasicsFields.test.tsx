// @vitest-environment jsdom
/**
 * Component tests for the web Details leaf, `RecipeBasicsFields` (`docs/design/uiOverhaul/buildSpec.md` §7.4, §7.10):
 * its four H3 groups, the soft title limit, the description counter, the servings stepper, prep and cook as durations
 * that never show a "0", the computed total, the cuisine select, the meal-type and difficulty choice rows, the two
 * chip inputs, the publish-refused errors, the blur checkpoint and the container layout.
 *
 * Moved here from `recipeFieldGroups.test.tsx`, whose basics blocks pinned the wizard-era layout (an H2, `maxLength`
 * on the title, number inputs for times, a "Not stated" chip). Each moved assertion is rewritten to the new contract.
 */
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type FC } from 'react';

import { CUISINES, RecipeDifficulty } from '@kitchensink/recipe-core';

import { editorMessages } from '../../editor/messages.js';
import { RecipeBasicsFields } from '../RecipeBasicsFields.js';
import { DESCRIPTION_COUNTER_FROM, DESCRIPTION_MAX_LENGTH, TITLE_COUNTER_FROM, TITLE_MAX_LENGTH } from '../limits.js';
import { recipeFormMessages } from '../messages.js';
import type { RecipeFormErrors } from '../validate.js';
import { defaultRecipeFormValues, type RecipeFormValues } from '../values.js';

const m = recipeFormMessages.en;
const e = editorMessages.en;

afterEach(cleanup);

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
    readonly onFieldBlur?: () => void;
}

/** The leaf under a parent that holds the draft, as the editor does, so typing re-renders like the real thing. */
const Harness: FC<HarnessProps> = ({ initial, errors, onChange, onFieldBlur }) => {
    const [values, setValues] = useState(initial);

    return (
        <RecipeBasicsFields
            values={values}
            {...(errors === undefined ? {} : { errors })}
            {...(onFieldBlur === undefined ? {} : { onFieldBlur })}
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

/** The last values the leaf reported. */
const lastValues = (onChange: Mock<(next: RecipeFormValues) => void>): RecipeFormValues => {
    const call = onChange.mock.calls.at(-1);

    if (call === undefined) {
        throw new Error('onChange was never called');
    }

    return call[0];
};

const titleBox = (): HTMLTextAreaElement => screen.getByRole<HTMLTextAreaElement>('textbox', { name: m.titleLabel });

describe('RecipeBasicsFields (web) — headings', () => {
    it('renders the four group headings as H3s, and no section H2 of its own', () => {
        renderLive();

        expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual([
            m.groups.about,
            m.groups.timeAndServings,
            m.groups.kindOfDish,
            m.groups.dietAndTags,
        ]);
        expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
    });

    it('styles a group heading in the label role, muted', () => {
        renderLive();

        const heading = screen.getByRole('heading', { level: 3, name: m.groups.about });

        expect(heading.className).toContain('text-label');
        expect(heading.className).toContain('text-ink-muted');
    });
});

describe('RecipeBasicsFields (web) — title', () => {
    it('is a multi-line field with a visible label and NO maxLength', () => {
        renderLive();

        const title = titleBox();

        expect(title.tagName).toBe('TEXTAREA');
        expect(title.value).toBe('Herb risotto');
        expect(title.hasAttribute('maxlength')).toBe(false);
        expect(screen.getByText(m.titleLabel, { selector: 'label' })).toBeTruthy();
    });

    it('grows to three lines at most', () => {
        renderLive();

        expect(titleBox().style.maxHeight).toContain('3lh');
    });

    it('shows no counter below 100 characters', () => {
        renderLive({ initial: filled({ title: 'a'.repeat(TITLE_COUNTER_FROM - 1) }) });

        expect(screen.queryByText(`${String(TITLE_COUNTER_FROM - 1)}/${String(TITLE_MAX_LENGTH)}`)).toBeNull();
    });

    it('shows the counter from 100 characters, in the muted caption, and the field stays valid', () => {
        renderLive({ initial: filled({ title: 'a'.repeat(TITLE_COUNTER_FROM) }) });

        const counter = screen.getByText(`${String(TITLE_COUNTER_FROM)}/${String(TITLE_MAX_LENGTH)}`);

        expect(counter.className).toContain('text-ink-muted');
        expect(titleBox().getAttribute('aria-invalid')).toBeNull();
        expect(screen.queryByText(e.details.titleLimit)).toBeNull();
    });

    it('counts the trimmed title, as the publish check does', () => {
        renderLive({ initial: filled({ title: `   ${'a'.repeat(TITLE_COUNTER_FROM)}   ` }) });

        expect(screen.getByText(`${String(TITLE_COUNTER_FROM)}/${String(TITLE_MAX_LENGTH)}`)).toBeTruthy();
    });

    it('past 120 turns the counter danger, marks the field invalid and says why, live, with no errors given', () => {
        renderLive({ initial: filled({ title: 'a'.repeat(TITLE_MAX_LENGTH) }) });

        fireEvent.change(titleBox(), { target: { value: 'a'.repeat(TITLE_MAX_LENGTH + 1) } });

        const counter = screen.getByText(`${String(TITLE_MAX_LENGTH + 1)}/${String(TITLE_MAX_LENGTH)}`);
        const message = screen.getByText(e.details.titleLimit);

        expect(counter.className).toContain('text-danger-text');
        expect(titleBox().getAttribute('aria-invalid')).toBe('true');
        expect(titleBox().getAttribute('aria-describedby')?.split(' ')).toContain(message.id);
        expect(titleBox().value).toHaveLength(TITLE_MAX_LENGTH + 1);
    });

    it('is not over AT 120', () => {
        renderLive({ initial: filled({ title: 'a'.repeat(TITLE_MAX_LENGTH) }) });

        expect(titleBox().getAttribute('aria-invalid')).toBeNull();
        expect(screen.getByText(`${String(TITLE_MAX_LENGTH)}/${String(TITLE_MAX_LENGTH)}`).className).not.toContain(
            'text-danger-text',
        );
    });

    it('blocks Enter: the title stays one line', async () => {
        const user = userEvent.setup();
        const { onChange } = renderLive({ initial: filled({ title: '' }) });

        await user.type(titleBox(), 'Pasta{Enter}');

        expect(titleBox().value).toBe('Pasta');
        expect(lastValues(onChange).title).toBe('Pasta');
    });

    it('leaves an Enter that confirms an input method`s composition alone', () => {
        renderLive();

        expect(fireEvent.keyDown(titleBox(), { key: 'Enter', isComposing: true })).toBe(true);
        expect(fireEvent.keyDown(titleBox(), { key: 'Enter' })).toBe(false);
    });

    it('a pasted line break becomes a space', () => {
        const { onChange } = renderLive();

        fireEvent.change(titleBox(), { target: { value: 'Herb\nrisotto' } });

        expect(lastValues(onChange).title).toBe('Herb risotto');
    });

    it('a refused publish shows its title message, linked to the field', () => {
        renderLive({ initial: filled({ title: '' }), errors: { title: 'titleRequired' } });

        const message = screen.getByRole('alert');

        expect(message.textContent).toBe(m.errors.titleRequired);
        expect(titleBox().getAttribute('aria-invalid')).toBe('true');
        expect(titleBox().getAttribute('aria-describedby')?.split(' ')).toContain(message.id);
    });

    it('a refused publish for a long title says the limit ONCE, not twice', () => {
        renderLive({ initial: filled({ title: 'a'.repeat(TITLE_MAX_LENGTH + 5) }), errors: { title: 'titleTooLong' } });

        expect(screen.getAllByText(e.details.titleLimit)).toHaveLength(1);
    });
});

describe('RecipeBasicsFields (web) — description', () => {
    const descriptionBox = (): HTMLTextAreaElement =>
        screen.getByRole<HTMLTextAreaElement>('textbox', { name: m.descriptionLabel });

    it('is at least four rows, with no maxLength', () => {
        renderLive();

        expect(descriptionBox().rows).toBe(4);
        expect(descriptionBox().hasAttribute('maxlength')).toBe(false);
    });

    it('reports an edit', () => {
        const { onChange } = renderLive();

        fireEvent.change(descriptionBox(), { target: { value: 'Rich.' } });

        expect(lastValues(onChange).description).toBe('Rich.');
    });

    it('shows no counter below 80% of its cap', () => {
        renderLive({ initial: filled({ description: 'a'.repeat(DESCRIPTION_COUNTER_FROM - 1) }) });

        expect(
            screen.queryByText(`${String(DESCRIPTION_COUNTER_FROM - 1)}/${String(DESCRIPTION_MAX_LENGTH)}`),
        ).toBeNull();
    });

    it('shows the counter from 80% of its cap', () => {
        renderLive({ initial: filled({ description: 'a'.repeat(DESCRIPTION_COUNTER_FROM) }) });

        expect(screen.getByText(`${String(DESCRIPTION_COUNTER_FROM)}/${String(DESCRIPTION_MAX_LENGTH)}`)).toBeTruthy();
        expect(descriptionBox().getAttribute('aria-invalid')).toBeNull();
    });

    // Publish does not refuse a long description, so the field is not marked invalid: the counter says it all.
    it('past its cap the counter turns danger, the field is NOT marked invalid, and nothing is cut', () => {
        renderLive({ initial: filled({ description: 'a'.repeat(DESCRIPTION_MAX_LENGTH + 1) }) });

        const counter = screen.getByText(`${String(DESCRIPTION_MAX_LENGTH + 1)}/${String(DESCRIPTION_MAX_LENGTH)}`);

        expect(counter.className).toContain('text-danger-text');
        expect(descriptionBox().getAttribute('aria-invalid')).toBeNull();
        expect(descriptionBox().getAttribute('aria-describedby')?.split(' ')).toContain(counter.id);
        expect(descriptionBox().value).toHaveLength(DESCRIPTION_MAX_LENGTH + 1);
    });
});

describe('RecipeBasicsFields (web) — servings', () => {
    it('is a stepper showing the servings', () => {
        renderLive();

        const group = screen.getByRole('group', { name: m.servingsLabel });

        expect(within(group).getByText('4')).toBeTruthy();
    });

    it('steps up and down', async () => {
        const user = userEvent.setup();
        const { onChange } = renderLive();

        await user.click(screen.getByRole('button', { name: m.servingsIncrease }));
        expect(lastValues(onChange).servings).toBe(5);

        await user.click(screen.getByRole('button', { name: m.servingsDecrease }));
        await user.click(screen.getByRole('button', { name: m.servingsDecrease }));
        expect(lastValues(onChange).servings).toBe(3);
    });

    it('stops at 1', async () => {
        const user = userEvent.setup();
        const { onChange } = renderLive({ initial: filled({ servings: 1 }) });

        const fewer = screen.getByRole('button', { name: m.servingsDecrease });
        await user.click(fewer);

        expect(fewer.getAttribute('aria-disabled')).toBe('true');
        expect(onChange).not.toHaveBeenCalled();
    });

    it('a refused publish shows the servings message', () => {
        renderLive({ initial: filled({ servings: 0 }), errors: { servings: 'servingsPositive' } });

        expect(screen.getByRole('alert').textContent).toBe(m.errors.servingsPositive);
    });
});

describe('RecipeBasicsFields (web) — prep, cook and total', () => {
    const box = (field: string, unit: 'hours' | 'minutes'): HTMLInputElement =>
        screen.getByRole<HTMLInputElement>('spinbutton', {
            name: (unit === 'hours' ? m.durationHoursLabel : m.durationMinutesLabel).replace('{field}', field),
        });

    it('shows prep and cook EMPTY, never "0", when no time is stated', () => {
        renderLive({ initial: filled({ prepTimeMinutes: 0, cookTimeMinutes: 0 }) });

        for (const field of [m.prepTimeLabel, m.cookTimeLabel]) {
            expect(screen.getByRole('group', { name: field })).toBeTruthy();
            expect(box(field, 'hours').value).toBe('');
            expect(box(field, 'minutes').value).toBe('');
        }
    });

    it('shows a stated time in hours and minutes', () => {
        renderLive({ initial: filled({ prepTimeMinutes: 90 }) });

        expect(box(m.prepTimeLabel, 'hours').value).toBe('1');
        expect(box(m.prepTimeLabel, 'minutes').value).toBe('30');
    });

    it('stores an entered duration as minutes', () => {
        const { onChange } = renderLive({ initial: filled({ cookTimeMinutes: 0 }) });

        fireEvent.change(box(m.cookTimeLabel, 'minutes'), { target: { value: '45' } });

        expect(lastValues(onChange).cookTimeMinutes).toBe(45);
    });

    it('clearing a duration stores 0 minutes', () => {
        const { onChange } = renderLive({ initial: filled({ prepTimeMinutes: 10 }) });

        fireEvent.change(box(m.prepTimeLabel, 'minutes'), { target: { value: '' } });

        expect(lastValues(onChange).prepTimeMinutes).toBe(0);
    });

    it('hides the total while both are empty', () => {
        renderLive({ initial: filled({ prepTimeMinutes: 0, cookTimeMinutes: 0 }) });

        expect(screen.queryByText(/^Total/u)).toBeNull();
    });

    it.each([
        [10, 25, 'Total 35 min'],
        [0, 60, 'Total 1 h'],
        [30, 300, 'Total 5 h 30 min'],
    ])('shows %i + %i as "%s", read-only, in the meta role', (prepTimeMinutes, cookTimeMinutes, text) => {
        renderLive({ initial: filled({ prepTimeMinutes, cookTimeMinutes }) });

        const total = screen.getByText(text);

        expect(total.className).toContain('text-meta');
        expect(screen.queryByRole('spinbutton', { name: /total/iu })).toBeNull();
    });

    it('a refused publish shows the times message', () => {
        renderLive({ errors: { times: 'timesNonNegative' } });

        expect(screen.getByRole('alert').textContent).toBe(m.errors.timesNonNegative);
    });
});

describe('RecipeBasicsFields (web) — cuisine', () => {
    it('is a select with a clear option first, then the curated list', () => {
        renderLive();

        const select = screen.getByRole<HTMLSelectElement>('combobox', { name: m.cuisineLabel });
        const options = within(select)
            .getAllByRole<HTMLOptionElement>('option')
            .map((option) => option.textContent);

        expect(select.value).toBe('Italian');
        expect(options[0]).toBe(m.cuisineUnsetOption);
        expect(options.slice(1)).toEqual([...CUISINES]);
    });

    it('keeps a custom cuisine selected and visible, and clears with the first option', () => {
        const { onChange } = renderLive({ initial: filled({ cuisine: 'Grandma’s Secret Blend' }) });

        const select = screen.getByRole<HTMLSelectElement>('combobox', { name: m.cuisineLabel });

        expect(select.value).toBe('Grandma’s Secret Blend');
        fireEvent.change(select, { target: { value: '' } });
        expect(lastValues(onChange).cuisine).toBe('');
    });

    it('reports a choice', () => {
        const { onChange } = renderLive();

        fireEvent.change(screen.getByRole('combobox', { name: m.cuisineLabel }), { target: { value: CUISINES[0] } });

        expect(lastValues(onChange).cuisine).toBe(CUISINES[0]);
    });
});

describe('RecipeBasicsFields (web) — meal type and difficulty', () => {
    it('offers every meal type and no "not stated" option, none chosen on a new recipe', () => {
        renderLive({ initial: defaultRecipeFormValues() });

        const row = screen.getByRole('radiogroup', { name: m.mealTypeLabel });
        const options = within(row).getAllByRole('radio');

        expect(options.map((option) => option.getAttribute('aria-label'))).toEqual(Object.values(m.mealTypeOptions));
        expect(options.every((option) => option.getAttribute('aria-checked') === 'false')).toBe(true);
        expect(within(row).queryByRole('radio', { name: m.mealTypeNotStated })).toBeNull();
    });

    it('chooses a meal type, and pressing it again clears it (the key is removed, not set undefined)', async () => {
        const user = userEvent.setup();
        const { onChange } = renderLive();
        const dinner = (): HTMLElement =>
            within(screen.getByRole('radiogroup', { name: m.mealTypeLabel })).getByRole('radio', {
                name: m.mealTypeOptions.dinner,
            });

        await user.click(dinner());
        expect(lastValues(onChange).mealType).toBe('dinner');
        expect(dinner().getAttribute('aria-checked')).toBe('true');

        await user.click(dinner());
        expect('mealType' in lastValues(onChange)).toBe(false);
    });

    it('wraps the meal types onto more lines rather than scrolling them', () => {
        renderLive();

        expect(screen.getByRole('radiogroup', { name: m.mealTypeLabel }).className).toContain('flex-wrap');
    });

    it('offers Easy, Medium and Hard, with NO "Not stated" chip', () => {
        renderLive();

        const row = screen.getByRole('radiogroup', { name: m.difficultyLabel });

        expect(
            within(row)
                .getAllByRole('radio')
                .map((option) => option.getAttribute('aria-label')),
        ).toEqual([m.difficultyEasy, m.difficultyMedium, m.difficultyHard]);
        expect(within(row).queryByRole('radio', { name: m.difficultyNotStated })).toBeNull();
    });

    it('shows the stated difficulty as chosen', () => {
        renderLive({ initial: filled({ difficulty: RecipeDifficulty.HARD }) });

        expect(screen.getByRole('radio', { name: m.difficultyHard }).getAttribute('aria-checked')).toBe('true');
        expect(screen.getByRole('radio', { name: m.difficultyEasy }).getAttribute('aria-checked')).toBe('false');
    });

    it('pressing a difficulty states it, and pressing the chosen one again clears it', async () => {
        const user = userEvent.setup();
        const { onChange } = renderLive();

        await user.click(screen.getByRole('radio', { name: m.difficultyEasy }));
        expect(lastValues(onChange).difficulty).toBe(RecipeDifficulty.EASY);

        await user.click(screen.getByRole('radio', { name: m.difficultyEasy }));
        expect('difficulty' in lastValues(onChange)).toBe(false);
        expect(screen.getByRole('radio', { name: m.difficultyEasy }).getAttribute('aria-checked')).toBe('false');
    });

    it('pressing another difficulty moves the choice', async () => {
        const user = userEvent.setup();
        const { onChange } = renderLive({ initial: filled({ difficulty: RecipeDifficulty.EASY }) });

        await user.click(screen.getByRole('radio', { name: m.difficultyMedium }));

        expect(lastValues(onChange).difficulty).toBe(RecipeDifficulty.MEDIUM);
    });
});

describe('RecipeBasicsFields (web) — tags and dietary flags', () => {
    it('shows each tag as a chip named "Remove {tag}", and an empty field to add more', () => {
        renderLive();

        expect(screen.getByRole('button', { name: 'Remove quick' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Remove dinner' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Remove vegetarian' })).toBeTruthy();
        expect(screen.getByRole<HTMLInputElement>('textbox', { name: m.tagsLabel }).value).toBe('');
        expect(screen.getByRole<HTMLInputElement>('textbox', { name: m.dietaryFlagsLabel }).value).toBe('');
    });

    it('says how to add one, as a hint linked to the field', () => {
        renderLive();

        const field = screen.getByRole('textbox', { name: m.tagsLabel });

        expect(field.getAttribute('aria-describedby')).not.toBeNull();
        expect(document.getElementById(field.getAttribute('aria-describedby') ?? '')?.textContent).toBe(m.tagsHint);
    });

    it('adds a tag on Enter', async () => {
        const user = userEvent.setup();
        const { onChange } = renderLive();

        await user.type(screen.getByRole('textbox', { name: m.tagsLabel }), 'easy{Enter}');

        expect(lastValues(onChange).tags).toEqual(['quick', 'dinner', 'easy']);
        expect(screen.getByRole<HTMLInputElement>('textbox', { name: m.tagsLabel }).value).toBe('');
    });

    it('adds a tag on a comma, without the comma', async () => {
        const user = userEvent.setup();
        const { onChange } = renderLive({ initial: filled({ tags: [] }) });

        await user.type(screen.getByRole('textbox', { name: m.tagsLabel }), 'gluten free,');

        expect(lastValues(onChange).tags).toEqual(['gluten free']);
        expect(screen.getByRole<HTMLInputElement>('textbox', { name: m.tagsLabel }).value).toBe('');
    });

    it('a pasted list with commas adds each and keeps the unfinished end', () => {
        const { onChange } = renderLive({ initial: filled({ tags: [] }) });

        fireEvent.change(screen.getByRole('textbox', { name: m.tagsLabel }), { target: { value: 'a, b, c' } });

        expect(lastValues(onChange).tags).toEqual(['a', 'b']);
        expect(screen.getByRole<HTMLInputElement>('textbox', { name: m.tagsLabel }).value).toBe(' c');
    });

    it('drops a duplicate (any case)', async () => {
        const user = userEvent.setup();
        const { onChange } = renderLive();

        await user.type(screen.getByRole('textbox', { name: m.tagsLabel }), 'QUICK{Enter}');

        expect(onChange).not.toHaveBeenCalled();
    });

    it('adds what was typed when the field loses focus', async () => {
        const user = userEvent.setup();
        const { onChange } = renderLive();

        await user.type(screen.getByRole('textbox', { name: m.dietaryFlagsLabel }), 'vegan');
        await user.tab();

        expect(lastValues(onChange).dietaryFlags).toEqual(['vegetarian', 'vegan']);
    });

    it('removes a tag when its chip is pressed', async () => {
        const user = userEvent.setup();
        const { onChange } = renderLive();

        await user.click(screen.getByRole('button', { name: 'Remove quick' }));

        expect(lastValues(onChange).tags).toEqual(['dinner']);
    });
});

describe('RecipeBasicsFields (web) — the blur checkpoint', () => {
    it('calls onFieldBlur when a field loses focus', async () => {
        const user = userEvent.setup();
        const onFieldBlur = vi.fn();
        renderLive({ onFieldBlur });

        await user.click(titleBox());
        expect(onFieldBlur).not.toHaveBeenCalled();

        await user.click(screen.getByRole('textbox', { name: m.descriptionLabel }));
        expect(onFieldBlur).toHaveBeenCalledTimes(1);
    });

    it('does not call it when a button loses focus', async () => {
        const user = userEvent.setup();
        const onFieldBlur = vi.fn();
        renderLive({ onFieldBlur });

        screen.getByRole('button', { name: m.servingsIncrease }).focus();
        await user.click(document.body);

        expect(onFieldBlur).not.toHaveBeenCalled();
    });

    it('is optional', async () => {
        const user = userEvent.setup();
        renderLive();

        await user.click(titleBox());
        await user.tab();

        expect(document.activeElement).not.toBe(titleBox());
    });
});

describe('RecipeBasicsFields (web) — layout by container width', () => {
    it('servings takes a whole line below 600 and shares the row from 600; prep and cook wrap rather than overflow', () => {
        renderLive();

        const prepCell = screen.getByRole('group', { name: m.prepTimeLabel }).parentElement;
        const row = prepCell?.parentElement;
        const servingsCell = screen.getByRole('group', { name: m.servingsLabel }).parentElement?.parentElement;

        expect(row?.className).toContain('flex-wrap');
        expect(prepCell?.className).toContain('min-w-fit');
        expect(row?.contains(screen.getByRole('group', { name: m.cookTimeLabel }))).toBe(true);
        expect(servingsCell?.parentElement).toBe(row);
        expect(servingsCell?.className).toContain('basis-full');
        expect(servingsCell?.className).toContain('@regular/main:basis-0');
    });

    it('puts cuisine and meal type side by side from 600', () => {
        renderLive();

        const kind = screen.getByRole('combobox', { name: m.cuisineLabel }).parentElement?.parentElement;

        expect(kind?.className).toContain('@regular/main:grid-cols-2');
        expect(kind?.contains(screen.getByRole('radiogroup', { name: m.mealTypeLabel }))).toBe(true);
    });
});
