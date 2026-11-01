"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { isQuietTime } from "@/lib/notification-quiet";

export function useNotifications(sessionToken: string | undefined, teamId: Id<"teams"> | undefined, userId: Id<"users"> | undefined) {
  const scope = sessionToken && teamId && userId ? { sessionToken, teamId } : "skip";
  const summary = useQuery(api.notifications.summary, scope);
  const preferences = useQuery(api.preferences.notifications, scope);
  const [sound, setSound] = useState(true);
  const context = useRef<AudioContext | null>(null), last = useRef<string | null | undefined>(undefined);
  const preference = `origin.notification-sound:${userId}`;
  useEffect(() => {
    if (!userId || !teamId) return;
    setSound(localStorage.getItem(preference) !== "off"); last.current = undefined;
    // Escape does not count as a user gesture, so creating audio then only logs an autoplay warning.
    const unlock = (event: Event) => { if (event instanceof KeyboardEvent && event.key === "Escape") return; try { context.current ||= new AudioContext(); void context.current.resume().catch(() => {}); } catch { /* Audio is optional. */ } };
    window.addEventListener("pointerdown", unlock); window.addEventListener("keydown", unlock);
    return () => { window.removeEventListener("pointerdown", unlock); window.removeEventListener("keydown", unlock); void context.current?.close(); context.current = null; };
  }, [preference, teamId, userId]);
  useEffect(() => {
    if (!summary) return;
    const previous = last.current; last.current = summary.latest;
    if (previous === undefined || !summary.latest || !summary.unread || previous === summary.latest || !sound || !preferences || isQuietTime(preferences) || document.hidden || context.current?.state !== "running") return;
    const key = `origin.notification-last:${userId}:${teamId}`;
    if (localStorage.getItem(key) === summary.latest) return;
    localStorage.setItem(key, summary.latest);
    const audio = context.current, oscillator = audio.createOscillator(), gain = audio.createGain();
    oscillator.type = "sine"; oscillator.frequency.setValueAtTime(660, audio.currentTime); oscillator.frequency.setValueAtTime(880, audio.currentTime + 0.09);
    gain.gain.setValueAtTime(0, audio.currentTime); gain.gain.linearRampToValueAtTime(0.07, audio.currentTime + 0.012); gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.25);
    oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(); oscillator.stop(audio.currentTime + 0.26); oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }, [summary, sound, teamId, userId, preferences]);
  return { summary, sound, toggleSound: () => setSound(current => { localStorage.setItem(preference, current ? "off" : "on"); return !current; }) };
}
