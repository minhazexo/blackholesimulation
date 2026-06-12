import React, { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, Radio, Camera } from "lucide-react";
import type { ViewpointDef } from "@/configs/viewpoints";

interface CinematicOverlayProps {
  isCinematic: boolean;
  zoom: number;
  cinematicMode?: "orbit" | "dive" | "viewpoint" | "viewpoints-tour" | null;
  currentViewpointDef?: ViewpointDef | null;
  tourIndex?: number;
  tourTotal?: number;
}

// Schwarzschild Radius (Rs) is effectively 2.0 in the simulation's visual units for the "Danger Zone"
// The event horizon is at r=1.0 * Mass, typically. But visually we often scale things.
// Based on useCamera, 2.0 seems to be the critical limit.
const HORIZON_LIMIT = 2.0;
const WARNING_LIMIT = 4.0;
const CRITICAL_LIMIT = 2.5;

export const CinematicOverlay = ({
  isCinematic,
  zoom,
  cinematicMode,
  currentViewpointDef,
  tourIndex,
  tourTotal,
}: CinematicOverlayProps) => {
  // Calculate proximity factor (0 to 1) where 1 is touching the horizon
  const proximity = useMemo(() => {
    if (zoom > WARNING_LIMIT) return 0;
    return Math.max(
      0,
      Math.min(1, (WARNING_LIMIT - zoom) / (WARNING_LIMIT - HORIZON_LIMIT)),
    );
  }, [zoom]);

  const isCritical = zoom < CRITICAL_LIMIT;

  return (
    <AnimatePresence>
      {isCinematic && (
        <div className="fixed inset-0 pointer-events-none z-40 flex flex-col justify-between">
          {/* Viewpoint title bar */}
          {(cinematicMode === "viewpoint" ||
            cinematicMode === "viewpoints-tour") &&
            currentViewpointDef && (
              <motion.div
                initial={{ opacity: 0, y: -15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ delay: 0.3, duration: 0.6 }}
                className="absolute top-0 left-0 right-0 flex justify-center pt-6"
              >
                <div className="flex items-center gap-3 px-5 py-2.5 bg-black/40 backdrop-blur-md border border-white/10 rounded-full">
                  <Camera className="w-3.5 h-3.5 text-white/70" />
                  <div className="flex flex-col items-center">
                    <span className="text-[10px] font-black uppercase tracking-[0.25em] text-white">
                      {currentViewpointDef.name}
                    </span>
                    <span className="text-[7px] font-mono text-white/40 uppercase tracking-[0.2em]">
                      {currentViewpointDef.subtitle}
                    </span>
                  </div>
                  {/* Tour progress badge */}
                  {cinematicMode === "viewpoints-tour" &&
                    tourTotal !== undefined &&
                    tourIndex !== undefined && (
                      <div className="flex items-center gap-1.5 pl-3 ml-3 border-l border-white/10">
                        <span className="text-[7px] font-mono text-white/50 uppercase tracking-[0.15em]">
                          {tourIndex + 1}/{tourTotal}
                        </span>
                      </div>
                    )}
                  <div
                    className="w-1.5 h-1.5 rounded-full"
                    style={{
                      backgroundColor: `hsl(${currentViewpointDef.hue}, 60%, 60%)`,
                      boxShadow: `0 0 8px hsla(${currentViewpointDef.hue}, 60%, 50%, 0.5)`,
                    }}
                  />
                </div>
              </motion.div>
            )}

          {/* Center Content / Effects Layer */}
          <div className="absolute inset-0 flex items-center justify-center">
            {/* Visual Noise / Signal Degradation based on Proximity */}

            {/* Redout / Blackout Gradient near Horizon */}

            {/* Critical Warning HUD */}
            {isCritical && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center gap-2"
              >
                <div className="flex items-center gap-3">
                  <AlertTriangle className="w-5 h-5 text-red-500 animate-pulse" />
                  <div className="flex flex-col items-center">
                    <span className="text-[10px] font-mono text-red-500 tracking-[0.3em] uppercase opacity-80 mb-1">
                      EVENT HORIZON PROXIMITY
                    </span>
                    <span className="text-3xl font-thin tracking-[0.2em] uppercase text-white drop-shadow-[0_0_10px_rgba(255,0,0,0.5)]">
                      CRITICAL
                    </span>
                  </div>
                  <AlertTriangle className="w-5 h-5 text-red-500 animate-pulse" />
                </div>

                <div className="h-[1px] w-32 bg-gradient-to-r from-transparent via-red-500/50 to-transparent mt-2" />

                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[8px] font-mono text-red-400/60 tracking-widest uppercase">
                    SINGULARITY APPROACH VECTOR LOCKED
                  </span>
                </div>
              </motion.div>
            )}
          </div>

          {/* Status Indicators (Corner) */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ delay: 0.5 }}
            className="absolute top-[12vh] right-8 flex flex-col items-end gap-2"
          >
            {proximity > 0 && (
              <div className="flex flex-col items-end gap-1">
                <div className="flex items-center gap-2">
                  <span className="text-[8px] font-mono text-accent-cyan/60 tracking-[0.2em] uppercase">
                    TELEMETRY LINK
                  </span>
                  <div className="h-[1px] w-8 bg-accent-cyan/20" />
                </div>
                <div className="flex items-center gap-2 px-2 py-1 bg-black/20 border border-white/5 rounded-sm backdrop-blur-sm">
                  <Radio
                    className={`w-3 h-3 ${isCritical ? "text-red-500" : "text-accent-cyan"} animate-pulse`}
                  />
                  <span
                    className={`text-[9px] font-mono tracking-[0.15em] uppercase tabular-nums ${isCritical ? "text-red-400" : "text-accent-cyan/90"}`}
                  >
                    SIGNAL: {((1 - proximity) * 100).toFixed(1)}%
                  </span>
                </div>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
