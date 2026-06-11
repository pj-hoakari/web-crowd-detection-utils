import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
	plugins: [react()],
	optimizeDeps: {
		// onnxruntime-webがort.bundle.min.mjs内でWASMファイルをnew URL(..., import.meta.url)で読み込んでいる
		// 事前バンドルするとURLが書き換えられてWASMアセットの検出ができなくなる
		// 事前バンドルの対象から外す
		exclude: ["onnxruntime-web"],
	},
	server: {
		// SharedArrayBufferを有効にするためのCross Origin Isolationの設定
		// wasmをmulti-threadedで動かすために必要
		headers: {
			"Cross-Origin-Opener-Policy": "same-origin",
			"Cross-Origin-Embedder-Policy": "require-corp",
		},
	},
});
