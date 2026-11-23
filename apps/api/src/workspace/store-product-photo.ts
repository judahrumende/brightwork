import { z } from 'zod';
import type { FastifyReply } from 'fastify';

export const productPhoto = z
  .object({
    alt: z.string().trim().min(1).max(160),
    data: z.string().max(700_000),
  })
  .transform(({ data, alt }, ctx) => {
    const match =
      /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/u.exec(
        data,
      );
    const mime = match?.[1];
    const encoded = match?.[2];
    const content = Buffer.from(encoded ?? '', 'base64');
    const recognizable =
      (mime === 'image/png' &&
        content
          .subarray(0, 8)
          .equals(Buffer.from('89504e470d0a1a0a', 'hex'))) ||
      (mime === 'image/jpeg' &&
        content.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) ||
      (mime === 'image/webp' &&
        content.toString('ascii', 0, 4) === 'RIFF' &&
        content.toString('ascii', 8, 12) === 'WEBP');
    if (
      !mime ||
      !recognizable ||
      content.length > 512 * 1024 ||
      content.toString('base64') !== encoded
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Choose a PNG, JPEG or WebP photo up to 512 KB.',
      });
      return z.NEVER;
    }
    return { mime, content, alt };
  });

export function sendStorePhoto(
  reply: FastifyReply,
  photo: { mime: string; content: Buffer } | undefined,
) {
  if (!photo) return reply.code(404).send();
  return reply
    .type(photo.mime)
    .header('Cache-Control', 'no-store')
    .header('X-Content-Type-Options', 'nosniff')
    .header('Content-Security-Policy', "default-src 'none'; sandbox")
    .send(photo.content);
}
