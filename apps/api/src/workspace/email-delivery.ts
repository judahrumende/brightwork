import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Database } from '../db/database';
import { emailDeliveryEvents } from '../db/schema';
import { verifyInboundSignature } from './inbound-signature';

const statusTypes = z.enum([
  'email.sent',
  'email.delivered',
  'email.delivery_delayed',
  'email.bounced',
  'email.failed',
  'email.suppressed',
  'email.complained',
]);
const envelope = z.object({
  created_at: z.iso.datetime({ offset: true }),
  data: z.object({ email_id: z.uuid() }),
});

export function registerEmailDelivery(
  app: FastifyInstance,
  db: Database,
  secret: string,
) {
  app.register(async (scope) => {
    scope.removeContentTypeParser('application/json');
    scope.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer', bodyLimit: 128_000 },
      (_request, raw, done) => done(null, raw),
    );
    scope.post('/api/webhooks/email-delivery', async (request, reply) => {
      const id = request.headers['svix-id'];
      if (
        typeof id !== 'string' ||
        !Buffer.isBuffer(request.body) ||
        !verifyInboundSignature(secret, request.body, request.headers)
      ) {
        return reply
          .code(401)
          .send({ message: 'Invalid email delivery signature.' });
      }
      let payload: unknown;
      try {
        payload = JSON.parse(request.body.toString());
      } catch {
        return reply
          .code(400)
          .send({ message: 'Invalid email delivery event.' });
      }
      const category = z.object({ type: statusTypes }).safeParse(payload);
      if (!category.success) return { received: true };
      const event = envelope.safeParse(payload);
      if (!event.success)
        return reply
          .code(400)
          .send({ message: 'Invalid email delivery event.' });
      await db
        .insert(emailDeliveryEvents)
        .values({
          id,
          providerId: event.data.data.email_id,
          status: category.data.type.slice('email.'.length),
          occurredAt: new Date(event.data.created_at),
        })
        .onConflictDoNothing();
      return { received: true };
    });
  });
}
