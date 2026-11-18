import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { shopifyConnectionInput } from './shopify-orders';
import type { shopifyOrders } from './shopify-orders';
import { smsConnectionInput } from './sms';
import type { workspaceSms } from './sms';
import { teamRole } from './team';
import type { teamStore } from './team';
import type { vaultStore } from './vault';
import { domainName } from './domains';
import type { domainStore } from './domains';

type Authorize = (
  request: FastifyRequest,
  reply: FastifyReply,
  write?: boolean,
) => Promise<{ id: string; accountId: string; role: string } | null>;

export function registerWorkspaceSettings(
  app: FastifyInstance,
  context: {
    team: ReturnType<typeof teamStore>;
    commerce: ReturnType<typeof shopifyOrders> | undefined;
    sms: ReturnType<typeof workspaceSms> | undefined;
    vault: ReturnType<typeof vaultStore> | undefined;
    domains: ReturnType<typeof domainStore>;
    authorize: Authorize;
    reportError: (failure: unknown, reply: FastifyReply) => unknown;
  },
) {
  const { team, vault, domains, commerce, sms } = context;
  const base = '/api/companies/:id/settings';
  const target = z.object({ resource: z.uuid() });
  type Access = NonNullable<Awaited<ReturnType<Authorize>>>;
  function handle(
    write: boolean,
    action: (
      request: FastifyRequest,
      reply: FastifyReply,
      access: Access,
    ) => unknown,
  ) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const access = await context.authorize(request, reply, write);
        if (!access) return;
        if (access.role !== 'owner' && access.role !== 'admin')
          return reply
            .code(403)
            .send({ message: 'An owner or admin manages workspace settings.' });
        return await action(request, reply, access);
      } catch (error) {
        return context.reportError(error, reply);
      }
    };
  }
  app.get(
    base + '/sms',
    handle(false, async (_request, _reply, access) => ({
      enabled: Boolean(sms),
      connection: (await sms?.connection(access.id)) ?? null,
    })),
  );
  app.post(
    base + '/sms',
    handle(true, async (request, reply, access) => {
      if (!sms) return reply.code(503).send({ message: 'SMS is unavailable.' });
      const input = smsConnectionInput.parse(request.body);
      const connected = await sms.connect(access.id, input).catch(() => false);
      if (!connected)
        return reply.code(422).send({
          message:
            'Check the Twilio credentials, number capabilities, and existing workspace connection.',
        });
      return { connected: true };
    }),
  );
  app.delete(
    base + '/sms',
    handle(true, async (_request, reply, access) => {
      if (!sms) return reply.code(503).send({ message: 'SMS is unavailable.' });
      await sms.disconnect(access.id);
      return { disconnected: true };
    }),
  );
  app.get(
    base + '/shopify',
    handle(false, async (_request, _reply, access) => ({
      enabled: Boolean(commerce),
      ...(commerce
        ? await commerce.report(access.id)
        : { shops: [], totals: [] }),
    })),
  );
  app.post(
    base + '/shopify',
    handle(true, async (request, reply, access) => {
      if (!commerce)
        return reply.code(503).send({ message: 'Shopify is unavailable.' });
      const input = shopifyConnectionInput.parse(request.body);
      const result = await commerce.connect(access.id, input).catch(() => null);
      if (!result)
        return reply.code(422).send({
          message:
            'Brightwork could not verify this Shopify connection. Check the store, credentials, and workspace.',
        });
      return { connected: true };
    }),
  );
  app.delete(
    base + '/shopify/:resource',
    handle(true, async (request, reply, access) => {
      const { resource } = target.parse(request.params);
      if (!(await commerce?.disconnect(access.id, resource)))
        return reply
          .code(404)
          .send({ message: 'Shopify connection unavailable.' });
      return { disconnected: true };
    }),
  );
  app.get(
    base + '/team',
    handle(false, async (_request, _reply, access) => {
      const [members, invites] = await Promise.all([
        team.members(access.id),
        team.pending(access.id),
      ]);
      return { members, invites };
    }),
  );
  app.post(
    base + '/team/invitations',
    handle(true, async (request, reply, access) => {
      const { email, role } = z
        .object({ email: z.email().toLowerCase().max(254), role: teamRole })
        .parse(request.body);
      const invite = await team.invite(
        access.id,
        access.accountId,
        email,
        role,
      );
      if (!invite)
        return reply.code(409).send({
          message: 'Check the role and existing membership before inviting.',
        });
      return reply.code(201).send({ invite });
    }),
  );
  app.delete(
    base + '/team/invitations/:resource',
    handle(true, async (request, reply, access) => {
      const { resource } = target.parse(request.params);
      if (!(await team.revoke(access.id, access.accountId, resource)))
        return reply
          .code(404)
          .send({ message: 'Invitation not found or unavailable.' });
      return { revoked: true };
    }),
  );
  app.patch(
    base + '/team/members/:resource',
    handle(true, async (request, reply, access) => {
      const { resource } = target.parse(request.params);
      const { role } = z
        .object({ role: teamRole.nullable() })
        .parse(request.body);
      if (!(await team.setRole(access.id, access.accountId, resource, role)))
        return reply
          .code(403)
          .send({ message: 'You cannot change this member’s role.' });
      return { updated: true };
    }),
  );
  app.get(
    base + '/vault',
    handle(false, async (_request, _reply, access) => ({
      enabled: Boolean(vault),
      credentials: vault ? await vault.list(access.id) : [],
    })),
  );
  app.post(
    base + '/vault',
    handle(true, async (request, reply, access) => {
      if (!vault)
        return reply
          .code(503)
          .send({ message: 'The workspace vault is unavailable.' });
      const { name, value } = z
        .object({
          name: z.string().trim().min(1).max(100),
          value: z.string().min(1).max(8192),
        })
        .parse(request.body);
      await vault.save(access.id, name, value);
      return { saved: true };
    }),
  );
  app.post(
    base + '/vault/:resource/reveal',
    handle(true, async (request, reply, access) => {
      if (!vault)
        return reply
          .code(503)
          .send({ message: 'The workspace vault is unavailable.' });
      const { resource } = target.parse(request.params);
      const value = await vault.reveal(access.id, resource);
      if (value === null)
        return reply.code(404).send({ message: 'Credential not found.' });
      return { value };
    }),
  );
  app.delete(
    base + '/vault/:resource',
    handle(true, async (request, reply, access) => {
      if (!vault)
        return reply
          .code(503)
          .send({ message: 'The workspace vault is unavailable.' });
      const { resource } = target.parse(request.params);
      if (!(await vault.remove(access.id, resource)))
        return reply.code(404).send({ message: 'Credential not found.' });
      return { removed: true };
    }),
  );
  app.get(
    base + '/domains',
    handle(false, async (_request, _reply, access) => ({
      domains: await domains.list(access.id),
    })),
  );
  app.post(
    base + '/domains',
    handle(true, async (request, reply, access) => {
      const { hostname } = z
        .object({ hostname: domainName })
        .parse(request.body);
      await domains.add(access.id, hostname);
      return reply.code(201).send({ added: true });
    }),
  );
  app.post(
    base + '/domains/:resource/verify',
    handle(true, async (request, reply, access) => {
      const { resource } = target.parse(request.params);
      const status = await domains.verify(access.id, resource);
      if (status === 'missing')
        return reply.code(404).send({ message: 'Domain not found.' });
      if (status === 'unverified')
        return reply
          .code(422)
          .send({ message: 'The required DNS TXT record is not visible yet.' });
      return { verified: true };
    }),
  );
  app.delete(
    base + '/domains/:resource',
    handle(true, async (request, reply, access) => {
      const { resource } = target.parse(request.params);
      if (!(await domains.remove(access.id, resource)))
        return reply.code(404).send({ message: 'Domain not found.' });
      return { removed: true };
    }),
  );
}
