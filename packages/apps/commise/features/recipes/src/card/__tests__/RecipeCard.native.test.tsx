/**
 * Native component tests for the mockup-parity recipe card (rendered via react-native-web under jsdom).
 * Mirrors the web leaf's coverage — every field and every ABSENT state — but queries the RN accessibility
 * tree (role/label/text), never styles. A broken label, a fabricated rating, or a defaulted difficulty fails.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import { LocaleProvider } from '@commise/i18n/react';

import { makeRecipe } from '../../__fixtures__/index.js';
import { toRecipeCardModel } from '../model.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeCard } from '../RecipeCard.native.js';

afterEach(cleanup);

const model = (over = {}) => toRecipeCardModel(makeRecipe(over));
const renderCard = (ui: React.ReactElement) => render(<LocaleProvider locale="en">{ui}</LocaleProvider>);

describe('RecipeCard (native)', () => {
    it('renders the title, total time, and servings', () => {
        renderCard(<RecipeCard recipe={model({ title: 'Herb Risotto', totalTimeMinutes: 45, servings: 4 })} />);

        expect(screen.getByText('Herb Risotto')).toBeTruthy();
        expect(screen.getByText('45 min')).toBeTruthy();
        expect(screen.getByLabelText('Serves 4')).toBeTruthy();
    });

    it('renders the cover image named by the title', () => {
        renderCard(<RecipeCard recipe={model({ title: 'Herb Risotto', coverPhotoUrl: 'https://cdn/x.jpg' })} />);

        expect(screen.getByRole('img', { name: 'Herb Risotto' })).toBeTruthy();
    });

    it('shows a labelled placeholder (no cover image) when the recipe has no photo', () => {
        renderCard(<RecipeCard recipe={model({ title: 'Herb Risotto', coverPhotoUrl: undefined })} />);

        expect(screen.queryByRole('img', { name: 'Herb Risotto' })).toBeNull();
        expect(screen.getByRole('img', { name: 'No photo yet' })).toBeTruthy();
    });

    it('shows the stated difficulty pill', () => {
        renderCard(<RecipeCard recipe={model({ difficulty: 'hard' })} />);
        expect(screen.getByText('Hard')).toBeTruthy();
    });

    it('renders NO difficulty pill when the author stated none', () => {
        renderCard(<RecipeCard recipe={model({ difficulty: undefined })} />);

        expect(screen.queryByText('Easy')).toBeNull();
        expect(screen.queryByText('Medium')).toBeNull();
        expect(screen.queryByText('Hard')).toBeNull();
    });

    it('shows the PRO badge with an accessible name when premium', () => {
        renderCard(<RecipeCard recipe={model({ usesPremiumCapability: true })} />);

        expect(screen.getByLabelText('Premium recipe')).toBeTruthy();
        expect(screen.getByText('PRO')).toBeTruthy();
    });

    it('renders NO PRO badge when not premium', () => {
        renderCard(<RecipeCard recipe={model({ usesPremiumCapability: false })} />);

        expect(screen.queryByText('PRO')).toBeNull();
    });

    it('exposes a rated recipe as a star image named by the Intl average and pluralized count', () => {
        renderCard(<RecipeCard recipe={model({ averageRating: 4.5, ratingCount: 12 })} />);

        expect(screen.getByRole('img', { name: 'Rated 4.5 out of 5, 12 ratings' })).toBeTruthy();
    });

    it('shows the unrated state (no fabricated stars) when there are no ratings', () => {
        renderCard(<RecipeCard recipe={model({ ratingCount: 0 })} />);

        expect(screen.getByText('Not yet rated')).toBeTruthy();
        expect(screen.queryByRole('img', { name: /Rated/ })).toBeNull();
    });

    it('is non-interactive (no button) when no onSelect is given (the Home widget card)', () => {
        renderCard(<RecipeCard recipe={model({ title: 'Herb Risotto' })} />);

        expect(screen.queryByRole('button')).toBeNull();
    });

    it('is an actionable button reporting the recipe id when onSelect is given (the list card)', () => {
        const onSelect = vi.fn();
        renderCard(<RecipeCard recipe={model({ id: 'rec_42', title: 'Herb Risotto' })} onSelect={onSelect} />);

        fireEvent.click(screen.getByRole('button', { name: 'Herb Risotto' }));

        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect).toHaveBeenCalledWith('rec_42');
    });
});

describe('RecipeCard (native) — merged fields (CR-002 / L2·L3)', () => {
    it('renders the cuisine when present, and nothing when absent', () => {
        renderCard(<RecipeCard recipe={model({ cuisine: 'Mediterranean' })} />);
        expect(screen.getByText('Mediterranean')).toBeTruthy();

        cleanup();
        renderCard(<RecipeCard recipe={model({ cuisine: undefined, title: 'No Cuisine' })} />);
        expect(screen.queryByText('Mediterranean')).toBeNull();
    });

    it('renders the localized calorie line when present, and none when absent', () => {
        renderCard(<RecipeCard recipe={model({ leadCaloriesPerServing: 420 })} />);
        expect(screen.getByText('420 cal')).toBeTruthy();

        cleanup();
        renderCard(<RecipeCard recipe={model({ leadCaloriesPerServing: undefined, title: 'No Cal' })} />);
        expect(screen.queryByText(/cal$/)).toBeNull();
    });

    it('renders each tag as a chip', () => {
        renderCard(<RecipeCard recipe={model({ tags: ['grill', 'summer'] })} />);

        expect(screen.getByText('grill')).toBeTruthy();
        expect(screen.getByText('summer')).toBeTruthy();
    });

    it('shows the version badge past v1 and hides it at v1', () => {
        renderCard(<RecipeCard recipe={model({ currentVersion: 12 })} />);
        expect(screen.getByText('v12')).toBeTruthy();

        cleanup();
        renderCard(<RecipeCard recipe={model({ currentVersion: 1 })} />);
        expect(screen.queryByText('v1')).toBeNull();
    });

    it('shows a visibility badge (Public / Private) for a published recipe', () => {
        renderCard(<RecipeCard recipe={model({ visibility: 'public', status: 'published' })} />);
        expect(screen.getByText('Public')).toBeTruthy();

        cleanup();
        renderCard(<RecipeCard recipe={model({ visibility: 'private', status: 'published' })} />);
        expect(screen.getByText('Private')).toBeTruthy();
    });

    it('shows a Draft badge that REPLACES the visibility badge for a draft', () => {
        renderCard(<RecipeCard recipe={model({ visibility: 'public', status: 'draft' })} />);

        expect(screen.getByText('Draft')).toBeTruthy();
        expect(screen.queryByText('Public')).toBeNull();
        expect(screen.queryByText('Private')).toBeNull();
    });
});
