import { validateAttachmentFiles } from "./dropped-content";

export function assetFileType(file: { name: string; type: string }) {
  if (file.type.startsWith("image/")) return "image" as const;
  if (/\.(woff2?|ttf|otf)$/i.test(file.name)) return "font" as const;
  if (/\.apk$/i.test(file.name)) return "apk" as const;
  return "document" as const;
}

export async function saveAssetFiles<T>(options: {
  files: File[];
  uploaded: Map<File, T>;
  upload: (file: File) => Promise<T>;
  save: (file: File, storageId: T) => Promise<void>;
  onSaved: (file: File) => void;
  onProgress: (current: number, total: number) => void;
}) {
  validateAttachmentFiles(options.files);
  for (const [index, file] of options.files.entries()) {
    options.onProgress(index + 1, options.files.length);
    // Retain a successful upload if saving its metadata needs a retry.
    let storageId = options.uploaded.get(file);
    if (storageId === undefined) {
      storageId = await options.upload(file);
      options.uploaded.set(file, storageId);
    }
    await options.save(file, storageId);
    options.uploaded.delete(file);
    options.onSaved(file);
  }
}
