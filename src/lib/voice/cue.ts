let context: AudioContext | null = null;

export function playWakeCue(): void {
  if (typeof AudioContext === "undefined") return;
  try {
    context ??= new AudioContext();
    const start = context.currentTime + 0.01;
    for (const [offset, frequency] of [[0, 660], [0.11, 880]] as const) {
      const tone = context.createOscillator();
      const gain = context.createGain();
      tone.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start + offset);
      gain.gain.exponentialRampToValueAtTime(0.12, start + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.1);
      tone.connect(gain).connect(context.destination);
      tone.start(start + offset);
      tone.stop(start + offset + 0.12);
    }
  } catch {
  }
}
