export function isWebGpuAvailable(): boolean {
	return typeof navigator !== "undefined" && "gpu" in navigator;
}
