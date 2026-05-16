---
name: tsdoc
description: Write or revise TSDoc comments in this repository following the project's library-API conventions. Use when adding TSDoc to a new export, auditing existing TSDoc for completeness, or converting inline comments / JSDoc to project-standard TSDoc. Covers public-surface contracts (preconditions, side effects, ownership, `@throws`), cross-module integration points, and the published-package constraints documented in `docs/tsdoc-guidelines.md`.
---

# TSDoc skill

This skill applies the TSDoc conventions for `@kasumimercury/web-crowd-detection-utils`, a published browser-targeted npm package. The full canonical guidelines live in `docs/tsdoc-guidelines.md`; this file is the entry point Claude Code uses, but every rule below points back to that document.

## When to use this skill

Trigger when working on any of the following in this repository:

- Adding TSDoc to a newly exported function, class, interface, or type.
- Reviewing or improving existing TSDoc (filling in missing `@throws`, fixing drift between docs and implementation, replacing vague wording).
- Converting plain comments or partial JSDoc into project-standard TSDoc.
- Documenting cross-module integration points (e.g. `yolo` → `bytetrack`, `source` capturer ↔ reverse-transform pairing).

Do **not** trigger for: internal-only comments inside function bodies (use plain `//` and only when the *why* is non-obvious), changelog entries, or README updates.

## Workflow

1. **Read `docs/tsdoc-guidelines.md` in full** before drafting or editing any TSDoc block. It contains the canonical rules, the tag order, anti-patterns observed in this codebase, and the pre-commit checklist.
2. **Identify the public surface**. Anything reachable via a subpath `index.ts` (`src/<name>/index.ts`) is part of the published API and gets the full treatment. Module-internal helpers get brief docs with `@internal`.
3. **For each export, verify the doc matches the implementation**:
   - Every `throw new Error(...)` has a corresponding `@throws`.
   - Every parameter description matches its declared type (especially type unions like `string | ArrayBufferLike | Uint8Array`).
   - Defaults named in the doc match the actual `?? DEFAULT_*` fallbacks.
4. **Document what types cannot express**: preconditions, side effects, buffer ownership, statefulness, ordering, default-value rationale, integration constraints with neighboring modules.
5. **Add `{@link}` cross-references** when correct use depends on another export (e.g. a capturer paired with a reverse-transform helper).
6. **Run validation** before finishing: `pnpm typecheck`, `pnpm check`, `pnpm test --run`. The `.claude/settings.json` PostToolUse hook also runs `biome check --fix` after each edit, so formatting is auto-applied.

## Key rules (summary — see `docs/tsdoc-guidelines.md` for full text)

- **Summary line is mandatory.** Single sentence, written first. IDE hover leads with it.
- **Tag order**: summary → `@remarks` → `@typeParam` → `@param` → `@returns` → `@throws` → `@example` → `@internal`.
- **`@throws` is mandatory** wherever the code throws. One per distinct condition. State both *when* and *why*.
- **Code fences in `@example` use `ts`.** One `@example` per example; never combine.
- **Field-level TSDoc on every public `interface` / `type` field.**
- **English only.** Convert any Japanese inline comments touched during a TSDoc pass.
- **Never use `Note:`** — use `@remarks`.
- **Never restate the type or name.** The summary must add information the signature cannot.
- **Mark non-exported helpers with `@internal`** when they have a TSDoc block.

## Library-specific reminders

- This package is **published to npm at v0.2.0+**. TSDoc is part of the consumer-facing contract. Changing documented behavior without a version bump is a stealth breaking change.
- The layering rule from `CLAUDE.md` (`onnx` model-agnostic / `yolo` knows formats / `bytetrack` detector-agnostic / `motion` consumes only `Detection`) should be reinforced by TSDoc, never blurred.
- IDE hover is the primary consumption surface. Optimize for short, scannable text.

## Anti-patterns to avoid

These were real defects fixed during the TSDoc audit. See the table in `docs/tsdoc-guidelines.md` for the full list. Highest-impact ones:

- Missing summary line (function description starts with `@param`).
- Missing `@throws` for documented throw conditions.
- `@param` description that does not match the type (e.g. "path to file" for `string | ArrayBufferLike | Uint8Array`).
- Undocumented module-level state (cached buffers, mutable singletons).
- Vague terms like "normalized" — specify the actual operation.
- Restating what the well-named identifier already says, instead of adding contract information.

## Before reporting done

Run the project's checklist from `docs/tsdoc-guidelines.md`:

```
pnpm typecheck && pnpm check && pnpm test --run
```

All three must pass. If you added or changed examples in `@example`, also confirm the snippet would compile against the current API.
