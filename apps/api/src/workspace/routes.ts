import { setTimeout as delay } from 'node:timers/promises';
import { Queue } from 'bullmq';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type Redis from 'ioredis';
import { websitePages } from '@brightwork/shared';
import type { siteHosting } from './publication';
import type { pageReader } from '../research/page';
import type { githubSiteSync } from './github-site-sync';
import {
  calendarEventTimes,
  recurrenceRules,
  upcomingOccurrences,
} from './recurrence';
import { z } from 'zod';
import { agentQueueName, agentStore, turnSnapshot } from './agent-store';
import { creditUnits } from './credit-amount';
import { canLeadRun } from './run-store';
import type { runStore } from './run-store';
import type { mailStore } from './mail-store';
import type { inboundMail } from './inbound-mail';

type Context = {
  store: ReturnType<typeof agentStore>;
  runs: ReturnType<typeof runStore>;
  mail: ReturnType<typeof mailStore>;
  inbound: ReturnType<typeof inboundMail>;
  outreachSender: string | undefined;
  redis: Redis;
  agentEnabled: boolean;
  hosting: ReturnType<typeof siteHosting>;
  siteSync:
    | {
        workspaceId: string;
        repo: string;
        branch: string;
        sync: ReturnType<typeof githubSiteSync>;
      }
    | undefined;
  readPage: ReturnType<typeof pageReader>;
  limit: (
    type: string,
    key: string,
    attempts: number,
    seconds: number,
  ) => Promise<void>;
  identify: (request: FastifyRequest) => Promise<string>;
  requireOrigin: (request: FastifyRequest) => string;
  reportError: (failure: unknown, reply: FastifyReply) => unknown;
};
const businessParams = z.object({ id: z.uuid() });
const resourceParams = businessParams.extend({ resource: z.uuid() });
const versionParams = resourceParams.extend({ versionId: z.uuid() });
const path = '/api/companies/:id';
const versionsPath = path + '/work/:resource/versions';
const deploymentsPath = path + '/work/:resource/deployments';
const htmlText = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
const timeZone = z
  .string()
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Choose a valid time zone');
const localMinute = z.iso
  .datetime({ local: true, precision: -1 })
  .refine((value) => value.length === 16, 'Choose a local date and time');
const eventDraft = z.strictObject({
  title: z.string().trim().min(1).max(160),
  start: localMinute,
  end: localMinute,
  timezone: timeZone,
  location: z.string().trim().max(500),
  attendees: z.string().trim().max(2000),
  notes: z.string().trim().max(4000),
});

