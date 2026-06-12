/**
 * useSystemProfile – Startup Device Calibration Hook
 *
 * Orchestrates the initial device capability detection, offscreen stress
 * test, preset recommendation, and signals readiness so the root-level
 * loading gate (SystemProfileScreen) can dismiss.
 *
 * Unlike the previous chained-effects approach, this hook uses a single
 * orchestration effect that awaits each step sequentially, avoiding the
 * race conditions inherent to cascade-style React state updates.
 */

import { useState, useEffect, useRef } from "react";
import { runStressTest, type StressTestResult } from "@/performance/stress-test";
import { buildDeviceProfile, type DeviceCapabilityProfile } from "@/utils/device-detection";
import { PERFORMANCE_CONFIG } from "@/configs/performance.config";
import { getPreset, type PresetName, type FeatureToggles } from "@/types/features";

export type ProfileStage =
  | "detecting-hardware"
  | "running-stress-test"
  | "optimizing-settings"
  | "loading-physics"
  | "ready"
  | "error";

export interface ProfileStageInfo {
  stage: ProfileStage;
  /** Human-readable label shown in the loading UI */
  label: string;
  /** Normalised progress for this stage (0–1) */
  stageProgress: number;
  /** Overall progress across all stages (0–1) */
  overallProgress: number;
  /** Any error message for the error stage */
  errorMessage?: string;
}

export interface SystemProfile {
  /** Device capability snapshot */
  capability: DeviceCapabilityProfile | null;
  /** Stress test result (null if not yet completed) */
  stressTest: StressTestResult | null;
  /** Recommended preset discovered through calibration */
  recommendedPreset: PresetName;
  /** Features corresponding to the recommended preset */
  recommendedFeatures: FeatureToggles;
  /** Current stage of the calibration pipeline */
  stage: ProfileStage;
}

/** Weight of each stage toward the overall progress bar. Sums to 1.0. */
const STAGE_WEIGHTS: Record<ProfileStage, number> = {
  "detecting-hardware": 0.15,
  "running-stress-test": 0.40,
  "optimizing-settings": 0.10,
  "loading-physics": 0.35,
  ready: 1.0,
  error: 1.0,
};

const STAGES_IN_ORDER: ProfileStage[] = [
  "detecting-hardware",
  "running-stress-test",
  "optimizing-settings",
  "loading-physics",
  "ready",
];

const STAGE_LABELS: Record<ProfileStage, string> = {
  "detecting-hardware": "Detecting Hardware",
  "running-stress-test": "Running Stress Test",
  "optimizing-settings": "Optimising Settings",
  "loading-physics": "Loading Physics Engine",
  ready: "System Calibration Complete",
  error: "Calibration Error",
};

function computeOverallProgress(
  stage: ProfileStage,
  stageProgress: number,
): number {
  let accumulated = 0;
  for (const s of STAGES_IN_ORDER) {
    if (s === stage) {
      return accumulated + (STAGE_WEIGHTS[s] ?? 0) * stageProgress;
    }
    if (s === "ready") break;
    accumulated += STAGE_WEIGHTS[s] ?? 0;
  }
  return accumulated;
}

function setStage(
  stage: ProfileStage,
  stageProgress: number,
  errorMessage?: string,
): ProfileStageInfo {
  return {
    stage,
    label: STAGE_LABELS[stage] ?? stage,
    stageProgress,
    overallProgress: computeOverallProgress(stage, stageProgress),
    errorMessage,
  };
}

