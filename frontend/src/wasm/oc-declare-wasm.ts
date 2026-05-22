// WASM module loader for oc-declare
// The WASM package is built by wasm-pack in rust/wasm/pkg/
// Resolved via vite alias "oc-declare-wasm" -> ../rust/wasm/pkg

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let wasmModule: any = null;
let initPromise: Promise<void> | null = null;

export async function initWasm(): Promise<void> {
  if (wasmModule) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const mod = await import("oc-declare-wasm");
    await mod.default();
    wasmModule = mod;
  })();

  return initPromise;
}

export function isWasmReady(): boolean {
  return wasmModule !== null;
}

export interface DiscoveryOptions {
  noise_threshold: number;
  reduction: "None" | "Lossless";
  o2o_mode: "None" | "Direct" | "Reversed" | "Bidirectional";
  refinement: boolean;
  considered_arrow_types: string[];
  counts_for_generation: [number | null, number | null];
  counts_for_filter: [number | null, number | null];
  acts_to_use?: string[] | null;
}

export function discover(ocelJson: string, options: DiscoveryOptions): string {
  if (!wasmModule) throw new Error("WASM not initialized");
  return wasmModule.discover(ocelJson, JSON.stringify(options));
}

export function reduce(modelJson: string, lossless: boolean): string {
  if (!wasmModule) throw new Error("WASM not initialized");
  return wasmModule.reduce(modelJson, lossless);
}

export function conformance(modelJson: string, ocelJson: string): string {
  if (!wasmModule) throw new Error("WASM not initialized");
  return wasmModule.conformance(modelJson, ocelJson);
}

export function ocelInfo(ocelJson: string): string {
  if (!wasmModule) throw new Error("WASM not initialized");
  return wasmModule.ocel_info(ocelJson);
}

export function modelStats(modelJson: string): string {
  if (!wasmModule) throw new Error("WASM not initialized");
  return wasmModule.model_stats(modelJson);
}

export function projectSmart(modelJson: string, activitiesJson: string): string {
  if (!wasmModule) throw new Error("WASM not initialized");
  return wasmModule.project_smart(modelJson, activitiesJson);
}
