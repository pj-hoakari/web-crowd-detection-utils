# @kasumimercury/web-crowd-detection-utils

Browser-targeted TypeScript building blocks for in-browser YOLO + ByteTrack crowd / person detection.

## Subpaths

| Import                                              | Purpose                                                                  |
| --------------------------------------------------- | ------------------------------------------------------------------------ |
| `@kasumimercury/web-crowd-detection-utils/yolo`     | High-level `createYoloDetector`, low-level `postprocess` / `nms`         |
| `@kasumimercury/web-crowd-detection-utils/onnx`     | `onnxruntime-web` wrapper: `initSession`, `createPreprocessor`           |
| `@kasumimercury/web-crowd-detection-utils/source`   | Letterbox / stretch capture and reverse-transform helpers                |
| `@kasumimercury/web-crowd-detection-utils/bytetrack` | Detector-agnostic `BYTETracker` multi-object tracker                    |

## AI coding agents

This package ships agent skills under `skills/`. If you use an AI coding agent (Claude Code, Cursor, Copilot, etc.), run:

```sh
npx @tanstack/intent@latest install
```

This wires the skills into your agent config so it loads the right SKILL.md (detection-pipeline setup, postprocess tuning, ByteTrack integration, etc.) when you ask for help with this library.

To browse the available skills:

```sh
npx @tanstack/intent list
```

## Examples

`example/yolo-webcam` — minimal YOLO person detection on a webcam stream.
`example/yolo-bytetrack-video` — YOLO + ByteTrack stable-ID person counting on a video file.

## License

ISC. See `LICENSE`.