export function registerWorkspace(app: FastifyInstance, context: Context) {
  const {
    store,
    redis,
    agentEnabled,
    identify,
    requireOrigin,
    reportError,
    hosting,
  } = context;
  const queue = new Queue<{ turnId: string }>(agentQueueName, {
    connection: redis,
  });
  app.addHook('onClose', async () => {
    await queue.close();
  });
  type WorkItem = Awaited<ReturnType<typeof store.listArtifacts>>[number];
  function describeWork(item: WorkItem, now: Date) {
    return {
      ...item,
      upcoming:
        item.kind === 'task' && item.dueAt
          ? upcomingOccurrences(
              item.dueAt,
              item.recurrence,
              item.scheduleTimezone,
              now,
            )
          : [],
      publicUrl: item.liveVersionId && hosting ? hosting.url(item.id) : null,
    };
  }

  async function authorize(
    request: FastifyRequest,
    reply: FastifyReply,
    write = false,
  ) {
    reply.header('Cache-Control', 'no-store');
    if (write) requireOrigin(request);
    const accountId = await identify(request);
    const { id } = businessParams.parse(request.params);
    const access = await store.membership(accountId, id);
    if (!access) {
      reply.code(404).send({ message: 'Business not found.' });
      return null;
    }
    if (write && access.role === 'viewer') {
      reply.code(403).send({ message: 'This workspace is view only.' });
      return null;
    }
    return { accountId, id, ...access };
  }

  app.get(path, async (request, reply) => {
    try {
      const access = await authorize(request, reply);
      if (!access) return;
      const { business, role, accountId } = access;
      const timestamp = business.createdAt.toISOString();
      return {
        userId: accountId,
        company: {
          id: business.id,
          name: business.name,
          idea: business.idea,
          role,
          tagline: null,
          timezone: null,
          currency: null,
          logoUpdatedAt: timestamp,
          mission: '',
          onboardingCompletedAt: timestamp,
          firstWork: '',
          existingSiteUrl: null,
          existingSiteCover: null,
          planUpdatedAt: timestamp,
        },
      };
    } catch (error) {
      return reportError(error, reply);
    }
  });
  app.get(path + '/pip/turns', async (request, reply) => {
    try {
      const access = await authorize(request, reply);
      if (!access) return;
      const { before } = z
        .object({ before: z.uuid().optional() })
        .parse(request.query);
      return {
        enabled: agentEnabled,
        ...(await store.turns(access.id, before)),
      };
    } catch (error) {
      return reportError(error, reply);
    }
  });
  app.get(
    path + '/pip/turns/:resource/attachments/:attachmentId',
    async (request, reply) => {
      try {
        const access = await authorize(request, reply);
        if (!access) return;
        const { resource, attachmentId } = resourceParams
          .extend({ attachmentId: z.uuid() })
          .parse(request.params);
        const [file] = await store.attachments(
          access.id,
          resource,
          attachmentId,
        );
        if (!file)
          return reply.code(404).send({ message: 'Attachment not found.' });
        return reply
          .type('text/plain; charset=UTF-8')
          .header(
            'Content-Disposition',
            "attachment; filename*=UTF-8''" + encodeURIComponent(file.name),
          )
          .header('X-Content-Type-Options', 'nosniff')
          .send(file.content);
      } catch (error) {
        return reportError(error, reply);
      }
    },
  );
  app.post(path + '/pip/turns', async (request, reply) => {
    try {
      const access = await authorize(request, reply, true);
      if (!access) return;
      if (!agentEnabled)
        return reply
          .code(503)
          .send({ message: 'Connect an LLM provider to message Pip.' });
      const { prompt, attachments } = z
        .object({
          prompt: z.string().trim().min(1).max(12000),
          attachments: z
            .array(
              z.object({
                name: z
                  .string()
                  .max(160)
                  .regex(/^[\p{L}\p{N}_. -]+\.(?:txt|md|csv|json|log)$/iu),
                content: z
                  .string()
                  .min(1)
                  .max(24576)
                  .refine(
                    (value) =>
                      !value.includes('\0') &&
                      Buffer.byteLength(value) <= 24576,
                  ),
              }),
            )
            .max(3)
            .default([]),
        })
        .parse(request.body);
      const pace = await redis.set(
        'brightwork:agent-pace:' + access.accountId,
        '1',
        'EX',
        2,
        'NX',
      );
      if (!pace)
        return reply
          .code(429)
          .send({ message: 'Wait a moment before sending again.' });
      const turn = await store.addTurn(
        access.id,
        access.accountId,
        prompt,
        attachments,
      );
      try {
        await queue.add(
          'turn',
          { turnId: turn.id },
          {
            jobId: turn.id,
            attempts: 1,
            removeOnComplete: 100,
            removeOnFail: 100,
          },
        );
      } catch (error) {
        await store.updateTurn(turn.id, {
          state: 'failed',
          answer: 'The worker is unavailable. Try sending again.',
        });
        throw error;
      }
      return reply.code(202).send(turnSnapshot(turn));
    } catch (error) {
      return reportError(error, reply);
    }
  });
  app.get(path + '/pip/runs', async (request, reply) => {
    try {
      const access = await authorize(request, reply);
      if (!access) return;
      return {
        enabled: agentEnabled,
        canPublish: Boolean(hosting),
        runs: await context.runs.list(access.id),
      };
    } catch (error) {
      return reportError(error, reply);
    }
  });
  app.post(path + '/pip/runs', async (request, reply) => {
    try {
      const access = await authorize(request, reply, true);
      if (!access) return;
      if (!canLeadRun(access.role))
        return reply
          .code(403)
          .send({ message: 'An owner or admin can start a Run.' });
      if (!agentEnabled)
        return reply
          .code(503)
          .send({ message: 'Connect an LLM provider to start a Run.' });
      const input = z
        .object({
          goal: z.string().trim().min(1).max(4_000),
          steps: z
            .array(z.string().trim().min(1).max(2_000))
            .max(12)
            .default([]),
          creditLimit: z
            .string()
            .trim()
            .regex(/^\d{1,14}(?:\.\d{1,10})?$/u)
            .refine((value) => creditUnits(value) > 0n),
          publishWebsites: z.boolean().default(false),
        })
        .parse(request.body);
      if (input.publishWebsites && !hosting)
        return reply.code(409).send({
          message:
            'Configure site hosting before enabling publication in this Run.',
        });
      const run = await context.runs.create(access.id, access.accountId, input);
      if (!run)
        return reply
          .code(409)
          .send({ message: 'This workspace already has an open Run.' });
      return reply.code(201).send({ run });
    } catch (error) {
      return reportError(error, reply);
    }
  });
  app.get(path + '/pip/runs/:resource/history', async (request, reply) => {
    try {
      const access = await authorize(request, reply);
      if (!access) return;
      const { resource } = resourceParams.parse(request.params);
      const { before } = z
        .object({ before: z.coerce.number().int().positive().optional() })
        .parse(request.query);
      const history = await context.runs.history(access.id, resource, before);
      if (!history) return reply.code(404).send({ message: 'Run not found.' });
      return history;
    } catch (error) {
      return reportError(error, reply);
    }
  });
  app.post(path + '/pip/runs/:resource/control', async (request, reply) => {
    try {
      const access = await authorize(request, reply, true);
      if (!access) return;
      if (!canLeadRun(access.role))
        return reply
          .code(403)
          .send({ message: 'An owner or admin can control a Run.' });
      const { resource } = resourceParams.parse(request.params);
      const { action } = z
        .object({ action: z.enum(['pause', 'resume']) })
        .parse(request.body);
      const run = await context.runs.control(access.id, resource, action);
      if (!run)
        return reply
          .code(409)
          .send({ message: 'Refresh the Run before changing its state.' });
      return { run };
    } catch (error) {
      return reportError(error, reply);
    }
  });
  app.get(path + '/pip/turns/:resource/events', async (request, reply) => {
    try {
      const access = await authorize(request, reply);
      if (!access) return;
      const { resource } = resourceParams.parse(request.params);
      let row = await store.readTurn(access.id, resource);
      if (!row) return reply.code(404).send({ message: 'Turn not found.' });
      reply.hijack();
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      });
      const abort = new AbortController();
      const onClose = () => abort.abort();
      reply.raw.on('close', onClose);
      const send = (event: string, payload: unknown) =>
        reply.raw.write(
          `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`,
        );
      try {
        send('turn', turnSnapshot(row));
        const until = Date.now() + 55_000;
        while (
          !abort.signal.aborted &&
          Date.now() < until &&
          (row.state === 'queued' || row.state === 'running')
        ) {
          await delay(600, undefined, { signal: abort.signal });
          const next = await store.readTurn(access.id, resource);
          if (!next) break;
          if (next.revision !== row.revision)
            send('changes', {
              id: next.id,
              from: row.revision,
              changes: [
                { op: 'set', path: ['parts'], value: next.parts },
                { op: 'set', path: ['status'], value: next.state },
                { op: 'set', path: ['text'], value: next.answer },
                { op: 'set', path: ['usage'], value: next.usage },
                { op: 'set', path: ['revision'], value: next.revision },
                {
                  op: 'set',
                  path: ['updatedAt'],
                  value: next.updatedAt.toISOString(),
                },
              ],
            });
          row = next;
        }
      } catch {
        /* Clients can reconnect with a fresh snapshot. */
      } finally {
        reply.raw.off('close', onClose);
        if (!reply.raw.destroyed) reply.raw.end();
      }
    } catch (error) {
      if (!reply.sent) return reportError(error, reply);
    }
  });
  app.get(path + '/run/read', async (request, reply) => {
    try {
      const access = await authorize(request, reply);
      if (access)
        return {
          items: await store.readNotifications(access.accountId, access.id),
        };
    } catch (error) {
      return reportError(error, reply);
    }
  });
  app.get(path + '/notifications', async (request, reply) => {
    try {
      const access = await authorize(request, reply);
      if (!access) return;
      const { before } = z
        .object({
          before: z.coerce.number().int().positive().optional(),
        })
        .parse(request.query);
      return await store.notificationHistory(
        access.accountId,
        access.id,
        before,
      );
    } catch (error) {
      return reportError(error, reply);
    }
  });
  app.post(path + '/run/read', async (request, reply) => {
    try {
      requireOrigin(request);
      const access = await authorize(request, reply);
      if (!access) return;
      const body = z
        .union([
          z.object({ all: z.literal(true) }).strict(),
          z
            .object({ keys: z.array(z.string().min(1).max(160)).max(200) })
            .strict(),
        ])
        .parse(request.body);
      await store.markNotifications(
        access.accountId,
        access.id,
        'all' in body ? null : body.keys,
      );
      return {
        items: await store.readNotifications(access.accountId, access.id),
      };
    } catch (error) {
      return reportError(error, reply);
    }
  });
  app.get(path + '/work/inbound', async (request, reply) => {
    try {
      const access = await authorize(request, reply);
      if (!access) return reply;
      const inbound = context.inbound;
      return {
        address: inbound.address(access.id),
        emails: await inbound.list(access.id),
      };
    } catch (error) {
      return reportError(error, reply);
    }
  });

  app.get(path + '/work/inbound/:resource', async (request, reply) => {
    try {
      const access = await authorize(request, reply);
      if (!access) return reply;
      const { resource } = resourceParams.parse(request.params);
      const email = await context.inbound.read(access.id, resource);
      if (!email) return reply.code(404).send({ message: 'Email not found.' });
      return { email };
    } catch (error) {
      return reportError(error, reply);
    }
  });

  app.get(path + '/work/summary', async (request, reply) => {
    try {
      const access = await authorize(request, reply);
      if (access) return { items: await store.workSummary(access.id) };
    } catch (error) {
      return reportError(error, reply);
    }
  });
  app.get(path + '/work', async (request, reply) => {
    try {
      const access = await authorize(request, reply);
      if (access) {
        const items = await store.listArtifacts(access.id);
        const now = new Date();
        return {
          hosting: Boolean(hosting),
          outreachSender: context.outreachSender ?? null,
          items: items.map((item) => describeWork(item, now)),
        };
      }
    } catch (error) {
      return reportError(error, reply);
    }
  });
  app.post(path + '/work/websites/import', async (request, reply) => {
    try {
      const access = await authorize(request, reply, true);
      if (!access) return;
      const { url } = z
        .object({ url: z.url({ protocol: /^https?$/u }).max(2048) })
        .parse(request.body);
      await context.limit('site-import', access.accountId, 5, 60);
      const page = await context.readPage(
        new URL(url),
        new Set(),
        AbortSignal.timeout(3500),
      );
      if (!page)
        return reply
          .code(422)
          .send({ message: 'Could not read public text at that address.' });
      const title = page.title.slice(0, 160);
      const body =
        '<main><h1>' +
        htmlText(title) +
        '</h1>' +
        page.paragraphs
          .map((text) => '<p>' + htmlText(text) + '</p>')
          .join('') +
        '</main>';
      const item = await store.saveArtifact({
        businessId: access.id,
        kind: 'website',
        title,
        body,
        state: 'pending',
      });
      return reply.code(201).send({ item: { id: item.id } });
    } catch (error) {
      return reportError(error, reply);
    }
  });
  app.get(path + '/work/:resource', async (request, reply) => {
    try {
      const access = await authorize(request, reply);
      if (!access) return;
      const { resource } = resourceParams.parse(request.params);
      const item = await store.workItem(access.id, resource);
      if (!item)
        return reply.code(404).send({ message: 'This item is unavailable.' });
      return {
        item: describeWork(item, new Date()),
        outreachSender: context.outreachSender ?? null,
      };
    } catch (error) {
      return reportError(error, reply);
    }
  });
  app.post(path + '/work/:resource/answer', async (request, reply) => {
    try {
      const access = await authorize(request, reply, true);
      if (!access) return;
      const { resource } = resourceParams.parse(request.params);
      const { answer } = z
        .object({ answer: z.string().trim().min(1).max(4000) })
        .parse(request.body);
      const item = await store.answerQuestion(access.id, resource, answer);
      if (!item)
        return reply.code(409).send({
          message: 'Refresh this question. It may already have an answer.',
        });
      return { item };
    } catch (error) {
      return reportError(error, reply);
    }
  });
  app.post(path + '/work/:resource/send-email', async (request, reply) => {
    try {
      const access = await authorize(request, reply, true);
      if (!access) return;
      if (!canLeadRun(access.role))
        return reply
          .code(403)
          .send({ message: 'An owner or admin can send approved email.' });
      if (!context.outreachSender || !agentEnabled)
        return reply.code(503).send({
          message: 'Configure a verified outreach sender to send email.',
        });
      const { resource } = resourceParams.parse(request.params);
      const { recipient, revision } = z
        .object({
          recipient: z.string().trim().max(254).pipe(z.email()),
          revision: z.int().positive(),
        })
        .parse(request.body);
      const email = await context.mail.queue({
        businessId: access.id,
        actorId: access.accountId,
        artifactId: resource,
        sender: context.outreachSender,
        recipient,
        revision,
      });
      if (!email)
        return reply.code(409).send({
          message: 'Check the approved draft and any existing email request.',
        });
      return reply.code(202).send({ email });
    } catch (error) {
      return reportError(error, reply);
    }
  });
  app.patch(path + '/work/:resource/website', async (request, reply) => {
    try {
      const access = await authorize(request, reply, true);
      if (!access) return;
      const { resource } = resourceParams.parse(request.params);
      const { title, body, pages, revision } = z
        .object({
          title: z.string().trim().min(1).max(160),
          body: z.string().trim().min(1).max(80_000),
          pages: websitePages.optional(),
          revision: z.int().positive(),
        })
        .parse(request.body);
      const item = await store.editWebsite(
        access.id,
        resource,
        revision,
        title,
        body,
        pages,
      );
      if (!item)
        return reply.code(409).send({
          message: 'The website draft has changed. Refresh it before saving.',
        });
      return { item };
    } catch (error) {
      return reportError(error, reply);
    }
  });
  app.get(versionsPath, async (request, reply) => {
    try {
      const access = await authorize(request, reply);
      if (!access) return;
      const { resource } = resourceParams.parse(request.params);
      return { versions: await store.websiteHistory(access.id, resource) };
    } catch (error) {
      return reportError(error, reply);
    }
  });
  app.get(versionsPath + '/:versionId', async (request, reply) => {
    try {
      const access = await authorize(request, reply);
      if (!access) return;
      const { resource, versionId } = versionParams.parse(request.params);
      const version = await store.websiteVersion(
        access.id,
        resource,
        versionId,
      );
      if (!version)
        return reply.code(404).send({ message: 'Version not found.' });
      return { version };
    } catch (error) {
      return reportError(error, reply);
    }
  });
  app.patch(versionsPath + '/:versionId', async (request, reply) => {
    try {
      const access = await authorize(request, reply, true);
      if (!access) return;
      const { resource, versionId } = versionParams.parse(request.params);
      const { bookmarked } = z
        .object({ bookmarked: z.boolean() })
        .parse(request.body);
      const item = await store.bookmarkVersion(
        access.id,
        resource,
        versionId,
        bookmarked,
      );
      if (!item) return reply.code(404).send({ message: 'Version not found.' });
      return { bookmarked };
    } catch (error) {
      return reportError(error, reply);
    }
  });
  app.post(versionsPath + '/:versionId/restore', async (request, reply) => {
    try {
      const access = await authorize(request, reply, true);
      if (!access) return;
      const { resource, versionId } = versionParams.parse(request.params);
      const { revision } = z
        .object({ revision: z.int().positive() })
        .parse(request.body);
      const prior = await store.websiteVersion(access.id, resource, versionId);
      if (!prior)
        return reply.code(404).send({ message: 'Version not found.' });
      if (prior.revision >= revision)
        return reply.code(409).send({
          message: 'Choose a version earlier than the current draft.',
        });
      const item = await store.editWebsite(
        access.id,
        resource,
        revision,
        prior.title,
        prior.document,
        prior.pages,
      );
      if (!item)
        return reply.code(409).send({
          message: 'Refresh the current draft before restoring a version.',
        });
      return { item };
    } catch (error) {
      return reportError(error, reply);
    }
  });
  app.post(path + '/work/:resource/decision', async (request, reply) => {
    try {
      const access = await authorize(request, reply, true);
      if (!access) return;
      if (access.role !== 'owner' && access.role !== 'admin')
        return reply
          .code(403)
          .send({ message: 'An owner or admin can review this draft.' });
      const { resource } = resourceParams.parse(request.params);
      const { approve, revision } = z
        .object({ approve: z.boolean(), revision: z.int().positive() })
        .parse(request.body);
      const item = await store.decide(
        access.id,
        resource,
        revision,
        approve,
        access.accountId,
      );
      if (!item)
        return reply.code(409).send({
          message:
            'This draft changed or was reviewed. Refresh it and check the latest version.',
        });
      return { item };
    } catch (error) {
      return reportError(error, reply);
    }
  });
  app.get(path + '/schedule/occurrences', async (request, reply) => {
    try {
      const access = await authorize(request, reply);
      if (!access) return;
      const range = z
        .object({
          from: z.iso.datetime({ offset: true }),
          to: z.iso.datetime({ offset: true }),
          limit: z.coerce.number().int().min(1).max(500).default(500),
        })
        .parse(request.query);
      const from = new Date(range.from);
      const to = new Date(range.to);
      const duration = to.getTime() - from.getTime();
      if (duration <= 0 || duration > 94 * 86_400_000)
        return reply
          .code(400)
          .send({ message: 'Choose a calendar range of up to 94 days.' });
      const [tasks, events] = await Promise.all([
        store.scheduledTasks(access.id, from, to),
        store.listCalendarEvents(access.id, from, to, range.limit + 1),
      ]);
      const occurrences = tasks
        .slice(0, 500)
        .flatMap((task) =>
          task.dueAt
            ? upcomingOccurrences(
                task.dueAt,
                task.recurrence,
                task.timezone,
                from,
                range.limit + 1,
                to,
              ).map((start) => ({ id: task.id, title: task.title, start }))
            : [],
        )
        .sort(
          (a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id),
        );
      return {
        occurrences: occurrences.slice(0, range.limit),
        days: [],
        calendarEvents: events.slice(0, range.limit),
        items: [],
        posts: [],
        clock: true,
        truncated:
          tasks.length > 500 ||
          occurrences.length > range.limit ||
          events.length > range.limit,
      };
    } catch (error) {
      return reportError(error, reply);
    }
  });
  app.post(path + '/schedule/events', async (request, reply) => {
    try {
      const access = await authorize(request, reply, true);
      if (!access) return;
      const { start, end, ...draft } = eventDraft.parse(request.body);
      const dates = calendarEventTimes(start, end, draft.timezone);
      if (!dates)
        return reply.code(400).send({
          message: 'Choose valid local times and an end after the start.',
        });
      const event = await store.createCalendarEvent({
        ...draft,
        ...dates,
        businessId: access.id,
      });
      return reply.code(201).send({ event });
    } catch (error) {
      return reportError(error, reply);
    }
  });
  app.post(path + '/work/tasks', async (request, reply) => {
    try {
      const access = await authorize(request, reply, true);
      if (!access) return;
      const { automatic, ...task } = z
        .object({
          title: z.string().trim().min(1).max(160),
          body: z.string().trim().max(4000),
          dueAt: z.iso.datetime({ offset: true }),
          recurrence: z.enum(recurrenceRules).default('once'),
          automatic: z.boolean().default(false),
          scheduleTimezone: timeZone.default('UTC'),
        })
        .parse(request.body);
      if (automatic && !canLeadRun(access.role))
        return reply
          .code(403)
          .send({ message: 'An owner or admin can schedule Pip execution.' });
      if (automatic && !agentEnabled)
        return reply.code(503).send({
          message: 'Connect an LLM provider to schedule Pip execution.',
        });
      const dueAt = new Date(task.dueAt);
      if (automatic && (!task.body || dueAt.getTime() <= Date.now()))
        return reply.code(400).send({
          message: 'Add instructions and choose a future time for Pip.',
        });
      return {
        item: await store.saveArtifact(
          {
            ...task,
            businessId: access.id,
            kind: 'task',
            dueAt,
          },
          automatic ? access.accountId : undefined,
        ),
      };
    } catch (error) {
      return reportError(error, reply);
    }
  });
  app.patch(path + '/work/:resource/automation', async (request, reply) => {
    try {
      const access = await authorize(request, reply, true);
      if (!access) return;
      if (!canLeadRun(access.role))
        return reply.code(403).send({
          message: 'An owner or admin can control scheduled execution.',
        });
      const { resource } = resourceParams.parse(request.params);
      const { enabled } = z
        .object({ enabled: z.boolean() })
        .parse(request.body);
      if (enabled && !agentEnabled)
        return reply.code(503).send({
          message: 'Connect an LLM provider to schedule Pip execution.',
        });
      const changed = await store.controlTaskAutomation(
        access.id,
        resource,
        access.accountId,
        enabled,
      );
      if (!changed)
        return reply.code(409).send({
          message: 'Choose a task with instructions and a future occurrence.',
        });
      return { enabled };
    } catch (error) {
      return reportError(error, reply);
    }
  });
  app.get(path + '/traffic', async (request, reply) => {
    try {
      const access = await authorize(request, reply);
      if (access) return { daily: await store.visitorCounts(access.id) };
    } catch (error) {
      return reportError(error, reply);
    }
  });
  app.get(deploymentsPath, async (request, reply) => {
    try {
      const access = await authorize(request, reply);
      if (!access) return;
      const { resource } = resourceParams.parse(request.params);
      const site = await store.workItem(access.id, resource);
      if (site?.kind !== 'website')
        return reply.code(404).send({ message: 'Website not found.' });
      const sync = context.siteSync;
      return {
        deployments: await store.deployments(access.id, resource),
        github:
          sync?.workspaceId === access.id && canLeadRun(access.role)
            ? { repo: sync.repo, branch: sync.branch }
            : null,
      };
    } catch (error) {
      return reportError(error, reply);
    }
  });
  app.post(
    deploymentsPath + '/:deploymentId/rollback',
    async (request, reply) => {
      try {
        const access = await authorize(request, reply, true);
        if (!access) return;
        if (!canLeadRun(access.role))
          return reply
            .code(403)
            .send({ message: 'An owner or admin can roll back a website.' });
        if (!hosting)
          return reply.code(409).send({
            message: 'Configure a site hosting domain to restore a deployment.',
          });
        const { resource, deploymentId } = resourceParams
          .extend({ deploymentId: z.uuid() })
          .parse(request.params);
        const { expectedLive } = z
          .object({ expectedLive: z.uuid().nullable() })
          .parse(request.body);
        const restored = await store.rollbackDeployment(
          access.id,
          resource,
          deploymentId,
          expectedLive,
        );
        if (!restored)
          return reply.code(409).send({
            message:
              'Refresh deployment history and choose an earlier deployment.',
          });
        return { deploymentId: restored.id, url: hosting.url(resource) };
      } catch (error) {
        return reportError(error, reply);
      }
    },
  );
  app.post(
    deploymentsPath + '/:deploymentId/github',
    async (request, reply) => {
      try {
        const access = await authorize(request, reply, true);
        if (!access) return;
        if (!canLeadRun(access.role))
          return reply.code(403).send({
            message: 'An owner or admin can sync a website to GitHub.',
          });
        const connector = context.siteSync;
        if (connector?.workspaceId !== access.id)
          return reply.code(409).send({
            message: 'GitHub sync is unavailable for this workspace.',
          });
        const { resource, deploymentId } = resourceParams
          .extend({ deploymentId: z.uuid() })
          .parse(request.params);
        const deploy = await store.liveDeployment(
          access.id,
          resource,
          deploymentId,
        );
        if (!deploy)
          return reply.code(409).send({
            message: 'Refresh the site and select its current live deployment.',
          });
        await context.limit('site-github-sync', access.accountId, 4, 60);
        const result = await connector.sync(deploy);
        if (!result)
          return reply.code(409).send({
            message:
              'GitHub declined the branch update. Check the branch and try again.',
          });
        return result;
      } catch (error) {
        return reportError(error, reply);
      }
    },
  );
  app.post(path + '/work/:resource/publish', async (request, reply) => {
    try {
      const access = await authorize(request, reply, true);
      if (!access) return;
      if (access.role !== 'owner' && access.role !== 'admin')
        return reply
          .code(403)
          .send({ message: 'An owner or admin can publish this website.' });
      if (!hosting)
        return reply
          .code(503)
          .send({ message: 'Configure a site hosting domain to publish.' });
      const { resource } = resourceParams.parse(request.params);
      const { publish, revision } = z
        .object({ publish: z.boolean(), revision: z.int().positive() })
        .parse(request.body);
      if (!(await store.publish(access.id, resource, revision, publish)))
        return reply.code(409).send({
          message:
            'Refresh the website and approve its current draft before publishing.',
        });
      return { url: publish ? hosting.url(resource) : null };
    } catch (error) {
      return reportError(error, reply);
    }
  });
}
