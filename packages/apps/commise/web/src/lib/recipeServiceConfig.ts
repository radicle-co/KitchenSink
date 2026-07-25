/**
 * Shared base origin for `@kitchensink/recipe-service-client` (B19). Read from `NEXT_PUBLIC_API_URL` (never
 * hardcoded — CODING_STANDARDS §12), defaulting to the local dev origin (matches `npm run dev`).
 *
 * ONE source of truth, consumed by BOTH the browser client (`RecipeProviders`, via `useAuth().getToken`) and
 * every data page's server-side SSR-prefetch client (`recipes`/`recipes/[id]`/`discover`/`collections`
 * `page.tsx`, via `auth().getToken()`) — so a server prefetch and the client container it hydrates always
 * target the SAME origin, never drifting apart.
 */
export const RECIPE_SERVICE_BASE_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000';
