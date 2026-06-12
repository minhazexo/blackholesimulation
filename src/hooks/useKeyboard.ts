import { useEffect, useCallback } from "react";
import type { SimulationParams } from "@/types/simulation";
import type { PresetName } from "@/types/features";
import { SIMULATION_CONFIG } from "@/configs/simulation.config";

/**
 * Keyboard controls for the black hole simulation.
 *
 * Key bindings:
 *   Arrow Left/Right  -- orbit camera horizontally (adjusts mouse.x)
 *   Arrow Up/Down     -- orbit camera vertically (adjusts mouse.y)
 *   +/=               -- zoom in
 *   -                 -- zoom out
 *   Space             -- pause/resume
 *   1-4               -- apply performance presets
 *   H                 -- toggle UI visibility
 *   D                 -- (reserved for debug overlay)
 *   P / S             -- take screenshot
 *
 * Phase 7: New feature -- keyboard navigation for accessibility and power users.
 */
interface UseKeyboardOptions {
  setParams: React.Dispatch<React.SetStateAction<SimulationParams>>;
  applyPreset: (preset: PresetName, prev: SimulationParams) => SimulationParams;
  setShowUI: React.Dispatch<React.SetStateAction<boolean>>;
  nudgeCamera?: (dTheta: number, dPhi: number) => void;
  toggleDebug?: () => void;
  onScreenshot?: () => void;
}

export function useKeyboard({
  setParams,
  applyPreset,
  setShowUI,
  nudgeCamera,
  toggleDebug,
  onScreenshot,
}: UseKeyboardOptions) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Ignore if user is typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      const ORBIT_STEP = 0.05; // Normalized mouse movement per keypress
      // Zoom step proportional to current distance: 10% of current zoom.
      // This keeps keyboard zoom feeling consistent across the 0.5–500 range.
      const ZOOM_STEP_FACTOR = 0.10;

      switch (e.key) {
        // Camera orbit (horizontal)
        case "ArrowLeft":
          e.preventDefault();
          nudgeCamera?.(ORBIT_STEP, 0);
          break;

        case "ArrowRight":
          e.preventDefault();
          nudgeCamera?.(-ORBIT_STEP, 0);
          break;

        // Camera orbit (vertical)
        case "ArrowUp":
          e.preventDefault();
          nudgeCamera?.(0, -ORBIT_STEP);
          break;

        case "ArrowDown":
          e.preventDefault();
          nudgeCamera?.(0, ORBIT_STEP);
          break;

        // Zoom in/out with proportional step size
        case "=":
        case "+":
          e.preventDefault();
          setParams((prev) => ({
            ...prev,
            zoom: Math.max(
              SIMULATION_CONFIG.zoom.min,
              prev.zoom - Math.max(0.5, prev.zoom * ZOOM_STEP_FACTOR),
            ),
          }));
          break;

        case "-":
          e.preventDefault();
          setParams((prev) => ({
            ...prev,
            zoom: Math.min(
              SIMULATION_CONFIG.zoom.max,
              prev.zoom + Math.max(0.5, prev.zoom * ZOOM_STEP_FACTOR),
            ),
          }));
          break;

        // Pause/Resume
        case " ":
          e.preventDefault();
          setParams((prev) => ({ ...prev, paused: !prev.paused }));
          break;

        // Preset hotkeys: 1=max-perf, 2=balanced, 3=high, 4=ultra
        case "1":
          setParams((prev) => applyPreset("maximum-performance", prev));
          break;
        case "2":
          setParams((prev) => applyPreset("balanced", prev));
          break;
        case "3":
          setParams((prev) => applyPreset("high-quality", prev));
          break;
        case "4":
          setParams((prev) => applyPreset("ultra-quality", prev));
          break;

        // UI visibility toggle
        case "h":
        case "H":
          setShowUI((prev) => !prev);
          break;

        // Debug Overlay Toggle (Phase 9.5)
        case "d":
        case "D":
          toggleDebug?.();
          break;

        // Screenshot capture
        case "p":
        case "P":
        case "s":
        case "S":
          e.preventDefault();
          onScreenshot?.();
          break;

        default:
          break;
      }
    },
    [setParams, applyPreset, setShowUI, nudgeCamera, toggleDebug, onScreenshot],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}
