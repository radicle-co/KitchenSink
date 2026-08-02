# Product Spec Index — 004 Recipe Importing

**Regenerated**: 2026-08-02

| Artefact                             | Purpose                                                        |
| ------------------------------------ | -------------------------------------------------------------- |
| [product-spec.md](./product-spec.md) | Vision, personas, MoSCoW story map, scope boundaries           |
| [user-journey.md](./user-journey.md) | Six end-to-end journeys, including failure paths               |
| [metrics.md](./metrics.md)           | North star, quality/reliability/safety metrics, adoption gates |
| [wireframes/](./wireframes/)         | Screen-level specifications                                    |

## Upstream

- [../spec.md](../spec.md) — requirements and owner decisions D-001..D-004
- [../plan.md](../plan.md) — technical plan, pattern register, library survey
- [../tasks.md](../tasks.md) — implementation tasks
- [../v-model/requirements.md](../v-model/requirements.md) — formal requirement set

## What changed in this revision

- Every journey now routes through **draft review** — forced by the shipped recipe schema, not a UX preference.
- **US-408** (review before save) promoted from Should Have to **Must Have**.
- **US-405** (photo import) resolved to **Must Have at launch** (D-001), ending a three-month contradiction
  between this spec and the plan.
- **US-402** (Instagram) marked gated on an external credential (D-002); release does not depend on it.
- **US-411..US-414** added for capabilities that were always implied but never written down: file import,
  draft expiry, source-deleted handling, and blocklist administration.
