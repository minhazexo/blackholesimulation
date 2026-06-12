/**
 * Device Detection Utilities
 *
 * Provides functions for detecting mobile devices and integrated GPUs
 * to apply appropriate performance optimizations.
 *
 * Requirements: 16.1, 16.2, 16.3, 16.4, 16.5
 */

/** Capability profile summarising the device's hardware class. */
export interface DeviceCapabilityProfile {
  isMobile: boolean;
  hasIntegratedGPU: boolean;
  gpuRenderer: string;
  gpuVendor: string;
  devicePixelRatio: number;
  /** Max texture size reported by WebGL2, or 0 if unknown */
  maxTextureSize: number;
  /** Approximate device memory in GB (from deviceMemory API), or 0 if unknown */
  deviceMemoryGB: number;
  /** Approximate hardware concurrency (CPU logical cores), or 0 if unknown */
  hardwareConcurrency: number;
  /** Whether app runs inside an in-app browser (Instagram, FB, etc.) */
  isInApp: boolean;
  /** WebGL2 rendering context for further queries, or null */
  gl: WebGL2RenderingContext | null;
}

/**
 * Hardware information for the current device
 */
export interface HardwareInfo {
  isMobile: boolean;
  hasIntegratedGPU: boolean;
  devicePixelRatio: number;
}

/**
 * Detects if the current device is a mobile device
 *
 * Uses user agent string and screen width to determine mobile status
 * Requirements: 16.1
 *
 * @returns true if device is mobile, false otherwise
 */
export function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }

  // Check user agent for mobile device indicators
  const mobileUserAgentPattern =
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;
  const isMobileUserAgent = mobileUserAgentPattern.test(navigator.userAgent);

  // Check screen width (mobile devices typically < 768px)
  const isMobileWidth =
    typeof window !== "undefined" && window.innerWidth < 768;

  return isMobileUserAgent || isMobileWidth;
}

/**
 * Detects if the current device has an integrated GPU
 *
 * Uses WebGL debug renderer info to identify integrated graphics
 * Requirements: 16.2
 *
 * @param gl - WebGL rendering context (optional)
 * @returns true if device has integrated GPU, false otherwise or if detection fails
 */
export function hasIntegratedGPU(gl?: WebGL2RenderingContext | null): boolean {
  if (!gl) {
    // Conservative default if no context provided
    return false;
  }

  try {
    const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
    if (debugInfo) {
      const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
      if (typeof renderer === "string") {
        // Check for common integrated GPU identifiers
        const integratedGPUPattern =
          /Intel|AMD.*Integrated|Mali|Adreno|PowerVR|VideoCore/i;
        return integratedGPUPattern.test(renderer);
      }
    }
  } catch (error) {
    // If detection fails, return conservative default
    // eslint-disable-next-line no-console
    console.warn("Failed to detect GPU type:", error);
  }

  return false;
}

/**
 * Attempt to parse the GPU vendor name from the unmasked renderer string.
 * Returns a short vendor string like "nvidia", "amd", "intel", "apple",
 * "qualcomm", "arm", or "unknown".
 */
export function detectGPUVendor(
  gl: WebGL2RenderingContext | null,
): string {
  if (!gl) return "unknown";
  try {
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    if (!ext) return "unknown";
    const renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
    if (typeof renderer !== "string") return "unknown";
    const r = renderer.toLowerCase();
    if (r.includes("nvidia")) return "nvidia";
    if (r.includes("geforce")) return "nvidia";
    if (r.includes("quadro")) return "nvidia";
    if (r.includes("tesla")) return "nvidia";
    if (r.includes("amd")) return "amd";
    if (r.includes("radeon")) return "amd";
    if (r.includes("intel")) return "intel";
    if (r.includes("apple") && r.includes("metal")) return "apple";
    if (r.includes("qualcomm")) return "qualcomm";
    if (r.includes("adreno")) return "qualcomm";
    if (r.includes("mali")) return "arm";
    if (r.includes("powervr")) return "img";
    return "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Probe whether the device supports EXT_color_buffer_float / EXT_float_blend
 * which is required for HDR framebuffers.
 */
export function hasFloatFramebufferSupport(
  gl: WebGL2RenderingContext | null,
): boolean {
  if (!gl) return false;
  try {
    return !!(
      gl.getExtension("EXT_color_buffer_float") &&
      gl.getExtension("EXT_float_blend")
    );
  } catch {
    return false;
  }
}

/**
 * Build a full DeviceCapabilityProfile synchronously (or as close to sync
 * as possible) from a WebGL2 context. Returns a partial profile; the caller
 * may enrich it with async information.
 */
export function buildDeviceProfile(
  gl: WebGL2RenderingContext | null,
): DeviceCapabilityProfile {
  const isMobile = isMobileDevice();
  const debugExt =
    gl && gl.getExtension("WEBGL_debug_renderer_info");
  const gpuRenderer = debugExt
    ? String(gl!.getParameter(debugExt.UNMASKED_RENDERER_WEBGL))
    : "";

  return {
    isMobile,
    hasIntegratedGPU: hasIntegratedGPU(gl),
    gpuRenderer,
    gpuVendor: detectGPUVendor(gl),
    devicePixelRatio:
      typeof window !== "undefined" ? window.devicePixelRatio : 1,
    maxTextureSize: gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : 0,
    deviceMemoryGB:
      typeof navigator !== "undefined" && "deviceMemory" in navigator
        ? (navigator as any).deviceMemory
        : 0,
    hardwareConcurrency:
      typeof navigator !== "undefined" && navigator.hardwareConcurrency
        ? navigator.hardwareConcurrency
        : 0,
    isInApp:
      typeof navigator !== "undefined"
        ? /Instagram|FBAN|FBAV|LinkedIn|Threads|Messenger|Line|Twitter|MicroMessenger/i.test(
            navigator.userAgent,
          )
        : false,
    gl,
  };
}

/**
 * Gets comprehensive hardware information for the current device
 *
 * @param gl - WebGL rendering context (optional)
 * @returns Hardware information object
 */
export function getHardwareInfo(
  gl?: WebGL2RenderingContext | null,
): HardwareInfo {
  return {
    isMobile: isMobileDevice(),
    hasIntegratedGPU: hasIntegratedGPU(gl),
    devicePixelRatio:
      typeof window !== "undefined" ? window.devicePixelRatio : 1,
  };
}

/**
 * Gets the maximum ray steps for mobile devices
 *
 * Requirements: 16.3 - Mobile devices capped at 100 ray steps
 *
 * @param requestedSteps - The requested number of ray steps
 * @param isMobile - Whether the device is mobile
 * @returns The capped ray steps (100 max for mobile)
 */
export function getMobileRayStepCap(
  requestedSteps: number,
  isMobile: boolean,
): number {
  if (isMobile) {
    return Math.min(requestedSteps, 100);
  }
  return requestedSteps;
}
