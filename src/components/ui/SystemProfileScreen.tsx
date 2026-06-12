"use client";

import { motion } from "framer-motion";
import type { ProfileStageInfo } from "@/hooks/useSystemProfile";
import {
  Cpu,
  Zap,
  Sliders,
  Atom,
  CheckCircle,
  AlertTriangle,
} from "lucide-react";

export type ProfileStage =
  | "detecting-hardware"
  | "running-stress-test"
  | "optimizing-settings"
  | "loading-physics"
  | "ready"
  | "error";

interface SystemProfileScreenProps {
  stageInfo: ProfileStageInfo;
}

/** Ordered stage list for rendering the step indicators */
const STAGE_ORDER: { stage: ProfileStage; label: string; icon: typeof Cpu }[] =
  [
    { stage: "detecting-hardware", label: "Detecting Hardware", icon: Cpu },
    { stage: "running-stress-test", label: "Stress Test", icon: Zap },
    {
      stage: "optimizing-settings",
      label: "Optimising Settings",
      icon: Sliders,
    },
    {
      stage: "loading-physics",
      label: "Physics Engine",
      icon: Atom,
    },
  ];

/**
 * Root-level loading gate that appears before the main application mounts.
 * Runs through discrete stages (hardware detection → stress test →
 * settings optimisation → physics initialisation) while displaying a
 * minimal, on-brand loading experience.
 */
export function SystemProfileScreen({ stageInfo }: SystemProfileScreenProps) {
  const currentIndex = STAGE_ORDER.findIndex(
    (s) => s.stage === stageInfo.stage,
  );
  const isReady = stageInfo.stage === "ready" && !stageInfo.errorMessage;
  const isError = stageInfo.stage === "ready" && !!stageInfo.errorMessage;

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black select-none overflow-hidden">
      {/* Background ambience */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(30,40,80,0.25)_0%,transparent_70%)]" />

      {/* Animated background particles */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {Array.from({ length: 12 }).map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-px h-px bg-white/10 rounded-full"
            style={{
              left: `${(i * 8.3) % 100}%`,
              top: `${(i * 13.7) % 100}%`,
            }}
            animate={{
              opacity: [0, 0.6, 0],
              scale: [0, 1.5, 0],
            }}
            transition={{
              duration: 3 + (i % 3),
              repeat: Infinity,
              delay: i * 0.4,
              ease: "easeInOut",
            }}
          />
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="relative flex flex-col items-center gap-12 max-w-md w-full px-6"
      >
        {/* ── Top: pulsing icon ── */}
        <div className="relative">
          <div className="w-20 h-20 rounded-full border border-white/10 flex items-center justify-center">
            {isReady ? (
              <CheckCircle className="w-9 h-9 text-green-400" />
            ) : isError ? (
              <AlertTriangle className="w-9 h-9 text-red-400" />
            ) : (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{
                  duration: 3,
                  repeat: Infinity,
                  ease: "linear",
                }}
              >
                <Atom className="w-9 h-9 text-white/60" />
              </motion.div>
            )}
          </div>
          {/* Glow ring */}
          <div
            className={`absolute -inset-1 rounded-full opacity-30 blur-sm ${
              isReady
                ? "bg-green-500/20"
                : isError
                  ? "bg-red-500/20"
                  : "bg-blue-500/20"
            }`}
          />
        </div>

        {/* ── Progress bar ── */}
        <div className="w-full">
          <div className="h-0.5 bg-white/5 rounded-full overflow-hidden">
            <motion.div
              className={`h-full rounded-full ${
                isReady
                  ? "bg-green-400"
                  : isError
                    ? "bg-red-400"
                    : "bg-gradient-to-r from-blue-400 via-white/60 to-blue-400"
              }`}
              initial={{ width: "0%" }}
              animate={{ width: `${Math.round(stageInfo.overallProgress * 100)}%` }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            />
          </div>
        </div>

        {/* ── Stage steps ── */}
        <div className="w-full flex justify-between">
          {STAGE_ORDER.map((step, idx) => {
            const Icon = step.icon;
            const isActive = idx === currentIndex;
            const isComplete = idx < currentIndex || isReady;

            return (
              <div key={step.stage} className="flex flex-col items-center gap-2">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center border transition-all duration-500 ${
                    isComplete
                      ? "bg-white/10 border-white/20"
                      : isActive
                        ? "bg-white/5 border-blue-400/40 shadow-[0_0_12px_rgba(59,130,246,0.2)]"
                        : "bg-transparent border-white/5"
                  }`}
                >
                  <Icon
                    className={`w-3 h-3 transition-colors duration-300 ${
                      isComplete
                        ? "text-white"
                        : isActive
                          ? "text-blue-400"
                          : "text-white/15"
                    }`}
                  />
                </div>
                <span
                  className={`text-[6px] font-mono uppercase tracking-[0.2em] text-center leading-tight max-w-16 transition-colors duration-300 ${
                    isComplete
                      ? "text-white/60"
                      : isActive
                        ? "text-blue-300/80"
                        : "text-white/15"
                  }`}
                >
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* ── Current stage label ── */}
        <div className="flex flex-col items-center gap-1 -mt-2">
          <span className="text-[10px] font-mono uppercase tracking-[0.25em] text-white/60">
            {isReady
              ? "System Calibration Complete"
              : stageInfo.label}
          </span>
          {!isReady && !isError && (
            <span className="text-[8px] font-mono tracking-[0.15em] text-white/25">
              {Math.round(stageInfo.overallProgress * 100)}%
            </span>
          )}
        </div>

        {/* ── Error state ── */}
        {isError && stageInfo.errorMessage && (
          <div className="px-4 py-2 bg-red-950/30 border border-red-500/20 rounded-lg">
            <p className="text-[8px] font-mono text-red-300/70 text-center">
              {stageInfo.errorMessage}
            </p>
          </div>
        )}
      </motion.div>

      {/* Footer */}
      <div className="absolute bottom-8 flex items-center gap-4 text-[6px] font-mono text-white/10 uppercase tracking-[0.5em]">
        <span>Metric: Kerr</span>
        <span className="w-1 h-1 rounded-full bg-white/10" />
        <span>System Profile v1</span>
      </div>
    </div>
  );
}
