import { useEffect, useMemo, useRef } from "react";

import { useOnCall } from "@/lib/call";
import { liveMedia, useLiveMedia } from "@/lib/live-call-media";
import { currentVoiceWake, stopVoiceWake, useVoiceWake } from "@/lib/voice/voice-session";
import { useStore, visibleMessages } from "@/state/store";

const LIVE_CHECK_MS = 5_000;

export function VoiceWakeHost() {
  const { state } = useStore();
  const wake = useVoiceWake();
  const media = useLiveMedia();
  const onCall = useOnCall();
  const targetId = wake.target?.botId;
  const bot = targetId ? state.bots.find((candidate) => candidate.id === targetId) : undefined;
  const messages = useMemo(() => (bot ? visibleMessages(bot) : []), [bot]);
  const busy = Boolean(bot?.busy);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const phase = wake.state.phase;

  useEffect(() => {
    if (targetId && state.bots.length && !bot) stopVoiceWake(targetId);
  }, [targetId, bot, state.bots.length]);

  useEffect(() => {
    currentVoiceWake()?.observeChat(messages, busy);
  }, [messages, busy]);

  useEffect(() => {
    currentVoiceWake()?.observeLive(media, busy);
  }, [media, busy]);

  useEffect(() => {
    if (targetId && onCall && phase !== "live" && phase !== "off") stopVoiceWake(targetId);
  }, [onCall, phase, targetId]);

  useEffect(() => {
    if (phase !== "live") return;
    const timer = setInterval(() => currentVoiceWake()?.observeLive(liveMedia(), busyRef.current), LIVE_CHECK_MS);
    return () => clearInterval(timer);
  }, [phase]);

  return null;
}
