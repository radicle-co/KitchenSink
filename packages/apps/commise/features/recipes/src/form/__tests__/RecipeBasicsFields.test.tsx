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

import { fieldErrorId } from '@commise/ui/input';

import { editorMessages } from '../../editor/messages.js';
import { RecipeBasicsFields } from '../RecipeBasicsFields.js';
import { DESCRIPTION_COUNTER_FROM, DESCRIPTION_MAX_LENGTH, TITLE_COUNTER_FROM, TITLE_MAX_LENGTH } from '../limits.js';
import { cuisineFieldId } from '../fieldIds.js';
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

/**
 * The one alert that says something. The cuisine Combobox keeps an empty assertive region mounted so a later failure can
 * be heard (4.1.3), and an empty region is not a message.
 */
const spokenAlert = (): HTMLElement => {
    const [only, ...rest] = screen.getAllByRole('alert').filter((alert) => (alert.textContent ?? '') !== '');

    if (only === undefined || rest.length > 0) {
        throw new Error('Expected exactly one alert with text.');
    }

    return only;
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

        const message = spokenAlert();

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

    // Owner 2026-10-13: a description past 256 blocks Publish (a draft still saves), so past the cap the field says so,
    // and nothing is cut.
    it('past its cap the counter turns danger, the field is marked invalid with the limit stated, and nothing is cut', () => {
        renderLive({ initial: filled({ description: 'a'.repeat(DESCRIPTION_MAX_LENGTH + 1) }) });

        const counter = screen.getByText(`${String(DESCRIPTION_MAX_LENGTH + 1)}/${String(DESCRIPTION_MAX_LENGTH)}`);
        const message = screen.getByText(e.details.descriptionLimit);

        expect(counter.className).toContain('text-danger-text');
        expect(descriptionBox().getAttribute('aria-invalid')).toBe('true');
        expect(descriptionBox().getAttribute('aria-describedby')?.split(' ')).toEqual(
            expect.arrayContaining([counter.id, message.id]),
        );
        expect(descriptionBox().value).toHaveLength(DESCRIPTION_MAX_LENGTH + 1);
    });

    it('at exactly its cap there is no error', () => {
        renderLive({ initial: filled({ description: 'a'.repeat(DESCRIPTION_MAX_LENGTH) }) });

        expect(descriptionBox().getAttribute('aria-invalid')).toBeNull();
        expect(screen.queryByText(e.details.descriptionLimit)).toBeNull();
    });

    it('a refused publish for a long description says the limit ONCE, as an alert', () => {
        renderLive({
            initial: filled({ description: 'a'.repeat(DESCRIPTION_MAX_LENGTH + 5) }),
            errors: { description: 'descriptionTooLong' },
        });

        expect(screen.getAllByText(m.errors.descriptionTooLong)).toHaveLength(1);
        expect(spokenAlert().textContent).toBe(m.errors.descriptionTooLong);
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

        expect(spokenAlert().textContent).toBe(m.errors.servingsPositive);
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

        expect(spokenAlert().textContent).toBe(m.errors.timesNonNegative);
    });
});

