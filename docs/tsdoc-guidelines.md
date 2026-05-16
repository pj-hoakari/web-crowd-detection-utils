# TSDoc Guidelines

Conventions for writing TSDoc in this repository. Applies to every `src/` file that contributes to the published surface (`@kasumimercury/web-crowd-detection-utils`).

This document is **tool-neutral** — Claude Code, GitHub Copilot, and human contributors should all follow it. Claude Code loads it via `.claude/skills/tsdoc/SKILL.md`; other agents can reference it directly.

## Why TSDoc matters here

This package is **published to npm** and consumed by applications we do not control. A TSDoc comment is not a code comment — it is the contract that appears in the consumer's IDE hover tooltip, in their AI assistant's context, and in any generated reference site. Once shipped, the documented behavior is part of the API; changing it without a version bump breaks consumers silently.

The bar is therefore higher than for internal code:

- **Document contracts the type system cannot express** (preconditions, side effects, ownership, exception conditions).
- **Document the relationship to neighboring modules** when correct use depends on it (e.g., capturer ↔ reverse-transform pairing).
- **Never let the doc drift from the implementation**. If a function throws, `@throws` must say so. If a default changes, the doc changes too.

## Structure

### Tag order

```
Summary line (required, single sentence)

@remarks               (multi-paragraph context, non-obvious behavior)
@typeParam             (for generics)
@param                 (one per parameter)
@returns
@throws                (one per distinct throw condition)
@example               (one per example, never combine)
@internal              (last, for non-exported helpers)
```

### Summary line is mandatory

The first line of every TSDoc block is a short summary. IDE hover shows this first; without it, the popup leads with `@param` and becomes unreadable.

**Good:**

```ts
/**
 * Converts RGBA pixel data from an `ImageData` object to a `Float32Array` in CHW format,
 * scaled to the range `[0, 1]` by dividing by 255.
 *
 * @param imageData - ...
 */
```

**Bad:**

```ts
/**
 *
 * @param imageData - ...
 */
```

### Code fences in `@example`

Always specify the `ts` language identifier so syntax highlighting works in IDE hover and generated docs.

```ts
/**
 * @example
 * ```ts
 * const buffer = createPreprocessBuffer(640);
 * ```
 */
```

### Multiple examples

Use a separate `@example` tag per example. Never combine into a single block.

```ts
/**
 * @example
 * Per-call allocation:
 * ```ts
 * const a = rgbaToFloat32Chw(frame);
 * ```
 *
 * @example
 * Reused buffer:
 * ```ts
 * const buffer = createPreprocessBuffer(640);
 * for (const frame of frames) rgbaToFloat32Chw(frame, { buffer });
 * ```
 */
```

## Content rules

### 1. Document the contract, not the code

Well-named identifiers already say *what* the code does. TSDoc must say what the type system cannot:

- **Preconditions** — "`imageData.width` and `imageData.height` must equal `inputSize`."
- **Side effects** — "Mutates internal track lists." / "Returned buffer is overwritten by the next call."
- **Ownership** — "Caller-owned buffer; the function writes into and returns the same instance."
- **Order / cascade** — Stage 1 → Stage 2 → Stage 3 in ByteTrack, sigmoid auto-detection in YOLO postprocess.
- **Defaults and their rationale** — "`DEFAULT_CLASS_FILTER = [0]` (COCO person), matching this package's crowd-detection focus."

If a reader needs the source to use the API correctly, the TSDoc is incomplete.

### 2. `@throws` is mandatory when code throws

Every `throw new Error(...)` in a public function needs a corresponding `@throws`. Forgetting this is the most common defect.

```ts
/**
 * @throws {Error} When `executionProvider` is `"webgpu"` but `navigator.gpu` is unavailable
 *   (e.g. unsupported browser, or executed in an SSR/Node environment).
 * @throws Re-throws any error from `InferenceSession.create`, such as invalid model bytes,
 *   failed model fetch, or execution provider initialization failure.
 */
```

Each distinct condition gets its own `@throws`. Include the condition (when) and any non-obvious cause (why).

### 3. `@param` text must match the actual type

If a parameter accepts `string | ArrayBufferLike | Uint8Array`, the description must reflect that. "The path to the model file" is wrong when raw bytes are also accepted.

### 4. Be specific where it matters

Vague terms hide bugs. "Normalized RGB data" could mean `[0, 1]` scaling, ImageNet mean/std, or per-channel z-score. Write the actual operation:

> scaled to the range `[0, 1]` by dividing by 255

### 5. Document integration points

When correct use of an API depends on another module, say so:

