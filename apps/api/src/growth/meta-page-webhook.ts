import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const id = z.string().regex(/^\d{1,40}(?:_\d{1,40})?$/u);
const envelope = z.object({
  object: z.literal('page'),
  entry: z
    .array(
      z.object({
        id: z.string().regex(/^\d{1,40}$/u),
        time: z.int().nonnegative().max(4_102_444_800),
        changes: z
          .array(z.object({ field: z.string(), value: z.unknown() }))
          .max(100),
      }),
    )
    .max(100),
});
const comment = z.object({
  item: z.literal('comment'),
  verb: z.enum([
    'add',
    'edit',
    'edited',
    'update',
    'remove',
    'delete',
    'hide',
    'unhide',
  ]),
  comment_id: id,
  post_id: id,
  parent_id: id.optional(),
  message: z.string().max(16_000).nullish(),
  from: z.object({ id }).nullish(),
});

export function verifyMetaWebhook(
  secret: string,
  body: Buffer,
  signature: unknown,
) {
  if (
    typeof signature !== 'string' ||
    !/^sha256=[a-f0-9]{64}$/u.test(signature)
  )
    return false;
  const expected = createHmac('sha256', secret).update(body).digest();
  return timingSafeEqual(
    expected,
    Buffer.from(signature.slice('sha256='.length), 'hex'),
  );
}

export function readPageCommentChanges(payload: unknown) {
  const event = envelope.safeParse(payload);
  if (!event.success) return null;
  return event.data.entry.flatMap((page) =>
    page.changes.flatMap((change) => {
      if (change.field !== 'feed') return [];
      const parsed = comment.safeParse(change.value);
      if (!parsed.success) return [];
      const value = parsed.data;
      return [
        {
          pageId: page.id,
          id: value.comment_id,
          postId: value.post_id,
          parentId: value.parent_id ?? value.post_id,
          body: value.message ?? null,
          fromOwnPage: value.from?.id === page.id,
          verb: value.verb,
          changedAt: new Date(page.time * 1000),
        },
      ];
    }),
  );
}
