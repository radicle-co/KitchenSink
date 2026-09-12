// @vitest-environment jsdom
/**
 * The wizard's navigation statechart (`useWizardNavigation`), which both `Wizard` leaves draw: the attempted set that
 * gates the rail's invalid flag, the refused-advance notice, and the discard guard that defers a backward move or a
 * Cancel while the draft is dirty until the cook answers.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { RecipeWizardStep } from '../../form/steps.js';
import { defaultRecipeFormValues } from '../../form/values.js';
import { WIZARD_STEPS } from '../model.js';
import { useWizardNavigation, type WizardProps } from '../useWizardNavigation.js';

const props = (overrides: Partial<WizardProps> = {}): WizardProps => ({
    mode: 'create',
    step: 2,
    values: defaultRecipeFormValues(),
    canAdvanceFrom: () => true,
    stepErrors: () => ({}),
    goNext: vi.fn(),
    goPrev: vi.fn(),
    goToStep: vi.fn(),
    saveDraft: vi.fn(),
    publish: vi.fn(),
    onCancel: vi.fn(),
    isDirty: false,
    submitting: false,
    pickFailures: 0,
    children: null,
    ...overrides,
});

const render = (initial: WizardProps) =>
    renderHook((current: WizardProps) => useWizardNavigation(current), { initialProps: initial });

describe('useWizardNavigation — Next and Publish', () => {
    it('carries the props through to the parts', () => {
        const given = props({ step: 3, submitting: true });
        const { navigation } = render(given).result.current;

        expect(navigation.step).toBe(3);
        expect(navigation.submitting).toBe(true);
        expect(navigation.values).toBe(given.values);
    });

    it('Next marks the current step attempted and advances; an accepted advance leaves no notice', () => {
        const given = props();
        const { result } = render(given);

        act(() => result.current.navigation.requestGoNext());

        expect(given.goNext).toHaveBeenCalledOnce();
        expect([...result.current.navigation.attempted]).toEqual([2]);
        expect(result.current.navigation.blockedStep).toBeNull();
    });

    it('a refused Next records the step it refused, for the bar to say why', () => {
        const { result } = render(props({ canAdvanceFrom: () => false }));

        act(() => result.current.navigation.requestGoNext());

        expect(result.current.navigation.blockedStep).toBe(2);
    });

    it('Publish marks every step attempted, clears the notice, and publishes', () => {
        const given = props({ canAdvanceFrom: () => false });
        const { result } = render(given);

        act(() => result.current.navigation.requestGoNext());
        act(() => result.current.navigation.requestPublish());

        expect([...result.current.navigation.attempted].sort()).toEqual([...WIZARD_STEPS]);
        expect(result.current.navigation.blockedStep).toBeNull();
        expect(given.publish).toHaveBeenCalledOnce();
    });
});

describe('useWizardNavigation — the discard guard', () => {
    it.each<
        [
            string,
            Partial<WizardProps>,
            (nav: ReturnType<typeof useWizardNavigation>['navigation']) => void,
            keyof WizardProps,
        ]
    >([
        ['Previous, clean', {}, (nav) => nav.requestGoPrev(), 'goPrev'],
        ['a rail jump back, clean', {}, (nav) => nav.requestGoToStep(1), 'goToStep'],
        ['a rail jump forward, dirty', { isDirty: true }, (nav) => nav.requestGoToStep(4), 'goToStep'],
        ['Cancel, clean', {}, (nav) => nav.requestCancel(), 'onCancel'],
    ])('%s: runs at once, with no dialog', (_case, overrides, request, called) => {
        const given = props(overrides);
        const { result } = render(given);

        act(() => request(result.current.navigation));

        expect(given[called]).toHaveBeenCalledOnce();
        expect(result.current.discard.open).toBe(false);
    });

    it.each<[string, (nav: ReturnType<typeof useWizardNavigation>['navigation']) => void, keyof WizardProps]>([
        ['Previous', (nav) => nav.requestGoPrev(), 'goPrev'],
        ['a rail jump back', (nav) => nav.requestGoToStep(1), 'goToStep'],
        ['Cancel', (nav) => nav.requestCancel(), 'onCancel'],
    ])('%s while dirty waits for the cook: confirming runs it once and closes the dialog', (_case, request, called) => {
        const given = props({ isDirty: true });
        const { result } = render(given);

        act(() => request(result.current.navigation));

        expect(result.current.discard.open).toBe(true);
        expect(given[called]).not.toHaveBeenCalled();

        act(() => result.current.discard.confirm());

        expect(given[called]).toHaveBeenCalledOnce();
        expect(result.current.discard.open).toBe(false);
    });

    it('keeping on editing closes the dialog and runs nothing', () => {
        const given = props({ isDirty: true });
        const { result } = render(given);

        act(() => result.current.navigation.requestCancel());
        act(() => result.current.discard.keepEditing());

        expect(result.current.discard.open).toBe(false);
        expect(given.onCancel).not.toHaveBeenCalled();
    });

    it('a jump back reaches the step it named', () => {
        const given = props({ step: 3 as RecipeWizardStep });
        const { result } = render(given);

        act(() => result.current.navigation.requestGoToStep(1));

        expect(given.goToStep).toHaveBeenCalledWith(1);
    });

    it('Previous on the first step does nothing', () => {
        const given = props({ step: 1, isDirty: true });
        const { result } = render(given);

        act(() => result.current.navigation.requestGoPrev());

        expect(given.goPrev).not.toHaveBeenCalled();
        expect(result.current.discard.open).toBe(false);
    });
});

describe('useWizardNavigation — a failed ingredient pick is an attempt (E2)', () => {
    it('marks the step that holds the ingredients attempted at each new failure, and only that step', () => {
        const { result, rerender } = render(props({ step: 1 }));

        expect(result.current.navigation.attempted.size).toBe(0);

        rerender(props({ step: 1, pickFailures: 1 }));

        expect([...result.current.navigation.attempted]).toEqual([2]);
    });

    it('marks nothing on a render that brings no new failure, nor for failures counted before it mounted', () => {
        const { result, rerender } = render(props({ step: 1, pickFailures: 3 }));

        rerender(props({ step: 3, pickFailures: 3 }));

        expect(result.current.navigation.attempted.size).toBe(0);
    });
});
