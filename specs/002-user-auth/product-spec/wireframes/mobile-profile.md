# Wireframe: Mobile Profile

**Date**: 2026-06-01
**Key FRs**: FR-018, FR-019, FR-020, FR-021, FR-022, NFR-004, NFR-005, NFR-016

---

```text
+----------------------------------------+
| Profile                                |
|----------------------------------------|
|                                        |
|  [ Avatar ]                            |
|  Display Name                          |
|  Email                                 |
|                                        |
|  [ Edit Profile ]                      |
|  [ Account Settings ]                  |
|  [ Delete Account ]                    |
|                                        |
+----------------------------------------+
```

## States

### Loading — Profile Fetch

```text
+----------------------------------------+
|                                        |
|           [ spinner ]                  |
|                                        |
|         Loading profile...             |
|                                        |
+----------------------------------------+
```

- Accessible label: "Loading your profile"

### Edit Mode — Avatar Upload

```text
+----------------------------------------+
|                                        |
|  [ Avatar preview ]                    |
|                                        |
|  [ Upload New Photo ]                  |
|                                        |
|  Display Name [ ________ ]           |
|                                        |
|  [ Save Changes ]  [ Cancel ]         |
|                                        |
+----------------------------------------+
```

### Loading — Saving Profile

```text
+----------------------------------------+
|                                        |
|           [ spinner ]                  |
|                                        |
|        Saving changes...               |
|                                        |
+----------------------------------------+
```

- Accessible label: "Saving your changes, please wait"

### Error — Validation

```text
+----------------------------------------+
|                                        |
|   Avatar must be ≤5 MB, JPEG/PNG/WebP  |
|                                        |
+----------------------------------------+
```

## Interaction Notes

- Touch targets ≥44×44px (NFR-016).
- Color contrast WCAG 2.1 AA (NFR-004).
- Screen reader landmarks: `main`, `status` region for loading and error messages (NFR-005).
- Avatar upload enforces 5 MB limit and JPEG/PNG/WebP MIME types (FR-020, FR-021).
- Profile read is from `GET /v1/users/me` (FR-018).
- Profile update is via `PATCH /v1/users/me` (FR-019).
- Account deletion navigates to confirmation flow (FR-022).
