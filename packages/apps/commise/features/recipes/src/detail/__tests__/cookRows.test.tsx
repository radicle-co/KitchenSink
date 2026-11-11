/**
 * The web ingredient row and step row of the recipe page (build spec §6.3, the first slice of 008 FR-035).
 *
 * The WHOLE ingredient row is one checkbox, named with the full line; checked, its text dims — never a strike-through,
 * because a cook re-reads a checked amount. A step stays plain content beside its own 44 px toggle, a `button` with
 * `aria-pressed` named "Mark step {n} as current"; the current step shows the `hereBar`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { FoodResolutionStatus } from '@kitchensink/recipe-core';

import { typeRole } from '@commise/ui/tokens/typography';

import { makeIngredientView, makeStepView } from '../../__fixtures__/index.js';
import { recipeMessages } from '../../messages.js';
import { IngredientCheckRow } from '../IngredientCheckRow.js';
import { StepRow } from '../StepRow.js';

afterEach(cleanup);

const lamb = makeIngredientView({
    ingredientId: 'ing_lamb',
    quantity: { kind: 'exact', value: 2 },
    unit: 'kg',
    name: 'lamb shoulder',
    preparation: 'trimmed of excess fat',
});

describe('IngredientCheckRow (web)', () => {
    // designAnswers.md 2026-11-06 fractions item 6: "unsalted butter · melted". A no-break space and a dot join the
    // preparation to the name so it never wraps onto a line of its own with nothing before it; the dot is never spoken.
    it('⛔ joins the preparation with a no-break space and a dot, and names the line with a comma', () => {
        const butter = makeIngredientView({
            ingredientId: 'ing_butter',
            quantity: { kind: 'exact', value: 2 },
            unit: 'tablespoons',
            name: 'unsalted butter',
            preparation: 'melted',
        });
        const { container } = render(
            <ul>
                <IngredientCheckRow ingredient={butter} checked={false} allRemoved={false} onToggle={vi.fn()} />
            </ul>,
        );

        const row = screen.getByRole('checkbox');
        const joiner = container.querySelector('[data-line-text] [aria-hidden="true"]');

        expect(row.getAttribute('aria-label')).toContain('unsalted butter, melted');
        expect(joiner?.textContent).toBe('\u00A0· ');
        expect(container.querySelector('[data-line-text]')?.textContent).toContain('unsalted butter\u00A0· ');
        expect(container.querySelector('[data-line-text]')?.textContent?.endsWith('melted')).toBe(true);
    });

    // b2b1294bc moved the row text from the 20 px `list` role to the 24 px `body` role and left the box a fixed 1 px down,
    // 2 px above the line's centre. jsdom has no layout, so the rule is pinned: the box sits in a box as tall as the text
    // role's line, read from the token so a role change fails here rather than shifting the box. The pixel check is
    // `recipeDetailLineAlignment.spec.ts`.
    it('centres the check box in a box as tall as the first line of its text role', () => {
        render(
            <ul>
                <IngredientCheckRow ingredient={lamb} checked={false} allRemoved={false} onToggle={vi.fn()} />
            </ul>,
        );

        const row = screen.getByRole('checkbox', { name: '2 kg lamb shoulder, trimmed of excess fat' });
        const text = row.querySelector('[data-line-text]');
        const boxSlot = row.firstElementChild;
        const lineHeightPx = typeRole.body.lineHeight;

        expect(text?.classList.contains('text-body')).toBe(true);
        expect(boxSlot?.classList.contains(`h-${String(lineHeightPx / 4)}`)).toBe(true);
        expect(boxSlot?.classList.contains('items-center')).toBe(true);
    });

    it('is one checkbox named with the whole line', () => {
        render(
            <ul>
                <IngredientCheckRow ingredient={lamb} checked={false} allRemoved={false} onToggle={vi.fn()} />
            </ul>,
        );

        const row = screen.getByRole('checkbox', { name: '2 kg lamb shoulder, trimmed of excess fat' });

        expect(row.getAttribute('aria-checked')).toBe('false');
        expect(row.textContent).toContain('lamb shoulder');
        expect(row.textContent).toContain('trimmed of excess fat');
    });

    // P7: the amount was `text-figure-inline`, a class the theme never emits, so it drew in regular weight with
    // proportional figures. Weight 600 and tabular, lining numerals are written as the utilities that exist.
    it('draws the amount at weight 600 in tabular, lining figures', () => {
        render(
            <ul>
                <IngredientCheckRow ingredient={lamb} checked={false} allRemoved={false} onToggle={vi.fn()} />
            </ul>,
        );

        const amount = screen.getByText('2 kg');

        expect(amount.className.split(' ')).toEqual(
            expect.arrayContaining(['font-semibold', 'tabular-nums', 'lining-nums']),
        );
        expect(amount.className).not.toContain('text-figure-inline');
    });

    // Owner C5 + T1: the row text is the `list` role (14, amount 600, the rest 400 ink), the row pads 8 above and below,
    // and the WHOLE row is the touch target, at least 44 tall.
    // REWRITTEN IN SLICE 2: the line is the `body` role (16), as the board draws it, where it was `list`.
    it('sets the line in the body role, pads 8 and is at least 44 tall', () => {
        const { container } = render(
            <ul>
                <IngredientCheckRow ingredient={lamb} checked={false} allRemoved={false} onToggle={vi.fn()} />
            </ul>,
        );
        const row = screen.getByRole('checkbox', { name: /lamb shoulder/u });
        const text = container.querySelector('[data-line-text]');

        expect(row.className).toContain('min-h-11');
        expect(row.className).not.toMatch(/min-h-12|py-3/u);
        expect(row.className).toContain('py-2');
        expect(text?.className).toContain('text-body');
        expect(text?.className).not.toContain('text-list');
    });

    it('toggles when the cook presses anywhere on the row, the amount and the preparation included', () => {
        const onToggle = vi.fn();
        render(
            <ul>
                <IngredientCheckRow ingredient={lamb} checked={false} allRemoved={false} onToggle={onToggle} />
            </ul>,
        );

        fireEvent.click(screen.getByText('2 kg'));
        fireEvent.click(screen.getByText('trimmed of excess fat'));

        expect(onToggle).toHaveBeenCalledTimes(2);
        expect(onToggle).toHaveBeenCalledWith('ing_lamb');
    });

    // D11: a scaled amount read "1.5 cup". The visible text and the checkbox's name carry the same plural (SC 2.5.3).
    it('pluralises a word unit for a scaled amount, in the visible text AND the name', () => {
        const flour = makeIngredientView({
            ingredientId: 'ing_f',
            quantity: { kind: 'exact', value: 1.5 },
            unit: 'cup',
            name: 'flour',
        });
        render(
            <ul>
                <IngredientCheckRow ingredient={flour} checked={false} allRemoved={false} onToggle={vi.fn()} />
            </ul>,
        );

        // WCAG 2.5.3, option C (UI Designer, amending Q5): a CONTROL is named by its visible text, glyph included, so the
        // name a voice-control user reads off the screen is the name. Only the no-break space reads as a plain space.
        const row = screen.getByRole('checkbox', { name: '1½ cups flour' });

        expect(row.textContent?.replaceAll('\u00A0', ' ')).toBe('1½ cups flour');
    });

    it('reports a press on the row with the line’s key', () => {
        const onToggle = vi.fn();
        render(
            <ul>
                <IngredientCheckRow ingredient={lamb} checked={false} allRemoved={false} onToggle={onToggle} />
            </ul>,
        );

        fireEvent.click(screen.getByText('lamb shoulder'));

        expect(onToggle).toHaveBeenCalledWith('ing_lamb');
    });

    it('checked: dims the text, with no strike-through', () => {
        render(
            <ul>
                <IngredientCheckRow ingredient={lamb} checked allRemoved={false} onToggle={vi.fn()} />
            </ul>,
        );

        const row = screen.getByRole('checkbox', { name: /lamb shoulder/u });

        expect(row.getAttribute('aria-checked')).toBe('true');
        expect(row.innerHTML).not.toContain('line-through');
        expect(screen.getByText('lamb shoulder').closest('[data-line-text]')?.className).toContain('text-ink-muted');
    });

    it('a status the line carries describes the row', () => {
        const doubted = makeIngredientView({ resolutionStatus: FoodResolutionStatus.NEEDS_REVIEW, name: 'flour' });
        render(
            <ul>
                <IngredientCheckRow ingredient={doubted} checked={false} allRemoved={false} onToggle={vi.fn()} />
            </ul>,
        );

        const describedBy = screen.getByRole('checkbox', { name: /flour/u }).getAttribute('aria-describedby') ?? '';
        expect(document.getElementById(describedBy)?.textContent).toContain('Needs review');
    });

    /**
     * The owner's review control (needs-review jump): the row takes a `reviewAction` slot, drawn as a SIBLING of the check
     * control inside the same `li` (a link inside a checkbox button is invalid HTML and would tick the line). When the slot
     * is given the "Needs review" badge moves out of the checkbox and its description, to the control; other statuses stay.
     */
    describe('the review control slot', () => {
        const doubted = makeIngredientView({
            resolutionStatus: FoodResolutionStatus.NEEDS_REVIEW,
            name: 'flour',
            isUserEntered: true,
        });
        const control = <a href="/edit#ingredients/3.0">Go to flour</a>;

        it('is a sibling of the checkbox, not inside it, and pressing it does not tick the line', () => {
            const onToggle = vi.fn();
            const { container } = render(
                <ul>
                    <IngredientCheckRow
                        ingredient={doubted}
                        checked={false}
                        allRemoved={false}
                        onToggle={onToggle}
                        reviewAction={control}
                    />
                </ul>,
            );
            const link = screen.getByRole('link', { name: 'Go to flour' });
            const row = screen.getByRole('checkbox', { name: /flour/u });

            expect(row.contains(link)).toBe(false);
            expect(link.closest('li')).toBe(row.closest('li'));
            expect(container.querySelectorAll('li')).toHaveLength(1);

            link.addEventListener('click', (event) => event.preventDefault());
            fireEvent.click(link);
            expect(onToggle).not.toHaveBeenCalled();
        });

        it('moves the Needs review badge out of the checkbox and its description; other statuses stay', () => {
            render(
                <ul>
                    <IngredientCheckRow
                        ingredient={doubted}
                        checked={false}
                        allRemoved={false}
                        onToggle={vi.fn()}
                        reviewAction={control}
                    />
                </ul>,
            );
            const row = screen.getByRole('checkbox', { name: /flour/u });
            const description = document.getElementById(row.getAttribute('aria-describedby') ?? '')?.textContent ?? '';

            expect(row.textContent).not.toContain('Needs review');
            expect(description).not.toContain('Needs review');
            expect(description).toContain(recipeMessages.en.detail.userEnteredBadge);
        });

        it('with no slot the badge stays in the row, as before', () => {
            render(
                <ul>
                    <IngredientCheckRow ingredient={doubted} checked={false} allRemoved={false} onToggle={vi.fn()} />
                </ul>,
            );

            expect(screen.getByRole('checkbox', { name: /flour/u }).textContent).toContain('Needs review');
        });

        it('with only that status, the description goes entirely', () => {
            const only = makeIngredientView({ resolutionStatus: FoodResolutionStatus.NEEDS_REVIEW, name: 'flour' });

            render(
                <ul>
                    <IngredientCheckRow
                        ingredient={only}
                        checked={false}
                        allRemoved={false}
                        onToggle={vi.fn()}
                        reviewAction={control}
                    />
                </ul>,
            );

            expect(screen.getByRole('checkbox', { name: /flour/u }).getAttribute('aria-describedby')).toBeNull();
        });
    });

    // REWRITTEN for owner C5 + T1: the row floor is 44 (it was 48), the same as every other touch target.
    it('is at least 44 px tall', () => {
        render(
            <ul>
                <IngredientCheckRow ingredient={lamb} checked={false} allRemoved={false} onToggle={vi.fn()} />
            </ul>,
        );

        expect(screen.getByRole('checkbox').className).toContain('min-h-11');
    });
});