- `Detection` (yolo) → `Observation` (bytetrack): "Structurally compatible; can be passed without remapping."
- `createLetterboxCapturer` ↔ `reverseLetterboxBox`: "Pair this with...; for stretched captures, use `reverseStretchBox` instead — the two transforms are not interchangeable."
- `createYoloDetector` returns detections in **model input space**; document the requirement to apply `reverseLetterboxBox` / `reverseStretchBox` from the `source` subpath.

Use `{@link OtherName}` for cross-references so IDE navigation works.

### 6. `@remarks` for non-obvious behavior

Use `@remarks` for things a reader would not infer from the signature:

- Initial-load cost ("first call pays bundle fetch + WASM init, possibly seconds")
- Auto-detection heuristics (sigmoid detection in `postprocessStandard`)
- Statefulness and reset semantics
- Browser-only DOM dependency
- SSR-safety guarantees

Never write `Note:` — TSDoc has `@remarks` for exactly this.

## Style rules

### English only

The published package is consumed internationally and IDE rendering / doc generation assumes a single language. Convert any Japanese inline comments touched during a TSDoc pass.

### Don't restate the type

```ts
// Bad — the type already says it's a number
/** @param inputSize - The input size as a number */

// Good — what does it mean?
/** @param inputSize - Square edge length of the input image, in pixels. */
```

### Don't narrate the implementation

```ts
// Bad
/** Loops through every pixel and divides by 255 to get a float in [0,1]. */

// Good
/** Scaled to `[0, 1]` by dividing by 255. */
```

### Field-level docs on public interfaces

Every field of an exported `interface` / `type` should have inline TSDoc. This is what IDE autocomplete shows when typing a field name.

```ts
export interface LetterboxParams {
	/** Square edge length of the model input, in pixels. */
	inputSize: number;
	/** Uniform scale factor: `min(inputSize / sourceWidth, inputSize / sourceHeight)`. */
	scale: number;
	// ...
}
```

### `@internal` for non-exported helpers

Module-local helpers that need a TSDoc block (typically to explain a non-obvious algorithm step) should be tagged `@internal`. This signals to developers that the function is not part of the API surface.

## Anti-patterns observed in this codebase

These were real defects found during the TSDoc audit. Don't reintroduce them.

| Anti-pattern | Example | Fix |
|---|---|---|
| Missing summary | `/** @returns true if ... */` | Add a single-sentence summary as the first line. |
| Missing `@throws` | Function throws on bad input but doc omits it | Add one `@throws` per distinct condition. |
| Doc-implementation drift | Doc says "path to file" but param accepts `ArrayBuffer` too | Match the actual type union. |
| Vague terms | "normalized RGB data" | Specify the operation: "scaled to `[0, 1]` by dividing by 255". |
| `Note:` instead of `@remarks` | `* Note: This function does not...` | Use `@remarks`. |
| Combined `@example` | Two unrelated snippets in one block | Split into separate `@example` tags. |
| Undocumented module state | Returns cached buffer without saying so | Document the caching behavior and its lifetime / aliasing implications. |
| Restating the type | `@param x - A number` | Say what `x` represents semantically. |
| Restating the name | `/** Creates a preprocess buffer. */ createPreprocessBuffer` | The summary should add information the name does not. |
| Missing cross-module pairing | `reverseLetterboxBox` without mentioning `createLetterboxCapturer` | Add `{@link}` and explain the pairing constraint. |

## Library-specific reminders

- **Published version is a contract.** Changing TSDoc-documented behavior without bumping the version is a stealth breaking change. When fixing a defect, ask: was the previous behavior documented? If yes, the fix is breaking.
- **IDE hover is the primary consumption surface.** Optimize for short, scannable text. Multi-paragraph `@remarks` are fine when warranted, but the summary line carries most of the weight.
- **The layering rule (`onnx` model-agnostic / `yolo` knows formats / `bytetrack` detector-agnostic / `motion` consumes only `Detection`) is documented in `CLAUDE.md`.** TSDoc should reinforce these boundaries, never blur them.

## Checklist before committing

For every public function, class, interface, or type added or modified:

- [ ] Summary line present, single sentence, written first.
- [ ] `@param` for every parameter, describing semantics not type.
- [ ] `@returns` present (omit only for `void`).
- [ ] `@throws` for every distinct throw condition the implementation has.
- [ ] `@remarks` for any side effect, default rationale, statefulness, or non-obvious algorithm.
- [ ] `@example` for any API with non-trivial usage; code fences include `ts`.
- [ ] `{@link}` cross-references to paired/related APIs in other subpaths.
- [ ] No `Note:`, no Japanese, no restatement of the type.
- [ ] Public `interface` / `type` fields have inline TSDoc.
- [ ] Non-exported helpers with TSDoc are marked `@internal`.
- [ ] `pnpm typecheck`, `pnpm check`, and `pnpm test --run` all pass.
