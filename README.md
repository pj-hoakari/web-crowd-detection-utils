# @pj-hoakari/web-crowd-detection-utils

Browser-targeted TypeScript building blocks for in-browser YOLO + ByteTrack crowd / person detection.

## Subpaths

| Import                                              | Purpose                                                                  |
| --------------------------------------------------- | ------------------------------------------------------------------------ |
| `@pj-hoakari/web-crowd-detection-utils/yolo`     | High-level `createYoloDetector`, low-level `postprocess` / `nms`         |
| `@pj-hoakari/web-crowd-detection-utils/onnx`     | `onnxruntime-web` wrapper: `initSession`, `createPreprocessor`           |
| `@pj-hoakari/web-crowd-detection-utils/source`   | Letterbox / stretch capture and reverse-transform helpers                |
| `@pj-hoakari/web-crowd-detection-utils/bytetrack` | Detector-agnostic `BYTETracker` multi-object tracker                    |
| `@pj-hoakari/web-crowd-detection-utils/background` | Detector-agnostic `BackgroundSubtractor` for static-detection suppression |
| `@pj-hoakari/web-crowd-detection-utils/line-crossing` | Detector-agnostic `LineCrossingCounter`: count tracked points crossing anchor-defined lines |

## Serving the ONNX Runtime WebAssembly assets

`onnxruntime-web` loads a WebAssembly runtime (`ort-wasm-simd-threaded.asyncify.wasm` + `.mjs`) at inference time. The `.wasm` is **not** inlined into JavaScript — the browser fetches it over HTTP — so a host application must serve it. By default ONNX Runtime resolves it relative to its own bundle URL (`import.meta.url`), which is unreliable with some setups (e.g. Next.js `output: "standalone"` or Turbopack, which does not emit/serve the file from `node_modules`).

This package gives you two pieces to self-host the runtime reliably:

1. A `wcdu-copy-runtime-assets` CLI that copies the exact assets this package needs (resolved from the installed `onnxruntime-web`, so versions always match) into a directory you serve:

   ```sh
   # copies into ./public/onnxruntime by default; pass a path to override
   wcdu-copy-runtime-assets public/onnxruntime
   ```

   It is bundler-agnostic (works under Turbopack, webpack, Vite). Wire it into your install / build scripts so the assets stay in sync:

   ```jsonc
   // package.json
   {
     "scripts": {
       "postinstall": "wcdu-copy-runtime-assets public/onnxruntime",
       "prebuild": "wcdu-copy-runtime-assets public/onnxruntime"
     }
   }
   ```

2. A `wasmPaths` option on `initSession` / `createYoloDetector` that points ONNX Runtime at the served path:

   ```ts
   const detector = await createYoloDetector({
     modelPath: "/models/yolo26n.onnx",
     executionProvider: "webgpu",
     session: { wasmPaths: "/onnxruntime/" }, // matches the copy destination
   });
   ```

Alternatively, set `wasmPaths` to a version-pinned CDN (`https://cdn.jsdelivr.net/npm/onnxruntime-web@<version>/dist/`) and skip the copy step — at the cost of an external runtime dependency.

## AI coding agents

This package ships agent skills under `skills/`. If you use an AI coding agent (Claude Code, Cursor, Copilot, etc.), run:

```sh
npx @tanstack/intent@latest install
```

This wires the skills into your agent config so it loads the right SKILL.md (detection-pipeline setup, postprocess tuning, ByteTrack integration, static-detection suppression, line-crossing counting, etc.) when you ask for help with this library.

To browse the available skills:

```sh
npx @tanstack/intent list
```

## Examples

`example/yolo-webcam` — minimal YOLO person detection on a webcam stream.
`example/yolo-bytetrack-video` — YOLO + ByteTrack stable-ID person counting on a video file.
`example/crowd-line-counting` — the full pipeline (every subpath): YOLO + ByteTrack with `background` static-suppression and `line-crossing` to count people crossing a user-drawn line each way.

## License

ISC. See `LICENSE`.