export function useSystemProfile() {
  const [profile, setProfile] = useState<SystemProfile>({
    capability: null,
    stressTest: null,
    recommendedPreset: "balanced",
    recommendedFeatures: getPreset("balanced"),
    stage: "detecting-hardware",
  });

  const [stageInfo, setStageInfo] = useState<ProfileStageInfo>(
    setStage("detecting-hardware", 0),
  );

  // Track whether the component is still mounted to avoid state updates
  // after unmount.
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    // Single orchestration function that runs all stages sequentially.
    async function calibrate() {
      try {
        // ── Stage 1: Detect hardware ──
        const probeCanvas = document.createElement("canvas");
        probeCanvas.width = 1;
        probeCanvas.height = 1;

        const gl = probeCanvas.getContext("webgl2", {
          alpha: false,
          depth: false,
          stencil: false,
          antialias: false,
          powerPreference: "high-performance",
          preserveDrawingBuffer: false,
        });

        if (!mountedRef.current) return;

        // Update progress to 50% of this stage (context acquired)
        setStageInfo(setStage("detecting-hardware", 0.5));

        const capability = buildDeviceProfile(gl);

        if (!mountedRef.current) return;
        setProfile((prev) => ({ ...prev, capability }));
        setStageInfo(setStage("detecting-hardware", 1.0));

        // ── Stage 2: Run stress test ──
        if (!mountedRef.current) return;
        setProfile((prev) => ({ ...prev, stage: "running-stress-test" }));
        setStageInfo(setStage("running-stress-test", 0));

        const stressTest = await runStressTest();

        if (!mountedRef.current) return;
        setProfile((prev) => ({ ...prev, stressTest }));
        setStageInfo(setStage("running-stress-test", 1.0));

        // ── Stage 3: Determine optimal preset ──
        if (!mountedRef.current) return;
        setProfile((prev) => ({ ...prev, stage: "optimizing-settings" }));
        setStageInfo(setStage("optimizing-settings", 0));

        const recommended = determineOptimalPreset(capability, stressTest);
        const features = getPreset(recommended);

        if (!mountedRef.current) return;
        setProfile((prev) => ({
          ...prev,
          recommendedPreset: recommended,
          recommendedFeatures: features,
        }));
        setStageInfo(setStage("optimizing-settings", 1.0));

        // ── Stage 4: Signal ready ──
        // (Physics init is handled by page.tsx's existing effect, which
        //  runs in parallel with this calibration.)
        if (!mountedRef.current) return;
        setProfile((prev) => ({
          ...prev,
          stage: "ready",
        }));
        setStageInfo(setStage("ready", 1.0));
      } catch (err) {
        if (!mountedRef.current) return;
        const msg = err instanceof Error ? err.message : String(err);
        setProfile((prev) => ({ ...prev, stage: "ready" }));
        setStageInfo(setStage("ready", 1.0, msg));
      }
    }

    calibrate();

    return () => {
      mountedRef.current = false;
    };
  }, []);

  const isReady = profile.stage === "ready";

  return {
    profile,
    stageInfo,
    isReady,
  };
}

/**
 * Determine the optimal quality preset based on hardware info and
 * stress test results.
 */
function determineOptimalPreset(
  capability: DeviceCapabilityProfile | null,
  stressTest: StressTestResult | null,
): PresetName {
  const cfg = PERFORMANCE_CONFIG.startup;

  // ── Fallback: no reliable stress test → guess from hardware ──
  if (!stressTest?.reliable) {
    if (capability) {
      if (capability.gpuVendor === "nvidia" || capability.gpuVendor === "amd") {
        return "high-quality";
      }
      if (capability.gpuVendor === "apple" && !capability.isMobile) {
        return "high-quality";
      }
      if (capability.deviceMemoryGB >= 8 && capability.hardwareConcurrency >= 8) {
        return "high-quality";
      }
      if (capability.isMobile) {
        return "balanced";
      }
    }
    return "balanced";
  }

  // ── Use stress test FPS thresholds ──
  const avgFps = stressTest.averageFPS;
  let recommended: PresetName;

  if (avgFps >= cfg.ultraThreshold) {
    recommended = "ultra-quality";
  } else if (avgFps >= cfg.highThreshold) {
    recommended = "high-quality";
  } else if (avgFps >= cfg.balancedThreshold) {
    recommended = "balanced";
  } else {
    recommended = "maximum-performance";
  }

  // ── Mobile / integrated GPU hard cap ──
  if (capability?.isMobile || capability?.hasIntegratedGPU) {
    if (recommended === "ultra-quality") {
      recommended = "high-quality";
    }
  }

  return recommended;
}
