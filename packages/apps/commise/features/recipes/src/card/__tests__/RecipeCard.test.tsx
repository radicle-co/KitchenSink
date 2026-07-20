// @vitest-environment jsdom
/**
 * Component tests for the web mockup-parity recipe card — every field and every state the mockup's list /
 * "Recent recipes" cards show, plus the domain's ABSENT states the mockup never depicts. Asserts on visible
 * text and accessible names (role/label), never on CSS classes, so a broken label, a fabricated rating, or a
 * defaulted difficulty fails — but a restyle does not.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import { LocaleProvider } from '@commise/i18n/react';

import { makeRecipe } from '../../__fixtures__/index.js';
import { toRecipeCardModel } from '../model.js';
import { RecipeCard } from '../RecipeCard.js';

afterEach(cleanup);

const model = (over = {}) => toRecipeCardModel(makeRecipe(over));

const renderCard = (ui: React.ReactElement) => render(<LocaleProvider locale="en">{ui}</LocaleProvider>);

describe('RecipeCard (web)', () => {
    it('renders the title and names the card (article) by it', () => {
        renderCard(<RecipeCard recipe={model({ title: 'Herb Risotto' })} />);

        expect(screen.getByText('Herb Risotto')).toBeTruthy();
        expect(screen.getByRole('article', { name: 'Herb Risotto' })).toBeTruthy();
    });

    it('renders the total time and the servings count', () => {
        renderCard(<RecipeCard recipe={model({ totalTimeMinutes: 45, servings: 4 })} />);

        expect(screen.getByText('45 min')).toBeTruthy();
        expect(screen.getByLabelText('Serves 4')).toBeTruthy();
    });

    it('renders the cover photo with the title as its alt text', () => {
        renderCard(<RecipeCard recipe={model({ title: 'Herb Risotto', coverPhotoUrl: 'https://cdn/x.jpg' })} />);

        const img = screen.getByRole('img', { name: 'Herb Risotto' });
        expect(img.getAttribute('src')).toBe('https://cdn/x.jpg');
    });

    it('shows a labelled placeholder (no img) when the recipe has no photo', () => {
        renderCard(<RecipeCard recipe={model({ title: 'Herb Risotto', coverPhotoUrl: undefined })} />);

        expect(screen.queryByRole('img', { name: 'Herb Risotto' })).toBeNull();
        expect(screen.getByLabelText('No photo yet')).toBeTruthy();
    });

    it('shows the difficulty pill with the stated difficulty label', () => {
        renderCard(<RecipeCard recipe={model({ difficulty: 'easy' })} />);
        expect(screen.getByText('Easy')).toBeTruthy();

        cleanup();
        renderCard(<RecipeCard recipe={model({ difficulty: 'hard' })} />);
        expect(screen.getByText('Hard')).toBeTruthy();
    });

    it('renders NO difficulty pill when the author stated none (never a default "Medium")', () => {
        renderCard(<RecipeCard recipe={model({ difficulty: undefined })} />);

        expect(screen.queryByText('Easy')).toBeNull();
        expect(screen.queryByText('Medium')).toBeNull();
        expect(screen.queryByText('Hard')).toBeNull();
    });

    it('shows the PRO badge (with an accessible name) when the recipe uses a premium capability', () => {
        renderCard(<RecipeCard recipe={model({ usesPremiumCapability: true })} />);

        expect(screen.getByLabelText('Premium recipe')).toBeTruthy();
        expect(screen.getByText('PRO')).toBeTruthy();
    });

    it('renders NO PRO badge when the recipe does not use a premium capability', () => {
        renderCard(<RecipeCard recipe={model({ usesPremiumCapability: false })} />);

        expect(screen.queryByText('PRO')).toBeNull();
        expect(screen.queryByLabelText('Premium recipe')).toBeNull();
    });

    it('exposes a rated recipe as a star image named by the Intl-formatted average and pluralized count', () => {
        renderCard(<RecipeCard recipe={model({ averageRating: 4.5, ratingCount: 12 })} />);

        expect(screen.getByRole('img', { name: 'Rated 4.5 out of 5, 12 ratings' })).toBeTruthy();
    });

    it('pluralizes a single rating in the accessible summary', () => {
        renderCard(<RecipeCard recipe={model({ averageRating: 5, ratingCount: 1 })} />);

        expect(screen.getByRole('img', { name: 'Rated 5.0 out of 5, 1 rating' })).toBeTruthy();
    });

    it('shows the unrated state (no fabricated stars/score) when there are no ratings', () => {
        renderCard(<RecipeCard recipe={model({ ratingCount: 0 })} />);

        expect(screen.getByText('Not yet rated')).toBeTruthy();
        // No star-rating image is rendered — an unrated recipe has no average to depict.
        expect(screen.queryByRole('img', { name: /Rated/ })).toBeNull();
    });

    it('is a non-interactive article when no onSelect is given (the Home widget card)', () => {
        renderCard(<RecipeCard recipe={model({ title: 'Herb Risotto' })} />);

        expect(screen.queryByRole('button')).toBeNull();
        expect(screen.getByRole('article', { name: 'Herb Risotto' })).toBeTruthy();
    });

    it('is an actionable button reporting the recipe id when onSelect is given (the list card)', () => {
        const onSelect = vi.fn();
        renderCard(<RecipeCard recipe={model({ id: 'rec_42', title: 'Herb Risotto' })} onSelect={onSelect} />);

        const button = screen.getByRole('button', { name: 'Herb Risotto' });
        fireEvent.click(button);

        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect).toHaveBeenCalledWith('rec_42');
    });

    it('keeps the meta (time/servings) inside the card region', () => {
        renderCard(<RecipeCard recipe={model({ title: 'Herb Risotto', totalTimeMinutes: 35 })} />);

        const region = screen.getByRole('article', { name: 'Herb Risotto' });
        expect(within(region).getByText('35 min')).toBeTruthy();
    });
});

describe('RecipeCard (web) — merged fields (CR-002 / L2·L3)', () => {
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

    it('shows the version badge past v1 (with an accessible name), and hides it at v1', () => {
        renderCard(<RecipeCard recipe={model({ currentVersion: 12 })} />);
        expect(screen.getByLabelText('Version 12').textContent).toBe('v12');

        cleanup();
        renderCard(<RecipeCard recipe={model({ currentVersion: 1 })} />);
        expect(screen.queryByLabelText('Version 1')).toBeNull();
    });

    it('shows a visibility badge (Public / Private) for a published recipe', () => {
        renderCard(<RecipeCard recipe={model({ visibility: 'public', status: 'published' })} />);
        expect(screen.getByText('Public')).toBeTruthy();

        cleanup();
        renderCard(<RecipeCard recipe={model({ visibility: 'private', status: 'published' })} />);
        expect(screen.getByText('Private')).toBeTruthy();
    });

    it('shows a Draft badge that REPLACES the visibility badge for a draft (never "Public" on a draft)', () => {
        // A free-tier draft carries visibility='public' but is community-invisible — showing "Public" misleads.
        renderCard(<RecipeCard recipe={model({ visibility: 'public', status: 'draft' })} />);

        expect(screen.getByText('Draft')).toBeTruthy();
        expect(screen.queryByText('Public')).toBeNull();
        expect(screen.queryByText('Private')).toBeNull();
    });
});
