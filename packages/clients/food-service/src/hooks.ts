/**
 * React hooks for `@kitchensink/food-service-client` (plan 002 S5): the provider and the reads the apps make of
 * food-service directly. Import them from the `./hooks` subpath, so a non-React consumer of the plain client never
 * pulls React in. `react` and `@tanstack/react-query` are provided by the consuming app, which owns the
 * `QueryClientProvider`.
 */
export { FoodServiceProvider, useFoodServiceClient } from './hooks/foodServiceProvider.js';
export type { FoodServiceProviderProps } from './hooks/foodServiceProvider.js';
export { useAdoptRemoteFood } from './hooks/useAdoptRemoteFood.js';
export { useCreateAuthoredFood } from './hooks/useCreateAuthoredFood.js';
export { useDataSources } from './hooks/useDataSources.js';
export { useFood } from './hooks/useFood.js';
export { useFoodServiceSubject } from './hooks/useFoodServiceSubject.js';
export { useProgressiveFoodSearch } from './hooks/useProgressiveFoodSearch.js';
export { foodQueries, foodServiceKeys } from './queries.js';
