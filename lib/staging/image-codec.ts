import "server-only";

import sharp from "sharp";

import type { RgbaImage } from "@/lib/staging/projection";

export async function decodeImageToRgba(input: Buffer): Promise<RgbaImage> {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return {
    data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
    width: info.width,
    height: info.height,
  };
}

export async function encodeRgbaToJpeg(
  image: RgbaImage,
  quality = 92,
): Promise<Buffer> {
  return sharp(Buffer.from(image.data), {
    raw: {
      width: image.width,
      height: image.height,
      channels: 4,
    },
  })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
}
