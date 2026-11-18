import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mediaEnv,
  mediaProviders,
  mediaRates,
} from '../src/workspace/media-providers';

const config = mediaEnv.parse({
  MEDIA_OPENAI_KEY: 'fixture-openai',
  MEDIA_IMAGE_MODEL: 'gpt-image-1',
  MEDIA_VOICE_MODEL: 'gpt-4o-mini-tts',
  MEDIA_FAL_KEY: 'fixture-fal',
  MEDIA_VOICE_CREDITS: '2',
});
const receipt = '115401a6-ad54-451c-9def-45ab400adf61';
const image = Buffer.from('89504e470d0a1a0a', 'hex');
const voice = Buffer.from('ID3');
const video = Buffer.from('0000ftyp');

test('media capabilities quote separately and send only configured provider inputs', async () => {
  assert.deepEqual(mediaRates(mediaEnv.parse({})), {});
  assert.deepEqual(mediaRates(config), { image: '1', voice: '2', video: '4' });
  const provider = mediaProviders(config, async (target, init) => {
    assert.equal(init?.method, 'POST');
    assert.equal(init.redirect, 'error');
    const url = String(target);
    const body = JSON.parse(String(init.body));
    if (url.endsWith('/images/generations')) {
      assert.deepEqual(body, {
        model: 'gpt-image-1',
        prompt: 'Autumn',
        n: 1,
        size: '1024x1024',
        output_format: 'png',
      });
      return Response.json({ data: [{ b64_json: image.toString('base64') }] });
    }
    if (url.endsWith('/audio/speech')) {
      assert.deepEqual(body, {
        model: 'gpt-4o-mini-tts',
        input: 'Autumn',
        voice: 'alloy',
        response_format: 'mp3',
      });
      return new Response(voice);
    }
    assert.equal(
      url,
      'https://queue.fal.run/fal-ai/kling-video/v2.6/pro/text-to-video',
    );
    assert.deepEqual(body, { prompt: 'Autumn', duration: '5', sound: false });
    return Response.json({ request_id: receipt });
  });
  assert.deepEqual(
    await provider.run({ kind: 'image', prompt: 'Autumn', remoteId: null }),
    { state: 'completed', bytes: image },
  );
  assert.deepEqual(
    await provider.run({ kind: 'voice', prompt: 'Autumn', remoteId: null }),
    { state: 'completed', bytes: voice },
  );
  assert.deepEqual(
    await provider.run({ kind: 'video', prompt: 'Autumn', remoteId: null }),
    { state: 'processing', remoteId: receipt },
  );
});

test('video polling follows only the saved receipt and fetches trusted assets without credentials', async () => {
  let assetUrl = 'https://v3.fal.media/files/fixture/video.mp4';
  let statusCode = 200;
  let status = 'IN_QUEUE';
  let downloads = 0;
  const provider = mediaProviders(config, async (target, init) => {
    assert.equal(init?.method, undefined);
    const url = String(target);
    if (url.startsWith('https://queue.fal.run/')) {
      assert.ok(url.includes('/fal-ai/kling-video/requests/' + receipt));
      assert.equal(
        new Headers(init?.headers).get('authorization'),
        'Key fixture-fal',
      );
      return url.endsWith('/status')
        ? Response.json({ status })
        : Response.json({ video: { url: assetUrl } }, { status: statusCode });
    }
    downloads++;
    assert.equal(url, assetUrl);
    assert.equal(init?.headers, undefined);
    assert.equal(init?.redirect, 'error');
    return new Response(video);
  });
  const job = { kind: 'video', prompt: '', remoteId: receipt } as const;
  assert.deepEqual(await provider.run(job), {
    state: 'processing',
    remoteId: receipt,
  });
  status = 'COMPLETED';
  assert.deepEqual(await provider.run(job), {
    state: 'completed',
    bytes: video,
  });
  assetUrl = 'https://fal.media.example.test/files/fixture/video.mp4';
  assert.deepEqual(await provider.run(job), {
    state: 'needs_review',
    remoteId: receipt,
  });
  statusCode = 503;
  assert.deepEqual(await provider.run(job), {
    state: 'processing',
    remoteId: receipt,
  });
  statusCode = 422;
  assert.deepEqual(await provider.run(job), { state: 'failed' });
  assert.deepEqual(await provider.run({ ...job, remoteId: 'invalid' }), {
    state: 'needs_review',
  });
  assert.equal(downloads, 1);
});

test('only a definitive generation rejection releases the reserved credits', async () => {
  const job = { kind: 'voice', prompt: 'Hello', remoteId: null } as const;
  const rejected = mediaProviders(
    config,
    async () => new Response(null, { status: 422 }),
  );
  assert.deepEqual(await rejected.run(job), { state: 'failed' });
  const unavailable = mediaProviders(
    config,
    async () => new Response(null, { status: 503 }),
  );
  assert.deepEqual(await unavailable.run(job), { state: 'needs_review' });
  const timedOut = mediaProviders(config, async () => {
    throw new Error('Fixture connection lost');
  });
  assert.deepEqual(await timedOut.run(job), { state: 'needs_review' });
});