// The Cuisine field (`docs/design/uiOverhaul/cuisineField.md` §3, owner rulings 2026-10-13): free text with the 90
// suggestions under it, filtered by what the cook types; the cook's own words are a value too, offered as "Use “…”".
// One case per state of §3.1 (S1–S9; S10, disabled, does not occur — the editor never disables this field).
describe('RecipeBasicsFields (web) — cuisine', () => {
    const cuisineField = (): HTMLInputElement =>
        screen.getByRole<HTMLInputElement>('combobox', { name: m.cuisineLabel });
    const listbox = (): HTMLElement => screen.getByRole('listbox', { name: m.cuisineListLabel });
    const suggestions = (): string[] =>
        within(listbox())
            .getAllByRole('option')
            .map((option) => option.textContent ?? '');

    it('S1 — a visible label, the hint under it describing the field, and no list', () => {
        renderLive({ initial: filled({ cuisine: '' }) });

        expect(screen.getByText(m.cuisineLabel, { selector: 'label' }).getAttribute('for')).toBe(cuisineField().id);
        const hint = screen.getByText(m.cuisineHint);
        expect(cuisineField().getAttribute('aria-describedby')?.split(' ')).toContain(hint.id);
        // No `aria-required`: a draft saves without a cuisine, so the field claims no refusal that never comes.
        expect(cuisineField().hasAttribute('aria-required')).toBe(false);
        expect(screen.queryByRole('listbox')).toBeNull();
    });

    it('S2 — focus on an empty field lists all 90, in order, and says how many', async () => {
        const user = userEvent.setup();
        renderLive({ initial: filled({ cuisine: '' }) });

        await user.click(cuisineField());

        expect(suggestions()).toEqual([...CUISINES]);
        expect(screen.getByText('90 cuisines')).toBeTruthy();
    });

    it('S6 — focus over a committed cuisine still lists all 90: the filter is the cook’s next edit, not the value', async () => {
        const user = userEvent.setup();
        renderLive();

        await user.click(cuisineField());

        expect(cuisineField().value).toBe('Italian');
        expect(suggestions()).toHaveLength(90);
    });

    it('S3 — typing narrows to the names that start with the text, then offers the cook’s own words under "Not listed?"', async () => {
        const user = userEvent.setup();
        renderLive({ initial: filled({ cuisine: '' }) });

        await user.click(cuisineField());
        await user.type(cuisineField(), 'ind');

        expect(suggestions()).toEqual(['Indian', 'Indonesian', 'Use “Ind”']);
        const notListed = within(listbox()).getByRole('group', { name: m.cuisineNotListedHeading });
        expect(within(notListed).getByRole('option', { name: 'Use “Ind” as the cuisine' })).toBeTruthy();
    });

    it('S4 — an exact match offers no Use option: the entry is the value', async () => {
        const user = userEvent.setup();
        renderLive({ initial: filled({ cuisine: '' }) });

        await user.click(cuisineField());
        await user.type(cuisineField(), 'thai');

        expect(suggestions()).toEqual(['Thai']);
    });

    it('S5 — no match: the note, then one option that uses the cook’s words, saved in their canonical form', async () => {
        const user = userEvent.setup();
        const { onChange } = renderLive({ initial: filled({ cuisine: '' }) });

        await user.click(cuisineField());
        await user.type(cuisineField(), 'nyonya');

        expect(screen.getByText('No cuisines match “Nyonya”. You can use it as your own.')).toBeTruthy();
        expect(suggestions()).toEqual(['Use “Nyonya”']);
        await user.click(screen.getByRole('option', { name: 'Use “Nyonya” as the cuisine' }));
        expect(lastValues(onChange).cuisine).toBe('Nyonya');
        expect(screen.queryByRole('listbox')).toBeNull();
    });

    it('a pick commits the entry in the list’s spelling', async () => {
        const user = userEvent.setup();
        const { onChange } = renderLive({ initial: filled({ cuisine: '' }) });

        await user.click(cuisineField());
        await user.type(cuisineField(), 'fre');
        await user.click(screen.getByRole('option', { name: 'French' }));

        expect(lastValues(onChange).cuisine).toBe('French');
    });

    it('S7 — Enter with nothing active commits the typed text, canonical, and closes the list', async () => {
        const user = userEvent.setup();
        const { onChange } = renderLive({ initial: filled({ cuisine: '' }) });

        await user.click(cuisineField());
        await user.type(cuisineField(), 'grandma style{Enter}');

        expect(lastValues(onChange).cuisine).toBe('Grandma style');
        expect(screen.queryByRole('listbox')).toBeNull();
        expect(document.activeElement).toBe(cuisineField());
    });

    it('Tab out of the field commits the typed text in the list’s spelling, and chooses nothing', async () => {
        const user = userEvent.setup();
        const { onChange } = renderLive({ initial: filled({ cuisine: '' }) });

        await user.click(cuisineField());
        await user.type(cuisineField(), 'thai');
        await user.tab();

        expect(lastValues(onChange).cuisine).toBe('Thai');
    });

    it('keeps a custom cuisine, and clears with Escape on a closed list', async () => {
        const user = userEvent.setup();
        const { onChange } = renderLive({ initial: filled({ cuisine: 'Grandma’s Secret Blend' }) });

        expect(cuisineField().value).toBe('Grandma’s Secret Blend');

        // Focus opens the list. Escape on an open list only closes it (APG); the next Escape, on a closed list, clears.
        cuisineField().focus();
        await user.keyboard('{Escape}');
        expect(onChange).not.toHaveBeenCalled();
        await user.keyboard('{Escape}');
        expect(lastValues(onChange).cuisine).toBe('');
    });

    it('S8 — a refused Publish names the field and the fix in the field’s own error slot, which is not live', () => {
        renderLive({ initial: filled({ cuisine: '' }), errors: { cuisine: 'cuisineRequired' } });

        const message = screen.getByText(m.errors.cuisineRequired);
        expect(message.id).toBe(fieldErrorId(cuisineFieldId));
        expect(message.getAttribute('role')).toBeNull();
        expect(cuisineField().getAttribute('aria-invalid')).toBe('true');
        expect(cuisineField().getAttribute('aria-describedby')?.split(' ')[0]).toBe(message.id);
        // The publish-refusal path already speaks S8; the slot must not speak it a second time.
        expect(screen.queryAllByRole('alert').filter((alert) => (alert.textContent ?? '') !== '')).toEqual([]);
    });

    it('S9 — past 100 characters the slot says the limit, and the field’s alert speaks it once', () => {
        renderLive({ initial: filled({ cuisine: 'a'.repeat(101) }), errors: { cuisine: 'cuisineTooLong' } });
        const limit = 'Shorten the cuisine to 100 characters or fewer.';

        expect(screen.getByText(limit, { selector: 'p' }).getAttribute('role')).toBeNull();
        expect(spokenAlert().textContent).toBe(limit);
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
    // Rewritten for A-009 (build spec §7.4: "below 600, Prep and Cook sit side by side, about 136 px each at 320"): the
    // cells used to keep their duration boxes whole (`min-w-fit`, about 220 px each), so Cook always wrapped under Prep. The
    // duration field now fits 136 px, so the cells share the line (`min-w-0 flex-1`) and only servings takes its own.
    it('servings takes a whole line below 600 and shares the row from 600; prep and cook share a line at every width', () => {
        renderLive();

        const prepCell = screen.getByRole('group', { name: m.prepTimeLabel }).parentElement;
        const cookCell = screen.getByRole('group', { name: m.cookTimeLabel }).parentElement;
        const row = prepCell?.parentElement;
        const servingsCell = screen.getByRole('group', { name: m.servingsLabel }).parentElement?.parentElement;

        expect(row?.className).toContain('flex-wrap');

        for (const cell of [prepCell, cookCell]) {
            expect(cell?.className.split(/\s+/u)).toEqual(expect.arrayContaining(['min-w-0', 'flex-1']));
            expect(cell?.className.split(/\s+/u)).not.toContain('min-w-fit');
        }

        expect(cookCell?.parentElement).toBe(row);
        expect(servingsCell?.parentElement).toBe(row);
        expect(servingsCell?.className).toContain('basis-full');
        expect(servingsCell?.className).toContain('@regular/main:basis-0');
    });

    it('puts cuisine and meal type side by side from 600', () => {
        renderLive();

        const kind = screen.getByText(m.cuisineLabel, { selector: 'label' }).closest('.grid');

        expect(kind?.className).toContain('@regular/main:grid-cols-2');
        expect(kind?.contains(screen.getByRole('radiogroup', { name: m.mealTypeLabel }))).toBe(true);
    });
});
