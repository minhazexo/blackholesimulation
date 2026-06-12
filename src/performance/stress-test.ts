/**
 * Offscreen Frame Stress Test
 *
 * Renders a simple fullscreen quad with a WebGL2 context on an offscreen
 * canvas for a fixed duration, collecting FPS samples. The result drives
 * the initial quality preset recommendation before the main canvas mounts.
 *
 * Purpose: measure raw GPU fill-rate / shader throughput without the
 * overhead of the full ray-marching pipeline, so we can pick a safe
 * starting preset on any device.
 */

import { PERFORMANCE_CONFIG } from "@/configs/performance.config";

export interface StressTestResult {
  /** Average FPS across the measurement window */
  averageFPS: number;
  /** Minimum FPS recorded */
  minFPS: number;
  /** Maximum FPS recorded */
  maxFPS: number;
  /** Number of frame samples collected */
  sampleCount: number;
  /** Actual measurement duration in ms */
  durationMs: number;
  /** Whether the test yielded a reliable measurement */
  reliable: boolean;
}

/**
 * Minimal vertex + fragment shader that draws a gradient quad.
 * Lightweight enough to stress the rasteriser without heavy shading,
 * providing a baseline for raw GPU throughput.
 */
const VERT_SRC = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG_SRC = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
void main() {
  vec2 p = v_uv * 2.0 - 1.0;
  float d = length(p);
  fragColor = vec4(sin(d * 30.0) * 0.5 + 0.5,
                   cos(d * 20.0) * 0.5 + 0.5,
                   sin(d * 40.0 + 1.0) * 0.5 + 0.5,
                   1.0);
}`;

/**
 * Compile a shader, returning null on failure.
 */
function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/**
 * Link a program, returning null on failure.
 */
function linkProgram(
  gl: WebGL2RenderingContext,
  vs: WebGLShader,
  fs: WebGLShader,
): WebGLProgram | null {
  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    gl.deleteProgram(prog);
    return null;
  }
  return prog;
}

/**
 * Run an offscreen stress test that renders frames for `durationMs`
 * and returns FPS statistics.
 *
 * @param durationMs  How long to run the test (default: 2500).
 * @param warmupMs    Skip samples for this initial period (default: 300).
 * @param targetSize  Size of the offscreen canvas (default: 512x512).
 */
export function runStressTest(
  durationMs: number = PERFORMANCE_CONFIG.startup.stressTestDurationMs,
  warmupMs: number = PERFORMANCE_CONFIG.startup.stressTestWarmupMs,
  targetSize: number = 512,
): Promise<StressTestResult> {
  return new Promise((resolve) => {
    const cfg = PERFORMANCE_CONFIG.startup;

    // Create offscreen canvas + WebGL2 context
    const canvas = document.createElement("canvas");
    canvas.width = targetSize;
    canvas.height = targetSize;
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      depth: false,
      stencil: false,
      antialias: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false,
    });

    // If we can't get WebGL2, return unreliable result immediately.
    if (!gl) {
      resolve({
        averageFPS: 0,
        minFPS: 0,
        maxFPS: 0,
        sampleCount: 0,
        durationMs: 0,
        reliable: false,
      });
      return;
    }

    // Compile shaders with status checks
    const vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
    if (!vs || !fs) {
      resolve({
        averageFPS: 0,
        minFPS: 0,
        maxFPS: 0,
        sampleCount: 0,
        durationMs: 0,
        reliable: false,
      });
      return;
    }

    const prog = linkProgram(gl, vs, fs);
    if (!prog) {
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      resolve({
        averageFPS: 0,
        minFPS: 0,
        maxFPS: 0,
        sampleCount: 0,
        durationMs: 0,
        reliable: false,
      });
      return;
    }

    gl.useProgram(prog);

    // Full-screen quad (two triangles forming a NDC square)
    const verts = new Float32Array([
      -1, -1, 1, -1, -1, 1, 1, -1, 1, 1, -1, 1,
    ]);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);

    const posLoc = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    gl.viewport(0, 0, targetSize, targetSize);

    // Warmup: a few frames to stabilise GPU clocks
    const warmupFrames = Math.max(1, Math.floor(warmupMs / 16));
    for (let i = 0; i < warmupFrames; i++) {
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    // Measurement phase
    const startTime = performance.now();
    const sampleTimes: number[] = [];
    let frameCount = 0;
    let lastTime = startTime;
    const maxFrames = cfg.stressTestTargetFrames;

    function measure() {
      const now = performance.now();
      const elapsed = now - startTime;

      if (elapsed >= durationMs || frameCount >= maxFrames) {
        // Safe to assert non-null: we already returned `reliable: false`
        // above if any resource was null, so measure() is never called
        // without a valid context + program + shaders + buffer.
        gl!.deleteProgram(prog!);
        gl!.deleteShader(vs!);
        gl!.deleteShader(fs!);
        gl!.deleteBuffer(buf!);

        if (sampleTimes.length < cfg.minSamplesForReliable) {
          resolve({
            averageFPS: 0,
            minFPS: 0,
            maxFPS: 0,
            sampleCount: sampleTimes.length,
            durationMs: now - startTime,
            reliable: false,
          });
          return;
        }

        let sum = 0;
        let minFPS = Infinity;
        let maxFPS = -Infinity;
        for (const fps of sampleTimes) {
          sum += fps;
          if (fps < minFPS) minFPS = fps;
          if (fps > maxFPS) maxFPS = fps;
        }

        resolve({
          averageFPS: sum / sampleTimes.length,
          minFPS,
          maxFPS,
          sampleCount: sampleTimes.length,
          durationMs: now - startTime,
          reliable: true,
        });
        return;
      }

      gl!.clear(gl!.COLOR_BUFFER_BIT);
      gl!.drawArrays(gl!.TRIANGLES, 0, 6);
      gl!.finish();

      frameCount++;
      const dt = now - lastTime;
      lastTime = now;
      if (dt > 0) {
        sampleTimes.push(1000 / dt);
      }

      requestAnimationFrame(measure);
    }

    requestAnimationFrame(measure);
  });
}
