# Black Hole Simulation — Comprehensive Codebase Improvement Analysis

> **Date**: June 12, 2026  
> **Last Updated**: June 13, 2026 — Batch 5–7 applied (+19 fixes total)  
> **Scope**: Full-stack audit of the TypeScript/React frontend, Rust physics kernel (WASM), GLSL/WGSL shaders, WebGPU alpha, tests, build tooling, and deployment configuration.  
> **Methodology**: Manual line-by-line review of every source file across `src/`, `physics-engine/`, `tests/`, `scripts/`, and configuration files. Browser interaction verified at `localhost:3001`.

---

## Table of Contents

1. [Critical Issues](#1-critical-issues)
2. [Performance Optimizations](#2-performance-optimizations)
3. [Code Quality & Maintainability](#3-code-quality--maintainability)
4. [Architecture Improvements](#4-architecture-improvements)
5. [Testing Gaps](#5-testing-gaps)
6. [UI/UX Improvements](#6-uiux-improvements)
7. [Build & Tooling](#7-build--tooling)
8. [Security & Compliance](#8-security--compliance)
9. [Roadmap Items Ready for Implementation](#9-roadmap-items-ready-for-implementation)
10. [Appendix: File-by-File Notes](#10-appendix-file-by-file-notes)

---

## 1. Critical Issues

### 1.1 Stale Ref Values Cause Inconsistent Rendering State

**Status**: ⬜ Won't Fix (dead code — see 4.1)  
**Files**: `src/hooks/useAnimation.ts`, `src/hooks/useCamera.ts`

**Problem**: `useAnimation` declares `mouseRef` (line ~46) but the `animate` callback reads `currentMouse = mouseRef.current` inside the rAF loop. Meanwhile `useCamera` computes `mouse` from `cameraState` via `useMemo`. The `animate` effect dependency array only includes `glRef, programRef, ...`, **not** `params` or `mouse` — meaning stale closures can persist for frames when params change rapidly.

**Fix**: Either add `params` and `mouse` to the dependency array (with memoized stabilization) or use a ref-based architecture that does not depend on React state for the hot loop.

### 1.2 Framebuffer Completeness Not Checked After `EXT_color_buffer_float`

**Status**: ✅ Fixed  
**Files**: `src/rendering/webgl/renderer.ts`, `src/rendering/bloom.ts`, `src/rendering/reprojection.ts`

**Problem**: The renderer probes `EXT_color_buffer_float` and records `hasFloatFramebuffer`, but `BloomManager` and `ReprojectionManager` create framebuffers with `RGBA16F` internal format regardless of this flag. If the extension is absent (Safari ≤ 16, some mobile drivers), `gl.checkFramebufferStatus()` returns `FRAMEBUFFER_INCOMPLETE_ATTACHMENT`, and the bloom/TAA passes silently fail (black screen with no error surfaced to the user).

**Fix**: Thread `hasFloatFramebuffer` into `BloomManager` and `ReprojectionManager`, downgrading to `RGBA8` when the extension is unavailable.

### 1.3 `physicsBridge` Fallback Path May Use Deallocated WASM Memory

**Status**: ✅ Fixed  
**Files**: `src/engine/physics-bridge.ts`

**Problem**: `initializeFallbackViews()` stores `Float32Array` views into `this.wasmMemory.buffer`. If the WASM module's `memory.grow()` is called later (e.g., due to a large allocation inside the Rust kernel), the existing `WebAssembly.Memory.buffer` is detached and all views become invalid — causing silent NaN propagation.

**Fix**: Added `rebindWasmViews()` method called on every `tick()` in the fallback path, mirroring the worker's memory guard.

### 1.4 No Error Recovery After Worker Hard-Crash

**Status**: ✅ Fixed  
**Files**: `src/engine/physics-bridge.ts`

**Problem**: The worker imports `blackhole-physics` via `import()`. If the WASM binary fails to compile or the module throws during `new PhysicsEngine()`, the worker posts an `ERROR` message and terminates. The main thread's `PhysicsBridge.initialize()` currently rejects the promise — but there is **no retry logic** and no automatic fallback to the main-thread WASM path. The simulation stays dead until the user manually reloads.

**Fix**: Added `initializeWithRetry()` with 3 retries, exponential backoff (1s/2s/4s), 15s timeout, `worker.onerror` handler, and automatic main-thread WASM fallback when all retries are exhausted.

### 1.5 `KeyboardEvent` Detection of Modifier Keys for Screenshot is Missing

**Status**: ✅ Fixed  
**Files**: `src/hooks/useKeyboard.ts`

**Problem**: `useKeyboard` implements `H` for UI toggle, `D` for debug, `1-4` for presets, arrow keys for camera nudge, and space for pause. **No screenshot key** (e.g., `P` or `F12`) is wired despite `useScreenshot.ts` existing. Users cannot capture simulation frames via keyboard.

**Fix**: Added `onScreenshot` callback to `UseKeyboardOptions` interface and wired `P`/`S` keys to call it.

---

## 2. Performance Optimizations

### 2.1 Excessive `UniformBatcher.set()` Calls Per Render Loop

**Status**: ✅ Fixed  
**Files**: `src/utils/cpu-optimizations.ts`

**Observation**: Every `render()` call issues ~25-30 `uniformBatcher.set*()` calls. While each call is guarded by a dirty-check in `set2f`/`set3f`/`set4f`, the `set(name, value)` generic path does **not** dirty-check for `Float32Array` arguments — it always calls `gl.uniform2fv`, `gl.uniform3fv`, etc. The shadow curve uniform (`u_shadowCurve`) is a 128-element `Float32Array` that gets uploaded every frame.

**Fix**: Added element-by-element dirty-check for `Float32Array` arguments >4 elements in `UniformBatcher.set()`.

### 2.2 `SpectrumLUT` Re-Creation on Every Render

**Files**: `src/rendering/webgl/renderer.ts` (lines ~295-305 in `syncLUTs`)

**Problem**: `syncLUTs()` checks `if (!this.diskLUT)` and `if (!this.spectrumLUT)` every frame. Since these are initialized once (they are non-null after first creation), this is harmless. However, `physicsBridge.getDiskLUT()` and `physicsBridge.getSpectrumLUT()` return null in worker mode (because `this.engine` is null), so `syncLUTs()` is effectively dead code in production. The real LUT creation happens in `useAnimation.ts` lines ~130-175, which is coupled to a different render path.

**Fix**: Consolidate LUT initialization into a single path. Either:
- Move LUT creation into the `WebGLRenderer` with a proper initialization promise, or
- Remove the duplicate code from `useAnimation.ts` and let `WebGLRenderer` own LUTs entirely.

### 2.3 `SpectralManager` Creates 4096×256 RGBA16F LUT That May Exceed Mobile GPU Limits

**Files**: `src/rendering/spectral.ts`

**Problem**: `SpectralManager` creates a `4096×256` texture. Many mobile GPUs (and some integrated Intel GPUs) have a `MAX_TEXTURE_SIZE` of 4096 and `MAX_RENDERBUFFER_SIZE` of 4096 on the short edge — this LUT is dimension-compliant. However, 4096×256×4×2 bytes = 8 MB, which is fine. The deeper issue is that this path calls `physicsBridge.getSpectrumLUT()` which returns null in worker mode (same as above).

**Fix**: Either wire `SpectralManager` into the actual render pipeline or mark it as deprecated/ROADMAP. Update the initialization guard to not throw when LUT data is unavailable.

### 2.4 Event Listeners Not Cleaned Up on Unmount in `page.tsx`

**Status**: ✅ Fixed  
**Files**: `src/app/page.tsx`

**Problem**: The `useEffect` that triggers `physicsBridge.ensureInitialized()` does not return a cleanup function. If the component unmounts (e.g., error boundary triggers, navigation in future SPA mode), the physics worker continues running. The visibility listener from `physicsBridge.attachVisibilityListener()` is also never torn down.

**Fix**: Captured the teardown function from `attachVisibilityListener()` and returned it from the effect cleanup.

### 2.5 `useAnimation` Re-Creates `PerformanceMonitor` and `UniformBatcher` on Every Re-Render

**Files**: `src/hooks/useAnimation.ts` (lines ~60, ~67)

**Observation**: `performanceMonitor`, `uniformBatcher`, `gpuTimer`, and `idleDetector` are initialized via `useRef(new Class())`. This pattern is correct — refs persist across re-renders. However, if the parent component re-creates the hook (e.g., key change), these classes are re-initialized, losing accumulated performance history.

**Fix**: Minor issue. Consider exposing a `reset()` method on the hook return value for consumers who deliberately want to wipe performance history.

---

## 3. Code Quality & Maintainability

### 3.1 Duplicated LUT Initialization Logic

**Files**:  
- `src/rendering/spectral.ts` — `SpectralManager` class  
- `src/rendering/webgl/renderer.ts` — `syncLUTs()` method  
- `src/hooks/useAnimation.ts` — `initTextures()` effect (lines ~100-175)
- `src/hooks/useWebGL.ts` — `diskLUTTextureRef` / `spectrumLUTTextureRef` (unused refs)

**Problem**: Four separate locations attempt to create disk and spectrum LUT textures, with different buffer sizes and format assumptions. Only one path actually works in production (the `WebGLRenderer.syncLUTs()` path, which is where the render loop draws from). The other three paths are either dead code or create textures that are never bound.

**Fix**: Consolidate all LUT creation into a single `SpectralManager` that the `WebGLRenderer` owns. Remove refs from `useWebGL.ts` and the effect from `useAnimation.ts`.

### 3.2 `any` Type Usage

**Files**: Multiple, especially `src/engine/physics-bridge.ts`, `src/hooks/useAnimation.ts`, `src/rendering/webgl/renderer.ts`

**Count**: ~15+ `eslint-disable-next-line @typescript-eslint/no-explicit-any` comments.

**Problem**: The physics bridge and WASM interop use `any` extensively (e.g., `private engine: any = null`). While some of this is necessary for WASM FFI, the `_lastGoodCamera` and `_lastGoodPhysics` shadow arrays could have typed interfaces.

**Fix**: Define explicit TypeScript interfaces for the WASM module exports and the SAB layout. Use `unknown` with type guards instead of `any` for the WASM FFI boundary.

### 3.3 `console.log` / `console.warn` in Production Builds

**Status**: ✅ Fixed  
**Files**: `next.config.mjs`

**Problem**: `next.config.mjs` sets `removeConsole: true` for production builds via `compiler.removeConsole`. This removes ALL `console` statements including legitimate `console.error` calls that serve as user-facing error messages. The `ErrorDisplay` component manually copies error details — but the `console.error` that formats them will be stripped in production.

**Fix**: Changed to `removeConsole: { exclude: ['error', 'warn'] }` so critical diagnostics survive production builds.

### 3.4 Hardcoded Literals and Magic Numbers

**Files**: Throughout shader code and physics calculations.

**Examples**:
- `src/shaders/blackhole/fragment.glsl.ts`: `MAX_STEP * 2.5`, `(r - 30.0) * 0.08`, `rh * 1.5`
- `src/hooks/useCamera.ts`: `0.005`, `0.92`, `0.3`, `5.0`, `-0.15`, `0.5 * sensitivity`
- `src/rendering/adaptive-resolution.ts`: `2.0`, `5.0` second timers

**Fix**: Extract magic numbers into named constants in config files or at the top of each file with clear documentation. Create a `shaders/constants.glsl.ts` for shared GLSL constants.

### 3.5 `eslint-disable` Comments Hiding Real Issues

**Files**: Throughout.

**Count**: ~30+ disable comments for `no-console`, `no-explicit-any`, `no-unused-vars`, `max-params`.

**Problem**: Many `eslint-disable` comments are legitimate, but several hide genuine code quality issues (e.g., `// eslint-disable-next-line @typescript-eslint/no-unused-vars` in `WebGPUCanvas.tsx` for `onMetricsUpdate`).

**Fix**: Audit each disable comment. Replace with `void parameterName` for unused parameters, use typed interfaces for WASM FFI, and remove `no-console` disables in favor of a proper logger utility.

### 3.6 `_legacy_src/` Directory Contains ~1,200 Lines of Dead Code

**Files**: `physics-engine/_legacy_src/*.rs` (15 files)

**Problem**: The `_legacy_src/` directory contains the physics engine source from a previous architecture iteration. It is not referenced by any `mod.rs` or `Cargo.toml` path. It bloats IDE searches, confuses new contributors, and wastes disk space.

**Fix**: Move to a `git archive` branch or a `ref archive/legacy` tag. Delete from `main`.

---

## 4. Architecture Improvements

### 4.1 Duplicate Render Loop Implementations

**Files**:  
- `src/hooks/useAnimation.ts` — Complete rAF loop with physics, LUT creation, uniforms  
- `src/rendering/webgl/renderer.ts` — Standalone `render()` method that duplicates all uniform setting, LUT sync, and post-processing  
- `src/components/canvas/WebGLCanvas.tsx` — Uses `WebGLRenderer.render()`  
- `src/app/page.tsx` — Also triggers `useAnimation` via... wait, `useAnimation` is imported in `useWebGL.ts` but page.tsx actually uses `WebGLCanvas` which uses `WebGLRenderer`.

**Problem**: There are effectively **two** render loop implementations:
1. `useAnimation` (the older one wired to `useWebGL.ts`)
2. `WebGLRenderer` (the newer one used by `WebGLCanvas.tsx`)

Both write uniforms, manage textures, and handle physics bridge telemetry. Both do LUT creation. The `WebGLCanvas` component uses `WebGLRenderer` in its own rAF loop, bypassing `useAnimation` entirely. This means the hook `useAnimation` is **dead code** unless some path activates it.

**Fix**: Remove `useAnimation.ts` and the duplicate uniform/texture/logic from `useWebGL.ts`. Let `WebGLRenderer` be the sole render loop implementation.

### 4.2 WebGPU Renderer Is Fragile and Incomplete

**Status**: Sub-issue "bind group recreation" ✅ Fixed  
**Files**: `src/rendering/webgpu/renderer.ts`, `src/shaders/compute.wgsl.ts`, `src/shaders/postprocess/ataa.wgsl.ts`

**Issues**:
- The compute shader (`compute.wgsl.ts`) is a **substantial port** of the GLSL kernel with full Kerr-Schild geodesic integration — but it has never been validated against the Rust ground truth.
- The ATAA (Advanced TAA) WGSL shader re-implements TAA from scratch but does not share the YCoCg clamping logic from the GLSL reprojection shader.
- ~~The `WebGPURenderer` re-creates bind groups on every frame (`renderBindGroup = this.device.createBindGroup(...)` inside `render()`), which is an anti-pattern — bind groups should be created once and reused.~~

**Fixes**: 
- ✅ Replaced per-frame `createBindGroup` with two cached `renderBindGroups[]` (one per ping-pong history texture), invalidated on resize. The `computeBindGroup` and `ataaBindGroups` were already lazily cached.
- ⬜ Validate the WGSL compute kernel output against the GLSL shader numerically.
- ⬜ Add WebGPU-specific unit tests.

### 4.3 State Management Complexity

**Files**: `src/app/page.tsx`

**Problem**: The main page component has **15+ `useState` calls** and **10+ `useEffect` calls**. State updates cascade through `setParams`, which triggers `onParamsChange` in child components, which triggers shader recompilation, which invalidates uniforms. This creates a fragile dependency graph with potential for infinite re-render loops.

**Fix**: Adopt `useReducer` for simulation parameters (already partially done with `SimulationParams` type) or migrate to Zustand/Valtio for more predictable state updates. Reduce `useEffect` count by combining related side effects.

### 4.4 WASM Build Path Conflicts

**Files**: `package.json` (build scripts), `vercel.json`, `vitest.config.ts`

**Problem**: The WASM output path is `public/wasm/blackhole_physics.js`. The TypeScript path alias is `"blackhole-physics": ["./public/wasm"]`. Vitest and the Next.js webpack config both resolve this alias, but there is no validation that the WASM build has completed before the dev server starts. The `dev` script runs `bun run build:wasm && next dev`, which is sequential — but on the second `next dev` hot-reload, the WASM module might not be recompiled.

**Fix**: Add a build-check script that verifies `public/wasm/blackhole_physics.js` exists and is non-empty before the dev server starts. Use `concurrently` with proper build ordering.

---

## 5. Testing Gaps

### 5.1 No Rust-FFI Integration Tests from TypeScript

**Observation**: The physics engine has 15 Rust integration tests (`physics-engine/gravitas-core/tests/`). The WASM bridge has 1 test (`sab_bounds.rs`). There are **zero** TypeScript tests that exercise the actual WASM module — all 20+ TypeScript test files mock or avoid the physics bridge.

**Risk**: If the WASM API surface changes (e.g., `compute_horizon` returns different values), the frontend tests won't catch it.

**Fix**: Add at least 1-2 integration tests that instantiate the WASM module (via `import("blackhole-physics")`) and verify basic metric computations (horizon radius, ISCO, photon sphere).

### 5.2 Shader Test Coverage is Minimal

**Files**: `tests/visual-regression/`, `src/__tests__/shaders/manager.test.ts`

**Problem**: The visual regression tests exist but are run via a separate Vitest config (`vitest.shader.config.ts`) and require golden images. The `manager.test.ts` only tests the shader variant cache — not the actual GLSL output or compilation.

**Fix**: Add snapshot tests for generated shader source (`ShaderManager.generateShaderSource()`) with different feature toggle combinations. This would catch regressions in the conditional compilation logic.

### 5.3 Missing Performance Benchmark Tests

**Files**: `src/performance/validation.ts` contains `PerformanceValidator` but it is never instantiated or called in any test.

**Fix**: Add tests that use `PerformanceValidator` with mocked `requestAnimationFrame` to verify feature cost calculations and recommendation logic.

### 5.4 Visual Regression Suite Cannot Run Locally Without Goldens

**Files**: `tests/visual-regression/README.md`

**Problem**: The visual regression test requires pre-committed golden images in `tests/golden/`. The initial `.gitignore` in that directory ignores the PNG files. The `shader:update-goldens` script generates them, but there is no documentation on when/how to update them.

**Fix**: Document the golden update workflow in the README. Consider using Playwright's built-in screenshot comparison instead of a custom pixelmatch+ssim.js pipeline.

---

## 6. UI/UX Improvements

### 6.1 No Loading State for WASM Compilation

**Status**: ✅ Fixed  
**Files**: `src/components/ui/WasmLoadingOverlay.tsx`, `src/app/page.tsx`

**Observation**: When a user visits the page, the WASM module takes 2-5 seconds to compile (depending on device). During this time, the canvas is black and the UI is fully visible — the user can interact with sliders and buttons, but nothing happens. No loading indicator is shown for the physics engine initialization.

**Fix**: Added `WasmLoadingOverlay` component with animated spinning rings, indeterminate progress bar via framer-motion, and "Compiling Physics Kernel" / "Initializing WASM Engine" status text. The overlay fades in/out via `AnimatePresence`. A 200ms polling interval checks `physicsBridge.isReady()` and a 15s safety timeout dismisses the overlay on initialization failure so the user is never trapped.

### 6.2 Adaptive Resolution Not Visible to User

**Observation**: The `ControlPanel` has a `Render Scale` slider, and the benchmark system recommends presets. But the user has **no visual indicator** that adaptive resolution has kicked in. A sudden resolution drop can look like a bug.

**Fix**: Add a small indicator in the telemetry HUD (e.g., "AR: 85%") when adaptive resolution is active and the scale deviates from 1.0.

### 6.3 Quantum Panels Use Hardcoded Stellar Mass

**Files**: `src/app/page.tsx` (line ~145: `QUANTUM_DEMO_MASS_KG = 10 * 1.98847e30`)

**Observation**: The Bekenstein-Hawking and Hawking spectrum panels always show quantum thermodynamics for a 10 M☉ black hole, regardless of the user's mass slider. A 10 M☉ black hole has T_H ≈ 6×10⁻⁹ K — far below any observable temperature. The panels are labelled "illustrative" but could be more engaging if they responded to the user's mass/spin parameters.

**Fix**: Derive the demo mass from `params.mass` instead of a hardcoded constant. At low masses the panels would show higher Hawking temperatures, making the visualization more interactive.

### 6.4 No Touch Gesture Feedback on Mobile

**Files**: `src/hooks/useCamera.ts` (touch handlers)

**Observation**: The touch handlers work (pinch zoom, pan), but there is no visual feedback. Desktop users see a cursor change (`cursor-move` on canvas), but mobile users get no indication that swipe/gestures are active.

**Fix**: Add a brief "Swipe to orbit • Pinch to zoom" overlay on first mobile visit, or a subtle hint in the corner.

### 6.5 `SimulationInfo` Panel Overlaps ControlPanel on Mobile

**Observation**: On screens narrower than 640px, the `SimulationInfo` panel (anchored `bottom-6 left-4`) can overlap with the `ControlPanel` (anchored `bottom-0 left-0`), especially when the control panel is in compact mode (the gear icon + user profile button at `bottom-6 right-6`).

**Fix**: Add responsive margin/padding rules or a media-query-based layout shift.

---

## 7. Build & Tooling

### 7.1 `bun.lock` Not in `.gitignore`

**Observation**: `bun.lock` is tracked in git. This is fine for Bun projects, but the lockfile can cause merge conflicts in CI. Consider adding `bun.lock` to `.gitignore` if using `npm` or `pnpm` locally, or commit it for deterministic installs.

### 7.2 `wasm-pack` Globally Installed via npm

**Files**: `package.json` (`"wasm-pack": "^0.13.1"`)

**Observation**: `wasm-pack` is listed as a devDependency to ensure it's available in CI. However, `wasm-pack` is a Rust tool, not an npm package. The npm package `wasm-pack` is a thin wrapper that downloads the Rust binary.

**Fix**: Pin the version in `.cargo/config.toml` or use `cargo install wasm-pack` in CI instead. The npm wrapper adds unnecessary complexity.

### 7.3 Missing ESLint Config for Rust Files

**Observation**: The `.eslintrc.json` only covers `*.{js,ts,tsx}`. Rust code has no linting in CI (the `lefthook.yml` runs `cargo check` and `clippy`, but CI only runs `bun run lint` and `bun run test`).

**Fix**: Add CI steps for `cargo check` and `cargo clippy` (or ensure the lefthook pre-push command runs in CI).

### 7.4 Vercel Build Command Uses `bash` Which Fails on Windows

**Files**: `scripts/vercel-build.sh`, `package.json` (`"build:vercel": "bash scripts/vercel-build.sh"`)

**Observation**: The v0.2.1 production CI uses a bash script for the WASM Nix build target. Vercel's build environment (Amazon Linux) has bash, so this works on Vercel. However, the `dev` script (`bun run build:wasm`) uses `cross-env` for Windows compatibility — the Vercel build path is not Windows-compatible, which blocks local production builds on Windows.

**Fix**: Provide a PowerShell equivalent of `vercel-build.sh` or convert to a cross-platform Node.js script.

---

## 8. Security & Compliance

### 8.1 No Subresource Integrity (SRI) for External Assets

**Observation**: The page loads external assets (Google Fonts via Next.js font loader). There are no script tags with `integrity` attributes.

**Risk**: Low (fonts are loaded via Next.js's built-in loader with `display:swap`). Not actionable unless third-party scripts are added.

### 8.2 `Cross-Origin-Embedder-Policy: require-corp` Blocks Some Resources

**Files**: `next.config.mjs`

**Observation**: The `require-corp` COEP header is set to enable `SharedArrayBuffer`. This is necessary for the SAB-based physics bridge. However, it means any third-party resource (CDN-hosted images, analytics scripts) must either be same-origin or send a `Cross-Origin-Resource-Policy: cross-origin` header.

**Fix**: Already handled with `same-origin` CORP header for static assets. Document this requirement for any future third-party integrations.

### 8.3 No CSP Header Configured

**Observation**: The Next.js app does not set a Content-Security-Policy header. Given that the app uses `dangerouslySetInnerHTML` (fourteen times in `layout.tsx` for JSON-LD scripts), the risk of XSS is elevated if any user input were to influence these script contents.

**Fix**: Add a CSP header that restricts `script-src` to `'self' 'unsafe-inline'` (needed for the JSON-LD scripts and Next.js inline bootstraps). Use `nonce` attributes on the JSON-LD script tags.

### 8.4 No Rate Limiting on IndexNow Ping

**Files**: `scripts/indexnow-ping.ts`

**Observation**: The SEO script pings IndexNow API. If deployed in a cron job (`vercel.json` has an empty `crons` array), there is no rate limiting. 

**Fix**: Add a cooldown check (e.g., only ping if the sitemap has changed since last ping).

---

## 9. Roadmap Items Ready for Implementation

The following features from the ROADMAP have substantial code already written and could be completed with focused effort:

### 9.1 Neural Radiance Surrogate (NRS) — MLP Inference

**Files**: `src/shaders/compute/mlp.wgsl` — Contains a WGSL compute shader with neural network inference code. The shader has a partial implementation of a 4-layer MLP (3→16→16→16→3) that calculates deflection angles for ray tracing. The shader is **never loaded** by the `WebGPURenderer` or any other pipeline.

**Effort**: Medium. Needs: 
- Weight extraction from the Rust kernel (or training data)
- Pipeline bindings in `WebGPURenderer`
- Validation against the numerical ray-tracing ground truth

### 9.2 OffscreenCanvas Render Loop

**Files**: `docs/ARCHITECTURE.md` (mentioned as Tier 3 roadmap), `src/engine/worker-pool.ts` (referenced but file does not exist).

**Effort**: Medium. The `WebGLRenderer` would need to be ported to run inside an OffscreenCanvas worker, communicating via the SAB protocol.

### 9.3 Entropy-Scheduled Adaptive Rendering

**Files**: `docs/ARCHITECTURE.md` (described as "Cognitive Supervisor")

**Effort**: High. Requires variance analysis from the ray-marching pass, a priority queue of tiles, and dynamic resource allocation.

---

## 10. Appendix: File-by-File Notes

| File | Severity | Issue | Status |
|------|----------|-------|--------|
| `src/hooks/useAnimation.ts` | **HIGH** | Dead code — duplicated by `WebGLRenderer` | ✅ Fixed (4.1 Batch 2) |
| `src/rendering/spectral.ts` | **HIGH** | Dead code — never wired into render pipeline | ⬜ Open |
| `src/rendering/webgl/renderer.ts` | MEDIUM | `syncLUTs` silently fails in worker mode | ⬜ Open |
| `src/engine/physics-bridge.ts` | MEDIUM | Worker crash recovery | ✅ Fixed (1.4) |
| `src/engine/physics-bridge.ts` | MEDIUM | WASM memory buffer can detach | ✅ Fixed (1.3) |
| `src/rendering/bloom.ts` | MEDIUM | No `EXT_color_buffer_float` fallback | ✅ Fixed (1.2) |
| `src/rendering/reprojection.ts` | MEDIUM | No `EXT_color_buffer_float` fallback | ✅ Fixed (1.2) |
| `src/shaders/compute.wgsl.ts` | LOW | Massive shader, zero tests, never validated | ⬜ Open |
| `src/shaders/compute/mlp.wgsl` | LOW | Incomplete MLP implementation, not wired | ⬜ Open |
| `src/hooks/useWebGL.ts` | MEDIUM | Contains diskLUT/spectrumLUT refs that are never used | ✅ Fixed (4.1 Batch 2) |
| `src/components/canvas/WebGPUCanvas.tsx` | MEDIUM | Recreated bind group every frame | ✅ Fixed (4.2) |
| `src/hooks/useKeyboard.ts` | LOW | Missing screenshot keybinding | ✅ Fixed (1.5) |
| `src/app/page.tsx` | LOW | Visibility listener never torn down | ✅ Fixed (2.4) |
| `next.config.mjs` | MEDIUM | `removeConsole` strips error/warn | ✅ Fixed (3.3) |
| `src/utils/cpu-optimizations.ts` | MEDIUM | No dirty-check for Float32Array uniforms | ✅ Fixed (2.1) |
| `src/performance/validation.ts` | LOW | Full test framework, never called | ⬜ Open |
| `physics-engine/_legacy_src/` | LOW | 1.2K lines of dead Rust code | ⬜ Open |
| `src/utils/cpu-optimizations.ts` | LOW | `PhysicsCache` is never imported anywhere | ⬜ Open |
| `src/app/layout.tsx` | LOW | 14 `dangerouslySetInnerHTML` usages for JSON-LD | ⬜ Open |
| `src/components/ui/WasmLoadingOverlay.tsx` | MEDIUM | New — WASM loading state overlay | ✅ Fixed (6.1 Batch 3) |
| `src/app/page.tsx` | MEDIUM | WASM loading polling + safety timeout | ✅ Fixed (6.1 Batch 3) |
| `src/performance/stress-test.ts` | MEDIUM | New — offscreen GPU stress test for startup calibration | ✅ Fixed (6.2 Batch 5) |
| `src/hooks/useSystemProfile.ts` | MEDIUM | New — device calibration pipeline (detect→stress→optimise→ready) | ✅ Fixed (6.2 Batch 5) |
| `src/components/ui/SystemProfileScreen.tsx` | MEDIUM | New — root-level loading gate UI with 4 stages | ✅ Fixed (6.2 Batch 5) |
| `src/utils/device-detection.ts` | LOW | Enhanced — `DeviceCapabilityProfile`, `buildDeviceProfile()`, GPU vendor detection | ✅ Fixed (6.2 Batch 5) |
| `src/hooks/useCamera.ts` | MEDIUM | New — `startAllViewpointsTour()`, tour state machine cycling 12 viewpoints | ✅ Fixed (6.3 Batch 6) |
| `src/components/ui/CinematicOverlay.tsx` | LOW | New — viewpoint name badge + tour X/12 progress | ✅ Fixed (6.3 Batch 6) |
| `src/components/ui/ControlPanel.tsx` | LOW | New — dedicated Viewpoint Tour section with progress bar | ✅ Fixed (6.3 Batch 6) |
| `src/configs/simulation.config.ts` | LOW | New — `starDensity` config, `autoSpin` default 0.005→0.001 | ✅ Fixed (7.1 Batch 7) |
| `src/shaders/blackhole/chunks/background.ts` | LOW | Star density threshold modulation via `u_star_density` uniform | ✅ Fixed (7.1 Batch 7) |
| `src/shaders/blackhole/raymarching.wgsl.ts` | LOW | WGSL density threshold + haze reduction | ✅ Fixed (7.1 Batch 7) |
| `src/shaders/blackhole/chunks/common.ts` | LOW | New `u_star_density` uniform declaration | ✅ Fixed (7.1 Batch 7) |
| `src/types/simulation.ts` | LOW | New `starDensity` optional field + DEFAULT_PARAMS | ✅ Fixed (7.1 Batch 7) |

---

## Completed Fixes (Batch 1 — June 12, 2026)

| # | Fix | Files Changed |
|---|-----|--------------|
| 1.5 | Screenshot keybinding (P/S) | `src/hooks/useKeyboard.ts` |
| 1.4 | Worker crash retry (3 retries + exponential backoff + main-thread fallback) | `src/engine/physics-bridge.ts` |
| 1.3 | WASM memory detach guard (rebind views on every tick) | `src/engine/physics-bridge.ts` |
| 1.2 | Framebuffer fallback (RGBA8 when `EXT_color_buffer_float` absent) | `src/rendering/bloom.ts`, `reprojection.ts`, `webgl/renderer.ts` |
| 2.1 | Float32Array dirty-checking in UniformBatcher | `src/utils/cpu-optimizations.ts` |
| 2.4 | Visibility listener cleanup on unmount | `src/app/page.tsx` |
| 3.3 | Preserve console.error/warn in production builds | `next.config.mjs` |
| 4.2 | Cache WebGPU render bind groups (avoid per-frame createBindGroup) | `src/rendering/webgpu/renderer.ts` |

## Completed Fixes (Batch 2 — LUT Consolidation & Dead Code Removal)

| # | Fix | Files Changed |
|---|-----|--------------|
| 4.1 | Delete `useAnimation.ts` (duplicated by `WebGLRenderer`) | `src/hooks/useAnimation.ts` (deleted) |
| 4.1 | Remove unused LUT refs from `useWebGL.ts` return value | `src/hooks/useWebGL.ts` |
| 4.1 | Deprecate `SpectralManager` (never wired into pipeline) | `src/rendering/spectral.ts` |

## Completed Fixes (Batch 3 — Realistic Starfield)

| # | Fix | Files Changed |
|---|-----|--------------|
| 3 | Realistic starfield with Milky Way, 3-layer stars, OBAFGKM colors, glow, nebula, dust lanes | `src/shaders/blackhole/chunks/background.ts` |
| 3 | WGSL starfield port with spectral colors | `src/shaders/blackhole/raymarching.wgsl.ts` |

## Completed Fixes (Batch 4 — WASM Loading State)

| # | Fix | Files Changed |
|---|-----|--------------|
| 6.1 | WASM loading overlay with animated rings + progress bar | `src/components/ui/WasmLoadingOverlay.tsx` (new) |
| 6.1 | Polling + 15s safety timeout in page.tsx | `src/app/page.tsx` |

## Completed Fixes (Batch 5 — System Profile Loading Gate)

| # | Fix | Files Changed |
|---|-----|--------------|
| 6.2 | Offscreen GPU stress test (WebGL2 quad, 2.5s, FPS measurement) | `src/performance/stress-test.ts` (new) |
| 6.2 | Device detection: `DeviceCapabilityProfile`, `buildDeviceProfile()`, `detectGPUVendor()` | `src/utils/device-detection.ts` |
| 6.2 | Startup calibration config (stress test duration, FPS thresholds) | `src/configs/performance.config.ts` |
| 6.2 | `useSystemProfile` hook: detect→stress→optimise→ready orchestration | `src/hooks/useSystemProfile.ts` (new) |
| 6.2 | `SystemProfileScreen` root-level loading gate with 4 stages + progress bar | `src/components/ui/SystemProfileScreen.tsx` (new) |
| 6.2 | Wired into page.tsx as early-return before main canvas mounts | `src/app/page.tsx` |

## Completed Fixes (Batch 6 — Viewpoints Cinematic Tour)

| # | Fix | Files Changed |
|---|-----|--------------|
| 6.3 | `startAllViewpointsTour()`: cycles all 12 VIEWPOINTS, fly→dwell→advance→recover | `src/hooks/useCamera.ts` |
| 6.3 | Tour state machine: `tourIndex`, `tourTotal`, dwell-phase advancement logic | `src/hooks/useCamera.ts` |
| 6.3 | `"viewpoints-tour"` mode added to `cinematicMode` union type everywhere | `src/hooks/useCamera.ts`, `src/components/ui/*.tsx` |
| 6.3 | Dedicated "Viewpoint Tour" UI section in ControlPanel with progress bar + X/12 counter | `src/components/ui/ControlPanel.tsx` |
| 6.3 | CinematicOverlay shows viewpoint name badge + tour progress indicator | `src/components/ui/CinematicOverlay.tsx` |
| 6.3 | IdentityHUD shows "Metric: Viewpoints Tour" status text | `src/components/ui/IdentityHUD.tsx` |

## Completed Fixes (Batch 7 — Star Density, AutoSpin, Bug Fixes)

| # | Fix | Files Changed |
|---|-----|--------------|
| 7.1 | `starDensity` param + config (range 0–2, default 1.0) | `src/types/simulation.ts`, `src/configs/simulation.config.ts` |
| 7.1 | `u_star_density` GLSL uniform + threshold modulation in starfield() | `src/shaders/blackhole/chunks/common.ts`, `background.ts` |
| 7.1 | WebGL renderer uniform upload for `u_star_density` | `src/rendering/webgl/renderer.ts` |
| 7.1 | Star Density slider in ControlPanel performance tab | `src/components/ui/ControlPanel.tsx` |
| 7.1 | WGSL star density reduction: layers 2-4 thresholds + haze ~30% | `src/shaders/blackhole/raymarching.wgsl.ts` |
| 7.1 | Milky Way haze reduction in GLSL (0.018→0.013, bulge 0.015→0.010) + WGSL (0.018→0.013) | `src/components/blackhole/chunks/background.ts`, `raymarching.wgsl.ts` |
| 7.1 | AutoSpin default speed reduced 0.005→0.001 rad/frame (~5× slower) | `src/configs/simulation.config.ts` |
| 7.1 | Critical runtime bug: stress-test.ts `measure()` referenced deleted `g` variable | `src/performance/stress-test.ts` |
| 7.1 | Dead code: removed unused `STAGE_ICONS` from SystemProfileScreen | `src/components/ui/SystemProfileScreen.tsx` |
| 7.1 | Dead code: removed unused `ViewpointDef` import from useCamera | `src/hooks/useCamera.ts` |
| 7.1 | Non-null assertion cleanup: device-detection.ts (IIFE→direct assignment) | `src/utils/device-detection.ts` |

## Summary of Top 5 Remaining Recommendations

1. **Add missing CI checks**: Wire `cargo check` + `clippy` into the CI pipeline, not just lefthook.
2. **Adopt `useReducer`**: Replace the 15+ `useState` calls in `page.tsx` with a reducer-based state machine to prevent cascading re-renders.
3. **WASM integration tests from TypeScript**: Add at least 1-2 tests that instantiate the WASM module and verify metric computations.
4. **Consolidate SpectralManager dead code**: `src/rendering/spectral.ts` remains deprecated but not removed.
5. **WebGPU compute shader validation**: Validate the WGSL compute kernel output against the GLSL shader ground truth.
