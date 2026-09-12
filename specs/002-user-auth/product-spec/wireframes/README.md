# Wireframes: User Authentication

**Branch**: `002-user-auth`
**Date**: 2026-05-09
**Status**: Draft
**Source**: [product-spec.md](../product-spec.md), [spec.md](../../spec.md)

---

## Scope

This directory only contains wireframes for screens the **app itself renders**.

All authentication flow screens — login, signup, MFA enrollment/challenge, password reset, session-expired re-auth, and the OAuth/PKCE callback bridge — are rendered by **Clerk's hosted UI**. Visual fidelity and accessibility for those flows is owned by Clerk and is out of scope for this directory.

For Clerk theming/branding decisions, see `docs/mockups/` and the design tokens captured in [`docs/mockups/README.md`](../../../../docs/mockups/README.md).

---

## Index

| File                                     | Description                                          | Key FRs                                |
| ---------------------------------------- | ---------------------------------------------------- | -------------------------------------- |
| [mobile-profile.md](./mobile-profile.md) | Mobile profile/account screen (read + edit + delete) | FR-013, FR-014, FR-018, FR-019, FR-020 |

---

## Visual Mockups & Design System

Pixel mockups and the extracted design system live under [`docs/mockups/`](../../../../docs/mockups/):

| Surface           | Mockup                                                                                | Notes                                   |
| ----------------- | ------------------------------------------------------------------------------------- | --------------------------------------- |
| Profile / account | [`screens/screen-profile.html`](../../../../docs/mockups/screens/screen-profile.html) | Reference for `T-053`, `T-063`          |
| Post-auth shell   | [`screens/screen-auth.html`](../../../../docs/mockups/screens/screen-auth.html)       | Authenticated landing / account context |
| Design tokens     | [`README.md`](../../../../docs/mockups/README.md)                                     | Color / typography / spacing scale      |

---

## FR Reference Key

- **FR-013**: Post-registration User creation in DB
- **FR-014**: Post-registration Account creation in DB
- **FR-018**: Read profile from local DB
- **FR-019**: Update profile fields (name, avatar)
- **FR-020**: Soft-delete account request

---

## Usage Notes

- Remaining wireframes are conceptual ASCII layouts for scope and behavior alignment, not pixel-accurate mocks.
- For pixel fidelity, defer to the HTML mockups under `docs/mockups/screens/`.
- Accessibility constraints (NFR-004 / NFR-005) apply to all interactive elements the app renders.
