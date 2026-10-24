import { useCallback, useEffect, useState } from "react";

export interface LocalEngineControls {
  status: LocalVoiceStatus | null;
  install(): Promise<void>;
  remove(): Promise<void>;
}

export function useLocalVoiceEngine(): LocalEngineControls {
  const bridge = typeof window === "undefined" ? undefined : window.ogb?.localVoice;
  const [status, setStatus] = useState<LocalVoiceStatus | null>(null);
  const refresh = useCallback(() => {
    if (!bridge) return;
    void bridge.status().then(setStatus, () => setStatus(null));
  }, [bridge]);
  useEffect(() => {
    if (!bridge) return;
    refresh();
    return bridge.onProgress((progress) => setStatus((previous) => previous && { ...previous, ...progress, installing: true }));
  }, [bridge, refresh]);
  const install = useCallback(async () => {
    if (!bridge) return;
    setStatus((previous) => previous && { ...previous, installing: true, error: undefined });
    await bridge.install().catch(() => undefined);
    refresh();
  }, [bridge, refresh]);
  const remove = useCallback(async () => {
    if (!bridge) return;
    await bridge.remove().catch(() => undefined);
    refresh();
  }, [bridge, refresh]);
  return { status: status?.engine === "whisper" ? status : null, install, remove };
}
