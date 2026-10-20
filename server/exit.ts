// On Linux a pipe takes writes asynchronously, so `process.exit` right after `console.error` can drop that line; a write
// callback fires only once its data is out. On Windows (Node 24) `process.exit` while fetch's handles are still closing
// aborts in libuv (`!(handle->flags & UV_HANDLE_CLOSING)`, https://github.com/nodejs/node/issues/56645), so the process
// exits on its own once idle and is forced only if something keeps it alive.
export function exitAfterFlush(code: number): void {
  process.exitCode = code;
  const flushed = (stream: NodeJS.WriteStream) => new Promise<void>((done) => stream.write("", () => done()));
  void Promise.all([flushed(process.stdout), flushed(process.stderr)]).then(() => {
    setTimeout(() => process.exit(code), 1_000).unref();
  });
}