describe('StepRow (web)', () => {
    const step = makeStepView({ stepNumber: 3, instruction: 'Rest the lamb for 20 minutes.', timerSeconds: 1200 });

    // Designer ruling c10ecadbf (2026-11-03): the numeral's circle is at least 32 and grows with the numeral, so two digits fit.
    it('draws the numeral in a circle that is at least 2rem and can only grow', () => {
        render(
            <ul>
                <StepRow step={step} current={false} onToggle={vi.fn()} />
            </ul>,
        );
        const classes = (screen.getByText(String(step.stepNumber)).className ?? '').split(/\s+/u);

        expect(classes).toEqual(expect.arrayContaining(['min-h-8', 'min-w-8', 'aspect-square']));
        expect(classes).not.toContain('size-8');
    });

    it('keeps the step text as plain content beside a toggle named for the step', () => {
        render(
            <ol>
                <StepRow step={step} current={false} onToggle={vi.fn()} />
            </ol>,
        );

        const toggle = screen.getByRole('button', { name: 'Mark step 3 as current' });

        expect(toggle.getAttribute('aria-pressed')).toBe('false');
        expect(toggle.textContent).toBe('3');
        expect(toggle.contains(screen.getByText('Rest the lamb for 20 minutes.'))).toBe(false);
    });

    it('reports a press on the toggle with the step number', () => {
        const onToggle = vi.fn();
        render(
            <ol>
                <StepRow step={step} current={false} onToggle={onToggle} />
            </ol>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Mark step 3 as current' }));

        expect(onToggle).toHaveBeenCalledWith(3);
    });

    it('stretches the toggle over the whole step for pointer users, with the timer chip above it', () => {
        render(
            <ol>
                <StepRow step={step} current={false} onToggle={vi.fn()} />
            </ol>,
        );

        expect(screen.getByRole('button', { name: 'Mark step 3 as current' }).className).toContain('after:inset-0');
        expect(screen.getByText('20 min').closest('[data-timer]')?.className).toContain('z-10');
    });

    it('current: pressed, the numeral filled with the action colour, and the here bar shown', () => {
        const { container } = render(
            <ol>
                <StepRow step={step} current onToggle={vi.fn()} />
            </ol>,
        );

        const toggle = screen.getByRole('button', { name: 'Mark step 3 as current' });

        expect(toggle.getAttribute('aria-pressed')).toBe('true');
        expect(toggle.querySelector('[data-numeral]')?.className).toContain('bg-action');
        expect(container.querySelector('[data-here-bar]')).not.toBeNull();
    });

    it('not current: no here bar', () => {
        const { container } = render(
            <ol>
                <StepRow step={step} current={false} onToggle={vi.fn()} />
            </ol>,
        );

        expect(container.querySelector('[data-here-bar]')).toBeNull();
    });

    it('a step with no timer has no timer chip', () => {
        render(
            <ol>
                <StepRow
                    step={makeStepView({ stepNumber: 1, timerSeconds: undefined })}
                    current={false}
                    onToggle={vi.fn()}
                />
            </ol>,
        );

        expect(screen.queryByRole('img', { name: 'Timer' })).toBeNull();
    });
});

describe('IngredientCheckRow (web) — the singular name for a count of one (D21)', () => {
    const onion = makeIngredientView({
        name: 'onions',
        quantity: { kind: 'exact', value: 1 },
        unit: 'large',
        preparation: 'finely chopped',
    });

    it('shows and names "1 large onion", not "onions"', () => {
        render(
            <ul>
                <IngredientCheckRow ingredient={onion} checked={false} allRemoved={false} onToggle={vi.fn()} />
            </ul>,
        );

        const row = screen.getByRole('checkbox', { name: '1 large onion, finely chopped' });

        expect(row.textContent).toContain('onion');
        expect(row.textContent).not.toContain('onions');
    });

    it('keeps the plural for two', () => {
        render(
            <ul>
                <IngredientCheckRow
                    ingredient={{ ...onion, quantity: { kind: 'exact', value: 2 }, unit: '' }}
                    checked={false}
                    allRemoved={false}
                    onToggle={vi.fn()}
                />
            </ul>,
        );

        expect(screen.getByRole('checkbox', { name: '2 onions, finely chopped' })).toBeTruthy();
    });
});
