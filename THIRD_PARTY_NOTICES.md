# Third-Party Notices

Origin's MIT license applies to original project code. Dependencies and bundled vendor assets remain subject to their own licenses.

- Excalidraw and its application assets: MIT, https://github.com/excalidraw/excalidraw
- Yjs: MIT, https://github.com/yjs/yjs
- Lucide icons: ISC, https://github.com/lucide-icons/lucide
- Next.js and React: MIT, their respective upstream repositories.
- Convex JavaScript client: Apache-2.0, https://github.com/get-convex/convex-js
- Archivo, Inter, and Martian Mono typefaces: SIL Open Font License 1.1, served through `next/font/google`.

Excalidraw fonts are copied from the installed npm package by `postinstall`, rather than vendored in this source repository. Their upstream licensing still applies when distributing built applications. Consult upstream packages for complete notices, including fonts and transitive dependencies. README screenshots and recordings use synthetic demonstration data.

## Tauri desktop and bundled runtimes

- [Tauri](https://github.com/tauri-apps/tauri) and its official plugins are dual-licensed
  MIT OR Apache-2.0. The desktop uses autostart, deep-link, single-instance, window-state,
  updater, notification and opener plugins. Exact Rust/JS dependencies are recorded in
  [Cargo.lock](apps/desktop/src-tauri/Cargo.lock) and [package-lock.json](apps/desktop/package-lock.json);
  dependencies retain their individual license terms.
- [Node.js](https://github.com/nodejs/node) is bundled with production desktop packages. Node and its included components retain the terms in its upstream LICENSE.
  Desktop staging includes the matching Node license and runtime provenance with the host resources.

