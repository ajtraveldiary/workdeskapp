// Saves a file the app made (Import / Export, user request 2026-10-07) without leaving the app: phones get the
// share sheet (Save to Files, WhatsApp, Mail…), computers a download. iPhone only opens the share sheet straight
// from a tap, so after a slow download it may refuse: "tap" then means the page should offer a Save button.
export async function saveFile(blob: Blob, filename: string): Promise<"done" | "tap"> {
  const touch = window.matchMedia("(pointer: coarse)").matches;
  if (touch && typeof navigator.canShare === "function") {
    const file = new File([blob], filename, { type: blob.type || "application/octet-stream" });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return "done";
      } catch (e) {
        const name = (e as Error).name;
        if (name === "AbortError") return "done"; // the person closed the share sheet
        if (name === "NotAllowedError") return "tap";
      }
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return "done";
}
