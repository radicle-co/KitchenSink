/**
 * T046 — request DTO for `POST /api/v1/recipes/{id}/clone` (FR-011 recipe clone).
 *
 * A clone deterministically copies the source recipe's content + attribution and derives the new
 * recipe's visibility from the C-004 clone-default rule, so the request body carries NO client-supplied
 * content — every field is server-derived from the source. This DTO is intentionally empty (an object
 * body with no properties): with the controller-scoped `whitelist` `ValidationPipe`, any stray keys a
 * client sends are stripped rather than trusted. It exists as a typed, forward-compatible extension
 * point (e.g. a future target-collection option) and to keep the endpoint's contract explicit.
 */

/** Body of `POST /api/v1/recipes/{id}/clone` (currently no client-controlled fields). */
export class CloneRecipeDto {}
