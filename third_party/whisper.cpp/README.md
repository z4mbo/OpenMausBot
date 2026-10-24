# whisper.cpp release provenance

On Windows, Local voice hears the wake phrase with the official `whisper-cli`
from whisper.cpp release `b5454` (v1.9.5) and the multilingual `base` model
quantised to 5 bits. Nothing is bundled in the installer: `electron/local-voice.mjs`
downloads both into the app's data directory (`voice/`) the first time Local
voice is used, and refuses any file whose size or SHA-256 differs from these:

| Target | Asset | Bytes | SHA-256 |
| --- | --- | --- | --- |
| Windows x64 | [`whisper-bin-x64.zip`](https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip) | 8,928,640 | `6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb` |
| Windows arm64 | [`whisper-bin-win-cpu-arm64.zip`](https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-win-cpu-arm64.zip) | 4,371,193 | `28c37e7b598c3d9bbfef94f3bd67f2ee6f12b7c86f3da5edcf5e4308d615ff6d` |
| Model | [`ggml-base-q5_1.bin`](https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin) | 59,707,625 | `422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898` |

From each archive only `whisper-cli.exe`, `whisper.dll`, the `ggml*.dll`
libraries and, on arm64, `libomp140.aarch64.dll` are kept. The build links the
Microsoft Visual C++ 2015–2022 runtime (`MSVCP140.dll`, `VCRUNTIME140.dll`,
`VCOMP140.dll`); where it is missing the app says so and links to Microsoft's
redistributable instead of shipping it.

Each utterance is written to a private temporary WAV file next to the model,
transcribed by `whisper-cli` and deleted. No audio leaves the computer.

macOS uses Apple's on-device speech recognition through the existing speech
helper, with server-based recognition refused, so nothing is downloaded there.

## Licences

- whisper.cpp: MIT, © The ggml authors ([`LICENSE`](LICENSE)).
- The `ggml-*` model files are OpenAI's Whisper weights converted by the
  whisper.cpp project, published under MIT (Hugging Face `license:mit`);
  Whisper itself is MIT, © OpenAI ([`LICENSE-openai-whisper-model`](LICENSE-openai-whisper-model)).
- `libomp140.aarch64.dll` (arm64 archive only) is Microsoft's OpenMP runtime as
  redistributed by the upstream release; Origin does not redistribute it.

All are compatible with Origin's Apache-2.0 licence.

## Updating

Change `WHISPER_VERSION`, `WHISPER_BINARIES` and `WHISPER_MODEL` in
`electron/local-voice.mjs` and this table together, using the digests GitHub
and Hugging Face publish for the assets, then run `pnpm smoke:local-voice` on a
Windows machine.
