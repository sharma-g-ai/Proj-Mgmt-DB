/**
 * Pull readable text from uploaded invoice files (PDF, CSV, plain text).
 * Used before LLM structured extraction.
 */

import { extractText, getDocumentProxy } from "unpdf";

export async function extractTextFromInvoiceFile(params: {
  bytes: ArrayBuffer | Buffer | Uint8Array;
  filename: string;
  mimeType?: string | null;
}): Promise<{ text: string; method: "pdf" | "text" | "empty" }> {
  const name = params.filename.toLowerCase();
  const mime = (params.mimeType || "").toLowerCase();
  const bytes =
    params.bytes instanceof Uint8Array
      ? params.bytes
      : params.bytes instanceof ArrayBuffer
        ? new Uint8Array(params.bytes)
        : new Uint8Array(params.bytes);

  const isPdf = mime.includes("pdf") || name.endsWith(".pdf");
  const isTextish =
    mime.startsWith("text/") ||
    name.endsWith(".csv") ||
    name.endsWith(".txt") ||
    name.endsWith(".json");

  if (isPdf) {
    try {
      const pdf = await getDocumentProxy(bytes);
      const { text } = await extractText(pdf, { mergePages: true });
      const cleaned = (text || "").replace(/\u0000/g, "").trim();
      if (cleaned.length >= 40) return { text: cleaned, method: "pdf" };
      return { text: cleaned, method: cleaned ? "pdf" : "empty" };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "PDF extract failed";
      throw new Error(`Could not read PDF text: ${msg}`);
    }
  }

  if (isTextish) {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes).trim();
    return { text, method: text ? "text" : "empty" };
  }

  // Images / xlsx — no local text; caller may try multimodal LLM
  return { text: "", method: "empty" };
}

export function isLikelyInvoiceImage(filename: string, mimeType?: string | null): boolean {
  const name = filename.toLowerCase();
  const mime = (mimeType || "").toLowerCase();
  return (
    mime.startsWith("image/") ||
    name.endsWith(".png") ||
    name.endsWith(".jpg") ||
    name.endsWith(".jpeg") ||
    name.endsWith(".webp")
  );
}
