/**
 * preprocess.ts — Light image cleanup before OCR (resize + grayscale).
 * Fail-soft: returns the original buffer if jimp can't process it.
 */

import { Jimp } from "jimp";

export async function preprocessImage(buffer: Buffer): Promise<Buffer> {
  try {
    const image = await Jimp.read(buffer);
    // Keep detail for dense forms; only downscale very large phone photos.
    if (image.bitmap.width > 2400) {
      image.resize({ w: 2400 });
    }
    image.greyscale();
    return await image.getBuffer("image/jpeg");
  } catch {
    return buffer;
  }
}
