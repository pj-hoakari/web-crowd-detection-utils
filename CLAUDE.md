# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Purpose

This package extracts the `src/lib/` modules of `web-crowd-detection-sandbox` into a reusable, browser-targeted TypeScript npm package. The sandbox's `lib/` is the **source of truth** for the implementation — the work in this repo is to lift each module out, generalize where the sandbox cut corners, and publish them as independent entry points.

## Status

**Environment-only.** Tooling is configured (build, test, lint, typecheck all pass on an empty `src/index.ts`). No module has been ported yet. Subpath exports, peer dependencies, and per-module `tsdown` entries are added **incrementally as each module is implemented**, not up-front.

## Modules to extract (from sandbox `src/lib/`)

Each becomes an independent subpath export (e.g. `web-crowd-detection-utils/yolo`):

- `bytetrack` — ByteTrack multi-object tracker (STrack, Kalman, Hungarian, 3-stage association). Detector-agnostic; consumes `Observation = {x1,y1,x2,y2,score}`.
- `yolo` — YOLO-specific postprocess (3-format auto-dispatch: end-to-end `[N,6]` / transposed / standard `[attrs,N]`), NMS, person-class filter. Entry point in sandbox: `detectPersons(session, imageData, confThreshold)`.
- `onnx` — Model-agnostic ONNX Runtime Web wrapper: session creation, backend selection (WebGPU primary / WASM fallback), RGBA→CHW preprocess.
- `background` — EMA background-subtraction model for static-detection suppression (ported from sandbox `motion`, renamed because it models the background rather than detecting motion). Detector-agnostic: consumes its own `ScoredBox = {x1,y1,x2,y2,score}`, not the YOLO `Detection`.
- `render` — Canvas bounding-box drawing with per-track colors.
- `source` — Camera / video-file input and per-frame capture.
- `lines` — Line-related geometric utilities.

**Layering rule (preserve from sandbox):** `onnx` is model-agnostic, `yolo` is the only layer that knows YOLO output formats, `bytetrack` is detector-agnostic, `background` is detector-agnostic (operates on its own `ScoredBox`, never imports a YOLO type). When porting, keep these boundaries — do not let YOLO specifics leak into `onnx`, do not let detector specifics leak into `bytetrack`.

## Commands

- `pnpm build` — `tsdown` → `dist/` (ESM only, `target: es2023`, `platform: browser`, `.d.ts` included)
- `pnpm typecheck` — `tsc --noEmit`
- `pnpm check` / `pnpm fix` — Biome lint + format (check / autofix)
- `pnpm test` / `pnpm test:watch` / `pnpm test:coverage` — Vitest (happy-dom env)

A PostToolUse hook in `.claude/settings.json` runs `biome check --fix` automatically after each Edit/Write/MultiEdit on files inside this repo.

## Adding a new module (workflow)

When porting a module from sandbox `src/lib/<name>/` (e.g. `yolo`):

1. Create `src/<name>/` with the ported sources and a barrel `src/<name>/index.ts`.
2. Add the entry to `tsdown.config.ts`:
   ```ts
   entry: ["src/index.ts", "src/<name>/index.ts"],
   ```
3. Add the subpath export to `package.json#exports`:
   ```json
   "./<name>": {
     "types": "./dist/<name>/index.d.ts",
     "import": "./dist/<name>/index.js"
   }
   ```
4. Decide how to declare any runtime dep:
   - Default to `dependencies` so consumer projects don't need to declare it themselves and version drift is impossible. `onnxruntime-web` is managed this way.
   - Use `peerDependency` (with `peerDependenciesMeta.optional: true` when only some subpaths require it) only when the host app legitimately needs to control the version (e.g. a framework like React).
5. Add Vitest specs as `src/<name>/**/*.{test,spec}.ts`.

Do not pre-create empty entries or stub exports for modules that have not been ported yet — the user's policy is "add per-module configuration when implementation begins, not before."

## Conventions

- **Biome:** tabs, double quotes, `organizeImports: on`. Same rules as sandbox.
- **TypeScript:** `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `moduleResolution: bundler`, target `es2023`. Path alias `@/*` → `src/*`.
- **Output:** ESM only, no CJS. The package is browser-first; pure-logic modules (`bytetrack`, `lines`) are isomorphic, but the package as a whole is not designed for Node consumers.
- **Side effects:** `package.json` declares `sideEffects: false` — keep it true. No top-level statements with side effects in modules.
- **Tree-shake & code-split:** tsdown's defaults (`treeshake: true`, splitting always on) are relied upon. Don't add re-export-everything barrels at the package root that would defeat per-subpath tree shaking — use the subpath exports.
- **Runtime deps via `dependencies` by default** so consumers don't need to redeclare them. `onnxruntime-web` is owned by this package; consumer apps must not add it themselves (version drift risk). Reserve `peerDependencies` for cases where the host app must control the version (e.g. a framework like React).

## Tooling notes

- **Bundler:** `tsdown` (Rolldown + oxc), not tsup. tsup was the original choice but has been deprecated by its author in favor of tsdown. tsdown auto-detects `dts` from `package.json#types` and reads target from `engines.node`; the explicit `target: "es2023"` and `platform: "browser"` in `tsdown.config.ts` override that for browser output.
- **Why no `ignoreDeprecations` in tsconfig:** tsup needed `"ignoreDeprecations": "6.0"` because it injected `baseUrl` (deprecated in TS 6) into its dts pipeline. tsdown's pipeline does not, so the option is intentionally absent — do not re-add it without reason.
- **pnpm built dependencies:** `package.json#pnpm.onlyBuiltDependencies` gates which postinstall scripts are allowed. Only `esbuild` is approved (transitive dep). Add to that list rather than running `pnpm approve-builds` interactively.
