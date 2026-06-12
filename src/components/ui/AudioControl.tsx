import { motion } from "framer-motion";
import { Volume2, VolumeX } from "lucide-react";

interface AudioControlProps {
  isPlaying: boolean;
  volume: number;
  onToggle: () => void;
  onVolumeChange: (volume: number) => void;
}

export const AudioControl = ({
  isPlaying,
  volume,
  onToggle,
  onVolumeChange,
}: AudioControlProps) => {
  return (
    <div className="p-3.5 sm:p-5 bg-white/[0.02] border border-white/5 rounded-2xl">
      <div className="flex items-center gap-2 text-white mb-4 px-0.5">
        <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_12px_rgba(59,130,246,0.5)]" />
        <span className="text-[8px] font-black uppercase tracking-[0.3em] whitespace-nowrap">
          Soundtrack
        </span>
        <div className="h-[1px] flex-1 bg-gradient-to-r from-white/10 to-transparent ml-2" />
      </div>

      <div className="flex items-center gap-3">
        {/* Toggle Button */}
        <button
          onClick={onToggle}
          className={`relative flex items-center justify-center w-9 h-9 rounded-xl border transition-all duration-300 active:scale-90 shrink-0 ${
            isPlaying
              ? "bg-white/15 text-white border-white/40 shadow-[0_0_12px_rgba(255,255,255,0.1)]"
              : "bg-white/[0.06] text-white/50 border-white/10 hover:bg-white/[0.1] hover:border-white/20 hover:text-white"
          }`}
          title={isPlaying ? "Pause Music" : "Play Music"}
          aria-label={isPlaying ? "Pause Music" : "Play Music"}
        >
          {isPlaying ? (
            <motion.div
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.5, opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <Volume2 className="w-4 h-4" />
            </motion.div>
          ) : (
            <motion.div
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.5, opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <VolumeX className="w-4 h-4" />
            </motion.div>
          )}
        </button>

        {/* Volume Slider */}
        <div className="flex-1 group">
          <>
            <div className="flex justify-between items-center mb-1 px-0.5">
              <span className="text-[7px] uppercase tracking-[0.15em] text-white/50 font-black">
                Volume
              </span>
              <span className="font-mono text-[9px] text-white/70 font-bold tabular-nums">
                {Math.round(volume * 100)}%
              </span>
            </div>
            <div className="relative h-4 w-full flex items-center">
              <div className="absolute left-0 right-0 h-[2px] bg-white/[0.08] rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-500/60 to-blue-300/90 rounded-full transition-all duration-300"
                  style={{ width: `${volume * 100}%` }}
                />
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
              />
              <div
                className="absolute w-2.5 h-2.5 bg-white rounded-full shadow-[0_0_12px_rgba(255,255,255,0.3)] pointer-events-none z-10 border border-white/50 group-hover:scale-125 transition-transform"
                style={{
                  left: `calc(${volume * 100}% - 5px)`,
                }}
              />
            </div>
          </>
        </div>

        {/* Animated equalizer bars — driven by CSS animation for repaint-free motion */}
        <div className="flex items-end gap-[2px] h-6 w-6 shrink-0">
          {[100, 60, 80, 45].map((delay, i) => (
            <div
              key={i}
              className={`w-[3px] rounded-full bg-gradient-to-t from-blue-500/40 to-blue-300/70 transition-opacity duration-300 ${
                isPlaying ? "animate-equalizer" : "opacity-10"
              }`}
              style={{
                height: isPlaying ? "70%" : "20%",
                animationDelay: `${delay}ms`,
                animationPlayState: isPlaying ? "running" : "paused",
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
};
