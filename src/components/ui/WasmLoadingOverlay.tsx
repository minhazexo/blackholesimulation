"use client";

import { motion, AnimatePresence } from "framer-motion";

/**
 * WASM Compilation Loading Overlay
 *
 * Displays a "Compiling Physics Kernel..." status bar with a subtle
 * indeterminate progress animation while the WebAssembly physics engine
 * initializes. Fades out when physicsBridge.isReady() returns true.
 *
 * Fixes issue 6.1: no loading state during WASM compilation.
 */
export function WasmLoadingOverlay({ visible }: { visible: boolean }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
          className="fixed inset-0 z-[90] flex flex-col items-center justify-center bg-black select-none"
        >
          {/* Background: subtle animated gradient */}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(30,40,80,0.3)_0%,transparent_70%)]" />

          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.15, duration: 0.5 }}
            className="relative flex flex-col items-center gap-6"
          >
            {/* Pulsing ring animation */}
            <div className="relative w-16 h-16">
              <div className="absolute inset-0 rounded-full border border-white/10" />
              <div className="absolute inset-0 rounded-full border-t-white/80 border-r-transparent border-b-transparent border-l-transparent border-2 animate-spin" />
              <div className="absolute inset-2 rounded-full border border-white/5" />
              <div className="absolute inset-2 rounded-full border-t-blue-400/60 border-r-transparent border-b-transparent border-l-transparent border-2 animate-spin"
                style={{ animationDirection: "reverse", animationDuration: "1.5s" }}
              />
            </div>

            {/* Status text */}
            <div className="flex flex-col items-center gap-1.5">
              <span className="text-[11px] font-mono uppercase tracking-[0.25em] text-white/70">
                Compiling Physics Kernel
              </span>
              <span className="text-[9px] font-mono tracking-[0.15em] text-white/30">
                Initializing WASM Engine
              </span>
            </div>

            {/* Indeterminate progress bar */}
            <div className="w-48 h-px bg-white/5 overflow-hidden rounded-full">
              <motion.div
                className="h-full w-1/3 bg-gradient-to-r from-transparent via-white/40 to-transparent rounded-full"
                animate={{ x: ["-100%", "400%"] }}
                transition={{
                  duration: 1.8,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
              />
            </div>

            {/* Hint text */}
            <p className="text-[8px] font-mono tracking-[0.1em] text-white/20 mt-2">
              Loading relativistic geodesic integrator
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
