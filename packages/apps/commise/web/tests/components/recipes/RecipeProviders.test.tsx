// @vitest-environment jsdom
/**
 * Component test for the web `RecipeProviders` Facade (DA10-a) — proves the composed provider tree
 * actually wires a `QueryClientProvider` + the recipe-service client (`RecipeServiceProvider`) above
 * `children`, the invariant the mobile `AppProviders` test pins on the native side. `@clerk/nextjs` is
 * mocked (no real Clerk session needed); a probe child reads `useQueryClient` and `useRecipeServiceClient`
 * — both throw/return `undefined` outside their own provider — so a successful render proves the tree.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { useQueryClient } from '@tanstack/react-query';
import { useRecipeServiceClient } from '@kitchensink/recipe-service-client/hooks';

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));

vi.mock('@clerk/nextjs', () => ({ useAuth: useAuthMock }));

import { RecipeProviders } from '@/components/recipes/RecipeProviders';

beforeEach(() => {
    useAuthMock.mockReturnValue({ getToken: vi.fn().mockResolvedValue('tok_abc') });
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

/** Reads from every context `RecipeProviders` is supposed to mount, and renders what it found. */
function ContextProbe() {
    const queryClient = useQueryClient();
    const client = useRecipeServiceClient();

    return <span>{[queryClient ? 'query' : 'no-query', client ? 'recipe' : 'no-recipe'].join(',')}</span>;
}

describe('RecipeProviders (DA10-a facade)', () => {
    it('mounts a QueryClientProvider and the recipe-service client above children', () => {
        render(
            <RecipeProviders>
                <ContextProbe />
            </RecipeProviders>,
        );

        expect(screen.getByText('query,recipe')).toBeInTheDocument();
    });

    it('throws if a child tries to read the recipe-service client OUTSIDE the tree (order is load-bearing)', () => {
        function Unwrapped() {
            useRecipeServiceClient();

            return null;
        }

        expect(() => render(<Unwrapped />)).toThrow(/RecipeServiceProvider/);
    });
});
