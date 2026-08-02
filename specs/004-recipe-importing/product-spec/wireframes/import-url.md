# Wireframe: Import from URL

**Branch**: `004-recipe-importing` | **Date**: 2026-05-09
**FRs**: [FR-008](../../spec.md#fr-008), [FR-009](../../spec.md#fr-009), [NFR-003](../../spec.md#non-functional-requirements-constitution-derived), [NFR-004](../../spec.md#non-functional-requirements-constitution-derived)

**Platforms**: web + mobile — this screen ships to both in the same release (`CODING_STANDARDS §14.1`).

---

## ASCII Wireframe

```
+--------------------------------------------------------------------------+
|  Commise                                [Morgan ▼] [Settings]           |
+--------------------------------------------------------------------------+
|                                                                          |
|  Import Recipe                                                           |
|                                                                          |
|  [ URL Import ] [ Instagram Import ] [ File Upload ] [ Manual Paste ]    |
|                                                                          |
|  Source URL                                                               |
|  +--------------------------------------------------------------------+  |
|  | https://www.example.com/recipes/chicken-teriyaki                  |  |
|  +--------------------------------------------------------------------+  |
|                                                                          |
|  [ Import Recipe ]   [ Clear ]                                           |
|                                                                          |
|  Status: [⏳ Parsing] Fetching HTML → Extracting JSON-LD → Validating     |
|  (Status always shown as icon + text label, never color alone)          |
|                                                                          |
|  Help:                                                                    |
|  - Supports public recipe URLs and Instagram post URLs                    |
|  - Unsupported Instagram posts (no caption recipe text) show explicit error|
|                                                                          |
+--------------------------------------------------------------------------+
```
