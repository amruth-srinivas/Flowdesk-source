# Dark and Midnight Theme Design Guide

This document defines the visual system for `dark` and `midnight` themes only.
Light mode must remain unchanged.

## Goals

- Keep all table surfaces readable and visually coherent with the active theme.
- Preserve clear contrast hierarchy between shell, header, body rows, and hover states.
- Keep status-highlight rows (success/warning/selected) meaningful without neon glare.

## Theme Intent

### Dark

- Balanced low-light UI for long work sessions.
- Slightly warmer, medium-contrast surfaces.
- Calm, readable row highlighting.

### Midnight

- Deeper, cooler palette with stronger separation between layers.
- Crisper table headers and borders.
- Controlled contrast to avoid eye strain.

## Table System Rules

For all DataTables (`.user-table`, tickets table, calendar activities table, KB documents table):

- Use theme tokens for shell/background/borders, never hardcoded light hex values.
- Header row must be one step brighter than body rows for fast scanning.
- Hover state must increase contrast subtly and consistently across modules.
- Alternate row styles should remain visible but minimal.
- Status rows must be theme-native:
  - success rows use muted green tokens
  - warning rows use muted amber tokens
  - selected status rows blend status + selection accents

## Token Contract (Dark + Midnight)

Theme token groups used by tables:

- `--table-shell-bg`
- `--table-shell-border`
- `--table-head-bg`
- `--table-head-border`
- `--table-body-border`
- `--table-row-bg`
- `--table-row-hover-bg`
- `--table-row-alt-bg`
- `--table-row-alt-hover-bg`
- `--table-row-success-bg`
- `--table-row-success-hover-bg`
- `--table-row-warning-bg`
- `--table-row-warning-hover-bg`
- `--table-row-selected-bg`

## Implementation Notes

- Theme overrides are scoped under:
  - `:root[data-app-theme='dark']`
  - `:root[data-app-theme='midnight']`
- No changes should be made to base/light selectors when refining dark or midnight.
- If a new table style is introduced, it must consume the shared table tokens above.
