import { BrowserWindow, ipcMain } from "electron";
import localOriginModule from "./local-origin.cjs";
import { createLocalVoice, LocalVoiceError } from "./local-voice.mjs";
import { finishSpeech, startSpeech, stopSpeech } from "./speech.mjs";

const { isLocalSender: senderIsLocal, localOnly } = localOriginModule;

export function registerVoiceIpc({ appleSpeech, directory }) {
  ipcMain.handle("speech:start", localOnly("speech:start", (event, options) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (!appleSpeech) {
      win.webContents.send("speech:end", { code: 2, reason: "unsupported-platform" });
      return;
    }
    startSpeech(win, options);
  }));
  ipcMain.handle("speech:stop", localOnly("speech:stop", () => {
    if (appleSpeech) stopSpeech();
  }));
  ipcMain.handle("speech:finish", localOnly("speech:finish", () => {
    if (appleSpeech) finishSpeech();
  }));

  const localVoice = createLocalVoice({ directory });
  const localVoiceFailure = (error) => ({ error: error instanceof LocalVoiceError ? error.code : "transcribe-failed" });
  localVoice.onProgress((progress) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && senderIsLocal({ sender: window.webContents })) window.webContents.send("voice:local-progress", progress);
    }
  });
  ipcMain.handle("voice:local-status", localOnly("voice:local-status", () => localVoice.status()));
  ipcMain.handle("voice:local-install", localOnly("voice:local-install", () =>
    localVoice.install().then(() => ({ ok: true }), localVoiceFailure)));
  ipcMain.handle("voice:local-remove", localOnly("voice:local-remove", () =>
    localVoice.remove().then(() => ({ ok: true }), localVoiceFailure)));
  ipcMain.handle("voice:local-transcribe", localOnly("voice:local-transcribe", (_event, audio, options) => {
    if (!(audio instanceof ArrayBuffer) && !ArrayBuffer.isView(audio)) return { error: "invalid-audio" };
    const bytes = audio instanceof ArrayBuffer ? new Uint8Array(audio) : new Uint8Array(audio.buffer, audio.byteOffset, audio.byteLength);
    if (bytes.byteLength % 2 !== 0 || bytes.byteLength > 16_000 * 2 * 30) return { error: "invalid-audio" };
    const samples = new Int16Array(bytes.slice().buffer);
    return localVoice.transcribe(samples, options).then((text) => ({ text }), localVoiceFailure);
  }));
}
