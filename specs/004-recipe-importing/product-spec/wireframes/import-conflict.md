# Wireframe: Duplicate Import Conflict

**Branch**: `004-recipe-importing` | **Date**: 2026-05-09
**FRs**: [FR-008](../../spec.md#fr-008), [FR-011](../../spec.md#fr-011)

**Platforms**: web + mobile — this screen ships to both in the same release (`CODING_STANDARDS §14.1`).

---

## ASCII Wireframe

```
+--------------------------------------------------------------------------+
|  Import Conflict: Source Already Imported                                |
+--------------------------------------------------------------------------+
|                                                                          |
|  [⚠] This source URL already exists in Commise.                        |
|                                                                          |
|  Existing Recipe                                                         |
|  +--------------------------------------------------------------------+  |
|  | Title: Chicken Teriyaki                                             |  |
|  | Source: https://www.allrecipes.com/recipe/...                       |  |
|  | Visibility: Public                                                   |  |
|  | Attribution: Locked                                                  |  |
|  +--------------------------------------------------------------------+  |
|                                                                          |
|  Actions                                                                  |
|  [ Clone Existing Recipe ]   [ View Existing ]   [ Cancel ]              |
|                                                                          |
|  Note: Duplicate creation is blocked to preserve canonical attribution.  |
|                                                                          |
+--------------------------------------------------------------------------+
```
