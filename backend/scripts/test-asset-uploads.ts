import assert from "node:assert/strict";
import { assetFileType, saveAssetFiles } from "../lib/asset-uploads";

async function main() {
  const files = [new File(["one"], "one.txt"), new File(["two"], "two.txt"), new File(["three"], "three.txt")];
  let pending = [...files], fail = true;
  const uploaded = new Map<File, string>(), uploads: string[] = [], saved: string[] = [], progress: string[] = [];
  const options = {
    files: pending, uploaded,
    upload: async (file: File) => { uploads.push(file.name); return `storage:${file.name}`; },
    save: async (file: File, id: string) => {
      assert.equal(id, `storage:${file.name}`);
      if (file.name === "two.txt" && fail) throw new Error("Temporary save failure");
      saved.push(file.name);
    },
    onSaved: (file: File) => { pending = pending.filter(item => item !== file); },
    onProgress: (current: number, total: number) => { progress.push(`${current}/${total}`); },
  };
  await assert.rejects(saveAssetFiles(options), /Temporary/);
  assert.deepEqual(pending.map(file => file.name), ["two.txt", "three.txt"]);
  fail = false;
  await saveAssetFiles({ ...options, files: pending });
  assert.deepEqual(uploads, ["one.txt", "two.txt", "three.txt"], "Retry reuses an uploaded file");
  assert.deepEqual(saved, ["one.txt", "two.txt", "three.txt"], "Retry never resaves completed files");
  assert.deepEqual(progress, ["1/3", "2/3", "1/2", "2/2"]);
  assert.equal(pending.length, 0); assert.equal(uploaded.size, 0);
  await assert.rejects(saveAssetFiles({ ...options, files: [files[0], new File([], "empty")] }), /1 byte/);
  assert.equal(uploads.length, 3, "Validate the entire selection before uploading");
  assert.equal(assetFileType({ name: "photo.png", type: "image/png" }), "image");
  assert.equal(assetFileType({ name: "font.WOFF2", type: "" }), "font");
  assert.equal(assetFileType({ name: "app.apk", type: "application/octet-stream" }), "apk");
  assert.equal(assetFileType({ name: "report.pdf", type: "application/pdf" }), "document");
  console.log("PASS asset batches, retry without duplicate uploads, progress, validation and automatic file types");
}
void main();
