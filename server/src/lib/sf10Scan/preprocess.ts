/**
 * preprocess.ts — Light image cleanup before OCR (resize + grayscale).
 * Fail-soft: returns the original buffer if jimp can't process it.
 */

import { Jimp } from "jimp";

export async function preprocessImage(buffer: Buffer): Promise<Buffer> {
  try {
    const image = await Jimp.read(buffer);
    if (image.bitmap.width > 1800) {
      image.resize({ w: 1800 });
    }
    image.greyscale();
    return await image.getBuffer("image/jpeg");
  } catch {
    return buffer;
  }
}
