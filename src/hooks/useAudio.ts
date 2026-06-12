"use client";

import { useState, useRef, useEffect, useCallback } from "react";

const STORAGE_KEY_MUTED = "blackhole_audio_muted";
const STORAGE_KEY_VOLUME = "blackhole_audio_volume";
const AUDIO_SRC = "/videoplayback.mp3";

export interface AudioState {
  isPlaying: boolean;
  volume: number;
  hasInteracted: boolean;
}

export function useAudio() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolumeState] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_VOLUME);
      if (saved !== null) {
        const parsed = parseFloat(saved);
        return isNaN(parsed) ? 0.5 : Math.max(0, Math.min(1, parsed));
      }
    } catch {
      // localStorage unavailable
    }
    return 0.5;
  });
  const [hasInteracted, setHasInteracted] = useState(false);

  // Track whether audio should be muted (persisted)
  const [muted, setMuted] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_MUTED);
      return saved === "true";
    } catch {
      return false;
    }
  });

  // Create audio element once
  useEffect(() => {
    if (typeof window === "undefined") return;

    const audio = new Audio(AUDIO_SRC);
    audio.loop = true;
    audio.preload = "auto";
    audio.volume = volume;
    audio.muted = true; // Start muted; unmute on first user interaction
    audioRef.current = audio;

    return () => {
      audio.pause();
      audio.src = "";
      audioRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync volume to audio element
  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.volume = volume;
    }
  }, [volume]);

  // Persist muted state
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_MUTED, String(muted));
    } catch {
      // ignore
    }
  }, [muted]);

  // Persist volume state
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_VOLUME, String(volume));
    } catch {
      // ignore
    }
  }, [volume]);

  // Watch for isPlaying state changes to control audio
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying && !muted) {
      audio.muted = false;
      audio.play().catch(() => {
        // Browser blocked autoplay — will retry on first interaction
      });
    } else {
      audio.pause();
    }
  }, [isPlaying, muted]);

  /**
   * Must be called on first user interaction (click/touch/keydown)
   * to satisfy browser autoplay policies.
   */
  const handleInteraction = useCallback(() => {
    if (!hasInteracted) {
      setHasInteracted(true);
      const audio = audioRef.current;
      if (audio) {
        // Browsers permit audio context resume + audio.play() inside a
        // user gesture handler. Unmute and start playback.
        audio.muted = false;
        if (!muted) {
          audio.play().catch(() => {
            // Silent failure — user can still toggle manually
          });
        }
        setIsPlaying(!muted);
      }
    }
  }, [hasInteracted, muted]);

  const toggle = useCallback(() => {
    // Ensure interaction is flagged so further calls work.
    setHasInteracted(true);
    setMuted((prev) => !prev);
  }, []);

  const setVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    setVolumeState(clamped);
  }, []);

  return {
    isPlaying: isPlaying && !muted,
    volume,
    toggle,
    setVolume,
    handleInteraction,
    hasInteracted,
  } satisfies AudioState & {
    toggle: () => void;
    setVolume: (v: number) => void;
    handleInteraction: () => void;
  };
}
