import type { AxiosResponse } from "axios";

/**
 * Save a blob response as a file, preferring the server's Content-Disposition
 * filename when present (falls back to `fallbackName`).
 */
export function downloadBlobResponse(res: AxiosResponse<unknown>, fallbackName: string): void {
  const blob = res.data instanceof Blob ? res.data : new Blob([res.data as BlobPart]);
  const disposition = String((res.headers as Record<string, unknown> | undefined)?.["content-disposition"] ?? "");
  const match = /filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i.exec(disposition);
  const name = match?.[1] ? decodeURIComponent(match[1]) : fallbackName;

  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", name);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}
