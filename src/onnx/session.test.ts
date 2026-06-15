import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("onnxruntime-web/webgpu", () => ({
	env: { wasm: {} as { wasmPaths?: unknown } },
	InferenceSession: {
		create: vi.fn(async () => ({
			inputNames: ["input"],
			outputNames: ["output"],
		})),
	},
}));

import * as ort from "onnxruntime-web/webgpu";
import { initSession } from "./session";

describe("initSession", () => {
	beforeEach(() => {
		ort.env.wasm.wasmPaths = undefined;
	});

	it("rejects when webgpu requested but navigator.gpu is unavailable", async () => {
		expect("gpu" in (globalThis.navigator ?? {})).toBe(false);
		await expect(
			initSession("model.onnx", { executionProvider: "webgpu" }),
		).rejects.toThrow(/navigator\.gpu is unavailable/);
		expect(vi.mocked(ort.InferenceSession.create)).not.toHaveBeenCalled();
	});

	it("passes the requested provider explicitly with no fallback push", async () => {
		const create = vi.mocked(ort.InferenceSession.create);
		create.mockClear();
		const result = await initSession("model.onnx", {
			executionProvider: "wasm",
		});
		expect(result.backend).toBe("wasm");
		expect(create).toHaveBeenCalledTimes(1);
		const opts = create.mock.calls[0]?.[1];
		expect(opts?.executionProviders).toEqual(["wasm"]);
		expect(opts?.graphOptimizationLevel).toBe("all");
	});

	it("merges caller-supplied sessionOptions but keeps executionProviders authoritative", async () => {
		const create = vi.mocked(ort.InferenceSession.create);
		create.mockClear();
		await initSession("model.onnx", {
			executionProvider: "wasm",
			graphOptimizationLevel: "basic",
			sessionOptions: { logSeverityLevel: 0 },
		});
		const opts = create.mock.calls[0]?.[1];
		expect(opts?.executionProviders).toEqual(["wasm"]);
		expect(opts?.graphOptimizationLevel).toBe("basic");
		expect(opts?.logSeverityLevel).toBe(0);
	});

	it("leaves ort.env.wasm.wasmPaths untouched when wasmPaths is omitted", async () => {
		await initSession("model.onnx", { executionProvider: "wasm" });
		expect(ort.env.wasm.wasmPaths).toBeUndefined();
	});

	it("assigns ort.env.wasm.wasmPaths from the wasmPaths option", async () => {
		await initSession("model.onnx", {
			executionProvider: "wasm",
			wasmPaths: "/onnxruntime/",
		});
		expect(ort.env.wasm.wasmPaths).toBe("/onnxruntime/");
	});

	it("accepts a per-file wasmPaths map", async () => {
		const paths = {
			wasm: "/onnxruntime/ort.wasm",
			mjs: "/onnxruntime/ort.mjs",
		};
		await initSession("model.onnx", {
			executionProvider: "wasm",
			wasmPaths: paths,
		});
		expect(ort.env.wasm.wasmPaths).toEqual(paths);
	});

	it("assigns wasmPaths before InferenceSession.create runs", async () => {
		const create = vi.mocked(ort.InferenceSession.create);
		let seenDuringCreate: unknown;
		create.mockImplementationOnce(async () => {
			seenDuringCreate = ort.env.wasm.wasmPaths;
			return {
				inputNames: ["input"],
				outputNames: ["output"],
			} as unknown as Awaited<ReturnType<typeof ort.InferenceSession.create>>;
		});
		await initSession("model.onnx", {
			executionProvider: "wasm",
			wasmPaths: "/onnxruntime/",
		});
		expect(seenDuringCreate).toBe("/onnxruntime/");
	});
});
