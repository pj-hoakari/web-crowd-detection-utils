import { defineConfig } from "tsdown";

export default defineConfig({
	entry: [
		"src/index.ts",
		"src/background/index.ts",
		"src/bytetrack/index.ts",
		"src/line-crossing/index.ts",
		"src/onnx/index.ts",
		"src/source/index.ts",
		"src/yolo/index.ts",
	],
	format: ["esm"],
	target: "es2023",
	platform: "browser",
	dts: true,
	sourcemap: true,
});
