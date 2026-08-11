import { createClient } from "@/lib/supabase/server";

export const INFRA_INVOICE_BUCKET = "infra-invoices";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Build storage object path: {projectId}/{invoiceId}/{safeFilename} */
export function invoiceObjectPath(projectId: string, invoiceId: string, filename: string): string {
  if (!UUID_RE.test(projectId) || !UUID_RE.test(invoiceId)) {
    throw new Error("Invalid storage path identifiers.");
  }
  const base = filename.split(/[/\\]/).pop() || "invoice";
  const safe = base.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 180) || "invoice";
  return `${projectId}/${invoiceId}/${safe}`;
}

/** True when path is {uuid}/{uuid}/{safe-filename} under the invoices bucket. */
export function isSafeInvoiceStoragePath(path: string): boolean {
  const parts = path.split("/");
  if (parts.length !== 3) return false;
  const [projectId, invoiceId, file] = parts;
  if (!UUID_RE.test(projectId) || !UUID_RE.test(invoiceId)) return false;
  if (!file || file.includes("..") || /[\\]/.test(file)) return false;
  return /^[a-zA-Z0-9._-]+$/.test(file);
}

export async function uploadInvoiceBytes(params: {
  projectId: string;
  invoiceId: string;
  filename: string;
  bytes: ArrayBuffer | Buffer | Blob | Uint8Array;
  contentType: string;
}): Promise<{ path: string; error?: string }> {
  const path = invoiceObjectPath(params.projectId, params.invoiceId, params.filename);
  const supabase = createClient();
  const body =
    params.bytes instanceof Uint8Array
      ? params.bytes
      : params.bytes;
  const { error } = await supabase.storage.from(INFRA_INVOICE_BUCKET).upload(path, body, {
    contentType: params.contentType || "application/octet-stream",
    upsert: false,
  });
  if (error) return { path, error: error.message };
  return { path };
}

export async function deleteInvoiceObject(path: string): Promise<{ error?: string }> {
  if (!isSafeInvoiceStoragePath(path)) return { error: "Invalid storage path." };
  const supabase = createClient();
  const { error } = await supabase.storage.from(INFRA_INVOICE_BUCKET).remove([path]);
  if (error) return { error: error.message };
  return {};
}

export async function downloadInvoiceBytes(
  path: string
): Promise<{ bytes: Uint8Array | null; error?: string }> {
  if (!isSafeInvoiceStoragePath(path)) return { bytes: null, error: "Invalid storage path." };
  const supabase = createClient();
  const { data, error } = await supabase.storage.from(INFRA_INVOICE_BUCKET).download(path);
  if (error || !data) return { bytes: null, error: error?.message ?? "Download failed." };
  const buf = await data.arrayBuffer();
  return { bytes: new Uint8Array(buf) };
}

export async function createInvoiceSignedUrl(
  path: string,
  expiresInSeconds = 3600
): Promise<{ url: string | null; error?: string }> {
  if (!isSafeInvoiceStoragePath(path)) return { url: null, error: "Invalid storage path." };
  const ttl = Math.min(Math.max(Number(expiresInSeconds) || 3600, 60), 3600);
  const supabase = createClient();
  const { data, error } = await supabase.storage
    .from(INFRA_INVOICE_BUCKET)
    .createSignedUrl(path, ttl);
  if (error) return { url: null, error: error.message };
  return { url: data.signedUrl };
}
