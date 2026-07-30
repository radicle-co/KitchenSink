/**
 * Shared base origin for `@kitchensink/recipe-service-client` (B19), resolved from the validated
 * configuration in `@/config/env` — never hardcoded (CODING_STANDARDS §12) and, deliberately, never
 * defaulted.
 *
 * ONE source of truth, consumed by BOTH the browser client (`RecipeProviders`, via `useAuth().getToken`) and
 * every data page's server-side SSR-prefetch client (`recipes`/`recipes/[id]`/`discover`/`collections`
 * `page.tsx`, via `auth().getToken()`) — so a server prefetch and the client container it hydrates always
 * target the SAME origin, never drifting apart.
 *
 * This used to read `process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000'`. Because `NEXT_PUBLIC_*`
 * is inlined at BUILD time, that fallback was compiled into the deployed preview bundle and every visitor's
 * browser called its OWN machine. The default is gone: an unconfigured build now fails loudly instead of
 * shipping a bundle that points nowhere useful. See `@/config/env`.
 */
import { env } from '@/config/env';

export const RECIPE_SERVICE_BASE_URL = env.NEXT_PUBLIC_RECIPE_API_URL;
