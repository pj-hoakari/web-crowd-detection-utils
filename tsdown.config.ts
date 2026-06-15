import { defineConfig } from "tsdown";

export default defineConfig({
	entry: [
		"src/index.ts",
		"src/background/index.ts",
		"src/bin/copy-runtime-assets.ts",
		"src/bytetrack/index.ts",
		"src/line-crossing/index.ts",
		"src/onnx/index.ts",
		"src/source/index.ts",
		"src/yolo/index.ts",
	],
	format: ["esm"],
	target: "es2023",
	platform: "browser",
	// `node:*` builtins are imported only by the Node CLI entry (`src/bin/`);
	// keep them external so the browser-platform build does not try to resolve
	// or bundle them.
	deps: {
		neverBundle: [/^node:/],
	},
	dts: true,
	sourcemap: true,
});
