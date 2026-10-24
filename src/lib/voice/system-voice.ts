import { speakable } from "../../../shared/speech-text";

let current: SpeechSynthesisUtterance | null = null;

export function systemVoiceAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.speechSynthesis !== "undefined" && typeof window.SpeechSynthesisUtterance !== "undefined";
}

export function speakWithSystemVoice(text: string, lang?: string): Promise<boolean> {
  const value = speakable(text).trim();
  if (!value || !systemVoiceAvailable()) return Promise.resolve(false);
  stopSystemVoice();
  const utterance = new window.SpeechSynthesisUtterance(value);
  if (lang) utterance.lang = lang;
  current = utterance;
  return new Promise((resolve) => {
    const done = (finished: boolean) => {
      if (current === utterance) current = null;
      resolve(finished);
    };
    utterance.onend = () => done(true);
    utterance.onerror = () => done(false);
    try {
      window.speechSynthesis.speak(utterance);
    } catch {
      done(false);
    }
  });
}

export function stopSystemVoice(): void {
  if (!systemVoiceAvailable()) return;
  current = null;
  window.speechSynthesis.cancel();
}
