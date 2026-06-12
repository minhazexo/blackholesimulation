/**
 * WASM Integration Tests
 *
 * These tests load the actual Rust physics engine compiled to WASM and verify
 * its metric computations against known analytical values from Bardeen 1973
 * and Kerr 1963.
 *
 * The WASM module must be built first via `bun run build:wasm`. If the module
 * is not available, the tests are skipped via vitest's built-in `skip()`.
 */

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Lazy WASM loader — entire suite skips if the .wasm binary is absent.
// ---------------------------------------------------------------------------
interface PhysicsEngine {
  compute_horizon(): number;
  compute_isco(): number;
  compute_photon_sphere(): number;
  compute_dilation(r: number): number;
  compute_shadow_radius(): number;
  compute_disk_flux(r: number): number;
  compute_g_factor(r: number, lambda: number): number;
  generate_disk_lut(): Float32Array;
  generate_spectrum_lut(width: number, height: number, maxTemp: number): Float32Array;
  generate_embedding_mesh(rMin: number, rMax: number, nRadial: number, nAngular: number): Float32Array;
  generate_ergosphere_mesh(nPolar: number, nAzimuthal: number): Float32Array;
  compute_shadow_curve(thetaObs: number, nPoints: number): Float32Array;
  update_params(mass: number, spin: number): void;
  tick_sab(dt: number): void;
  get_sab_ptr(): number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let PhysicsEngineCtor: any = null;

beforeAll(async () => {
  const wasmPath = path.resolve(__dirname, "../../../public/wasm/blackhole_physics.js");
  if (!fs.existsSync(wasmPath)) {
    return; // skip — WASM not built
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wasmModuleWrap: any = await import("blackhole-physics");
    await wasmModuleWrap.default(); // instantiate WASM
    PhysicsEngineCtor = wasmModuleWrap.PhysicsEngine;
  } catch (err) {
    // WASM failed to load — tests will skip
    // eslint-disable-next-line no-console
    console.warn("[wasm-integration] WASM load failed:", err);
  }
});

function makeEngine(mass: number, spin: number): PhysicsEngine | null {
  if (!PhysicsEngineCtor) return null;
  return new PhysicsEngineCtor(mass, spin) as PhysicsEngine;
}

// ---------------------------------------------------------------------------
// Known analytical values (Bardeen 1973, Kerr 1963)
// ---------------------------------------------------------------------------
const TIGHT = 6; // decimal places for close comparisons

// ---------------------------------------------------------------------------
// Tests — each uses vitest's runtime `skip()` if WASM unavailable
// ---------------------------------------------------------------------------
describe("WASM PhysicsEngine — Event Horizon", () => {
  it("Schwarzschild (a=0): horizon = 2M", async ({ skip }) => {
    const engine = makeEngine(1.0, 0.0);
    if (!engine) return skip();
    expect(engine.compute_horizon()).toBeCloseTo(2.0, TIGHT);
  });

  it("Moderate spin (a=0.5): horizon < 2M", async ({ skip }) => {
    const engine = makeEngine(1.0, 0.5);
    if (!engine) return skip();
    const rh = engine.compute_horizon();
    expect(rh).toBeLessThan(2.0);
    expect(rh).toBeGreaterThan(1.0);
  });

  it("Horizon scales linearly with mass", async ({ skip }) => {
    const engine1 = makeEngine(1.0, 0.5);
    if (!engine1) return skip();
    const engine2 = makeEngine(2.0, 0.5);
    if (!engine2) return skip();
    expect(engine2.compute_horizon() / engine1.compute_horizon()).toBeCloseTo(2.0, TIGHT);
  });
});

describe("WASM PhysicsEngine — ISCO", () => {
  it("Schwarzschild (a=0): ISCO = 6M", async ({ skip }) => {
    const engine = makeEngine(1.0, 0.0);
    if (!engine) return skip();
    expect(engine.compute_isco()).toBeCloseTo(6.0, TIGHT);
  });

  it("ISCO decreases with increasing prograde spin", async ({ skip }) => {
    const e0 = makeEngine(1.0, 0.0);
    if (!e0) return skip();
    const e5 = makeEngine(1.0, 0.5);
    if (!e5) return skip();
    const e9 = makeEngine(1.0, 0.9);
    if (!e9) return skip();
    expect(e5.compute_isco()).toBeLessThan(e0.compute_isco());
    expect(e9.compute_isco()).toBeLessThan(e5.compute_isco());
  });

  it("ISCO > event horizon for all spins", async ({ skip }) => {
    const engine = makeEngine(1.0, 0.0);
    if (!engine) return skip();
    for (const spin of [0.0, 0.3, 0.5, 0.7, 0.9]) {
      const e = makeEngine(1.0, spin);
      if (!e) return skip();
      expect(e.compute_isco()).toBeGreaterThan(e.compute_horizon());
    }
  });

  it("ISCO scales linearly with mass", async ({ skip }) => {
    const e1 = makeEngine(1.0, 0.5);
    if (!e1) return skip();
    const e2 = makeEngine(2.0, 0.5);
    if (!e2) return skip();
    expect(e2.compute_isco() / e1.compute_isco()).toBeCloseTo(2.0, 3);
  });
});

describe("WASM PhysicsEngine — Photon Sphere", () => {
  it("Schwarzschild (a=0): photon sphere = 3M", async ({ skip }) => {
    const engine = makeEngine(1.0, 0.0);
    if (!engine) return skip();
    expect(engine.compute_photon_sphere()).toBeCloseTo(3.0, TIGHT);
  });

  it("photon sphere is between horizon and ISCO for moderate spin", async ({ skip }) => {
    const engine = makeEngine(1.0, 0.5);
    if (!engine) return skip();
    const rh = engine.compute_horizon();
    const rph = engine.compute_photon_sphere();
    const isco = engine.compute_isco();
    expect(rph).toBeGreaterThan(rh);
    expect(rph).toBeLessThan(isco);
  });
});

describe("WASM PhysicsEngine — Time Dilation", () => {
  it("dilation near horizon is small", async ({ skip }) => {
    const engine = makeEngine(1.0, 0.0);
    if (!engine) return skip();
    const g = engine.compute_dilation(engine.compute_horizon() * 1.01);
    expect(g).toBeGreaterThan(0);
    expect(g).toBeLessThan(0.15);
  });

  it("dilation at infinity approaches 1", async ({ skip }) => {
    const engine = makeEngine(1.0, 0.0);
    if (!engine) return skip();
    expect(engine.compute_dilation(1e6)).toBeCloseTo(1.0, 3);
  });

  it("dilation increases monotonically with radius", async ({ skip }) => {
    const engine = makeEngine(1.0, 0.5);
    if (!engine) return skip();
    const radii = [2.5, 3.0, 4.0, 6.0, 10.0, 50.0, 100.0];
    const values = radii.map((r) => engine.compute_dilation(r));
    for (let i = 1; i < values.length; i++) {
      expect(values[i]!).toBeGreaterThan(values[i - 1]!);
    }
  });
});

describe("WASM PhysicsEngine — Shadow Radius", () => {
  it("Schwarzschild shadow radius = 3√3 M ≈ 5.196M", async ({ skip }) => {
    const engine = makeEngine(1.0, 0.0);
    if (!engine) return skip();
    expect(engine.compute_shadow_radius()).toBeCloseTo(3 * Math.sqrt(3), 3);
  });

  it("shadow radius is positive for all spins", async ({ skip }) => {
    for (const spin of [-0.9, -0.5, 0.0, 0.5, 0.9]) {
      const engine = makeEngine(1.0, spin);
      if (!engine) return skip();
      expect(engine.compute_shadow_radius()).toBeGreaterThan(0);
    }
  });
});

describe("WASM PhysicsEngine — Parameter Updates", () => {
  it("update_params to Schwarzschild gives ISCO = 6M", async ({ skip }) => {
    const engine = makeEngine(1.0, 0.9);
    if (!engine) return skip();
    engine.update_params(1.0, 0.0);
    expect(engine.compute_isco()).toBeCloseTo(6.0, TIGHT);
  });
});

describe("WASM PhysicsEngine — LUTs and Meshes", () => {
  it("generate_disk_lut returns non-empty array", async ({ skip }) => {
    const engine = makeEngine(1.0, 0.5);
    if (!engine) return skip();
    expect(engine.generate_disk_lut().length).toBeGreaterThan(0);
  });

  it("generate_embedding_mesh returns expected vertex count", async ({ skip }) => {
    const engine = makeEngine(1.0, 0.5);
    if (!engine) return skip();
    const nRadial = 16, nAngular = 32;
    const mesh = engine.generate_embedding_mesh(2.1, 50.0, nRadial, nAngular);
    expect(mesh.length).toBe(nRadial * nAngular * 3);
  });

  it("generate_ergosphere_mesh returns data for spinning BH", async ({ skip }) => {
    const engine = makeEngine(1.0, 0.9);
    if (!engine) return skip();
    expect(engine.generate_ergosphere_mesh(16, 32).length).toBeGreaterThan(0);
  });
});

describe("WASM PhysicsEngine — Shadow Curve", () => {
  it("compute_shadow_curve returns finite points", async ({ skip }) => {
    const engine = makeEngine(1.0, 0.9);
    if (!engine) return skip();
    const curve = engine.compute_shadow_curve(Math.PI / 4, 64);
    expect(curve.length).toBe(128); // 64 * 2
    for (let i = 0; i < curve.length; i++) {
      expect(isFinite(curve[i]!)).toBe(true);
    }
  });
});

describe("WASM PhysicsEngine — Disk Physics", () => {
  it("disk flux is positive outside ISCO", async ({ skip }) => {
    const engine = makeEngine(1.0, 0.5);
    if (!engine) return skip();
    const flux = engine.compute_disk_flux(engine.compute_isco() * 1.5);
    expect(flux).toBeGreaterThan(0);
  });

  it("g-factor is positive and bounded", async ({ skip }) => {
    const engine = makeEngine(1.0, 0.5);
    if (!engine) return skip();
    const g = engine.compute_g_factor(engine.compute_isco() * 2.0, 0.5);
    expect(g).toBeGreaterThan(0);
    expect(g).toBeLessThan(3.0);
  });
});
