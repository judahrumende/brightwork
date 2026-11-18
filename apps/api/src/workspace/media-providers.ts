import { z } from 'zod';
import { maxMediaBytes, type MediaKind, type MediaResult } from './media-store';

const price = z.string().regex(/^\d{1,14}(?:\.\d{1,10})?$/u);
const optional = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).optional(),
);
export const mediaEnv = z.object({
  MEDIA_OPENAI_KEY: optional,
  MEDIA_IMAGE_MODEL: optional,
  MEDIA_VOICE_MODEL: optional,
  MEDIA_FAL_KEY: optional,
  MEDIA_IMAGE_CREDITS: price.default('1'),
  MEDIA_VIDEO_CREDITS: price.default('4'),
  MEDIA_VOICE_CREDITS: price.default('1'),
});
type MediaConfig = z.infer<typeof mediaEnv>;

const queueRoot = 'https://queue.fal.run/fal-ai/kling-video';
const videoModel = queueRoot + '/v2.6/pro/text-to-video';
const remoteId = z.uuid();
const definitive = (status: number) =>
  [400, 401, 403, 404, 422].includes(status);

class MediaTooLarge extends Error {}

async function bytes(response: Response, limit: number) {
  if (!response.body) throw new Error('Empty media response.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return Buffer.concat(chunks, length);
      length += chunk.value.length;
      if (length > limit) {
        await reader.cancel();
        throw new MediaTooLarge('Media exceeds its byte limit.');
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
}

function completed(data: Buffer, kind: MediaKind): MediaResult {
  const valid =
    kind === 'image'
      ? data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
      : kind === 'video'
        ? data.subarray(4, 8).toString('ascii') === 'ftyp'
        : data.subarray(0, 3).toString('ascii') === 'ID3' ||
          (data[0] === 255 && ((data[1] ?? 0) & 224) === 224);
  return valid
    ? { state: 'completed', bytes: data }
    : { state: 'needs_review' };
}

export function mediaRates(
  config: MediaConfig,
): Partial<Record<MediaKind, string>> {
  return {
    ...(config.MEDIA_OPENAI_KEY && config.MEDIA_IMAGE_MODEL
      ? { image: config.MEDIA_IMAGE_CREDITS }
      : {}),
    ...(config.MEDIA_OPENAI_KEY && config.MEDIA_VOICE_MODEL
      ? { voice: config.MEDIA_VOICE_CREDITS }
      : {}),
    ...(config.MEDIA_FAL_KEY ? { video: config.MEDIA_VIDEO_CREDITS } : {}),
  };
}

export function mediaProviders(
  config: MediaConfig,
  transport: typeof fetch = fetch,
) {
  const rates = mediaRates(config);
  const kinds = Object.keys(rates) as MediaKind[];
  const post = (url: string, auth: string, body: object, timeout: number) =>
    transport(url, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
      redirect: 'error',
    });
  return {
    kinds,
    async run(job: {
      kind: MediaKind;
      prompt: string;
      remoteId: string | null;
    }): Promise<MediaResult> {
      const { kind, prompt } = job;
      if (!rates[kind]) return { state: 'needs_review' };
      const authorization = 'Key ' + config.MEDIA_FAL_KEY;
      if (kind === 'video' && job.remoteId) {
        const receipt = remoteId.safeParse(job.remoteId);
        if (!receipt.success) return { state: 'needs_review' };
        const id = receipt.data;
        try {
          const endpoint = queueRoot + '/requests/' + id;
          const init = {
            headers: { Authorization: authorization },
            signal: AbortSignal.timeout(12_000),
            redirect: 'error' as const,
          };
          const status = await transport(endpoint + '/status', init);
          if (!status.ok) {
            await status.body?.cancel();
            return { state: 'processing', remoteId: id };
          }
          if (
            z.object({ status: z.string() }).parse(await status.json())
              .status !== 'COMPLETED'
          )
            return { state: 'processing', remoteId: id };
          const result = await transport(endpoint, {
            ...init,
            signal: AbortSignal.timeout(12_000),
          });
          if (!result.ok) {
            await result.body?.cancel();
            return result.status === 422
              ? { state: 'failed' }
              : { state: 'processing', remoteId: id };
          }
          const output = z
            .object({ video: z.object({ url: z.url() }) })
            .parse(await result.json());
          const url = new URL(output.video.url);
          if (
            url.protocol !== 'https:' ||
            url.port ||
            url.username ||
            url.password ||
            !url.hostname.endsWith('.fal.media') ||
            !url.pathname.startsWith('/files/')
          )
            return { state: 'needs_review', remoteId: id };
          const asset = await transport(url, {
            redirect: 'error',
            signal: AbortSignal.timeout(40_000),
          });
          if (!asset.ok) {
            await asset.body?.cancel();
            return { state: 'processing', remoteId: id };
          }
          return completed(await bytes(asset, maxMediaBytes), kind);
        } catch (error) {
          return {
            state:
              error instanceof MediaTooLarge ? 'needs_review' : 'processing',
            remoteId: id,
          };
        }
      }
      try {
        const response =
          kind === 'video'
            ? await post(
                videoModel,
                authorization,
                { prompt, duration: '5', sound: false },
                30_000,
              )
            : kind === 'voice'
              ? await post(
                  'https://api.openai.com/v1/audio/speech',
                  'Bearer ' + config.MEDIA_OPENAI_KEY,
                  {
                    model: config.MEDIA_VOICE_MODEL,
                    input: prompt,
                    voice: 'alloy',
                    response_format: 'mp3',
                  },
                  90_000,
                )
              : await post(
                  'https://api.openai.com/v1/images/generations',
                  'Bearer ' + config.MEDIA_OPENAI_KEY,
                  {
                    model: config.MEDIA_IMAGE_MODEL,
                    prompt,
                    n: 1,
                    size: '1024x1024',
                    output_format: 'png',
                  },
                  240_000,
                );
        if (!response.ok) {
          await response.body?.cancel();
          return definitive(response.status)
            ? { state: 'failed' }
            : { state: 'needs_review' };
        }
        if (kind === 'video')
          return {
            state: 'processing',
            remoteId: z
              .object({ request_id: remoteId })
              .parse(await response.json()).request_id,
          };
        if (kind === 'voice')
          return completed(await bytes(response, maxMediaBytes), kind);
        const raw = await bytes(
          response,
          Math.ceil((maxMediaBytes * 4) / 3) + 4096,
        );
        const image = z
          .object({ data: z.tuple([z.object({ b64_json: z.base64() })]) })
          .parse(JSON.parse(raw.toString('utf8')));
        return completed(Buffer.from(image.data[0].b64_json, 'base64'), kind);
      } catch {
        return { state: 'needs_review' };
      }
    },
  };
}
