// ---------------------------------------------------------------------------
// Converts a fetched Blob into a data: URL instead of a blob: object URL.
//
// A blob: URL only exists in this tab's memory — it can't be written to
// IndexedDB, survive a reload, or be restored into a loaded/saved project. A
// data: URL is a plain string with the bytes inlined, so it's just JSON: it
// persists, round-trips through project save/load, and needs no cleanup
// (URL.revokeObjectURL). Provider responses are single images/audio clips,
// small enough that base64's ~33% overhead is a fair trade for that.
// ---------------------------------------------------------------------------
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read blob."));
    reader.readAsDataURL(blob);
  });
}
