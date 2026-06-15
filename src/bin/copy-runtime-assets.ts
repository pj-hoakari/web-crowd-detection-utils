#!/usr/bin/env node
import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, join, resolve } from "node:path";

/**
 * Copies the ONNX Runtime Web WebAssembly runtime assets that this package
 * loads (through `onnxruntime-web/webgpu`) into a destination directory, so a
 * host application can self-host and serve them.
 *
 * Usage:
 *   wcdu-copy-runtime-assets [destDir]
 *
 * `destDir` defaults to `public/onnxruntime`, resolved against the current
 * working directory. Wire this into a `postinstall` / `prebuild` / `predev`
 * script and point `initSession`'s `wasmPaths` option (or
 * `createYoloDetector({ session: { wasmPaths } })`) at the served path — e.g.
 * `wasmPaths: "/onnxruntime/"` when copying into `public/onnxruntime`.
 *
 * The assets are resolved from the `onnxruntime-web` version this package
 * depends on, so the served runtime always matches the bundled JavaScript glue
 * (a version mismatch makes ONNX Runtime fail to initialize).
 */

const require = createRequire(import.meta.url);

/**
 * Asset specifiers this package needs at runtime. The WebGPU entry
 * (`onnxruntime-web/webgpu`) — used for both the WebGPU and the WASM execution
 * providers — loads only the `asyncify` build, so only these two files are
 * required.
 */
const ASSET_SPECIFIERS = [
	"onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm",
	"onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs",
];

const DEFAULT_DEST = "public/onnxruntime";

function resolveAsset(specifier: string): string {
	try {
		return require.resolve(specifier);
	} catch {
		console.error(
			`wcdu-copy-runtime-assets: could not resolve "${specifier}". Is "onnxruntime-web" installed?`,
		);
		process.exit(1);
	}
}

function sameSize(a: string, b: string): boolean {
	try {
		return statSync(a).size === statSync(b).size;
	} catch {
		return false;
	}
}

function main(): void {
	const destDir = resolve(process.cwd(), process.argv[2] ?? DEFAULT_DEST);
	mkdirSync(destDir, { recursive: true });

	for (const specifier of ASSET_SPECIFIERS) {
		const src = resolveAsset(specifier);
		const fileName = basename(src);
		const dest = join(destDir, fileName);

		if (sameSize(src, dest)) {
			console.log(`✓ ${fileName} already up to date`);
			continue;
		}

		copyFileSync(src, dest);
		console.log(`✓ copied ${fileName} → ${dest}`);
	}
}

main();
