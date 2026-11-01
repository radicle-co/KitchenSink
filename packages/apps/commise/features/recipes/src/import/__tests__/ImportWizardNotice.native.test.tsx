/**
 * Native component tests for `ImportWizardNotice`, rendered through react-native-web under jsdom: the same component,
 * over the design system's native notice leaves. Mirrors `ImportWizardNotice.test.tsx`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

// ONE component for both platforms: its notices resolve to their native leaves here.
import { ImportWizardNotice } from '../ImportWizardNotice.js';
import { importMessages } from '../messages.js';
import { render } from '@commise/ui/testing/tamagui';

const w = importMessages.en.wizard;

afterEach(cleanup);

describe('ImportWizardNotice (native)', () => {
    it('loading: names the recipe being read', () => {
        render(<ImportWizardNotice kind="loading" position={15} total={309} />);

        expect(screen.getByRole('progressbar', { name: 'Reading recipe 15 of 309…' })).toBeTruthy();
    });

    it('error: names the recipe, with Try again and Skip this recipe', () => {
        const onRetry = vi.fn();
        const onSkip = vi.fn();
        render(<ImportWizardNotice kind="error" recipeTitle="Lentil soup" onRetry={onRetry} onSkip={onSkip} />);

        expect(screen.getByText('We couldn’t load Lentil soup')).toBeTruthy();
        expect(screen.getByText(w.errorBody)).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: w.retry }));
        fireEvent.click(screen.getByRole('button', { name: w.skipRecipe }));

        expect(onRetry).toHaveBeenCalledTimes(1);
        expect(onSkip).toHaveBeenCalledTimes(1);
    });

    it('offline: says the review resumes by itself, and offers no control', () => {
        render(<ImportWizardNotice kind="offline" />);

        expect(screen.getByText(w.offline)).toBeTruthy();
        expect(screen.queryByRole('button')).toBeNull();
    });
});
