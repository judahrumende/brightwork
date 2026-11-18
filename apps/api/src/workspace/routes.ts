import { sendStorePhoto } from './store-product-photo';
import { orderAction, productEdit } from './generated-store';
import { storeCurrency, storeDeliveryZones } from '@brightwork/shared';
import { buildSummary } from './build-activity';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Queue } from 'bullmq';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type Redis from 'ioredis';
import { websitePages } from '@brightwork/shared';
import type { siteHosting } from './publication';
import type { pageReader } from '../research/page';
import type { githubSiteSync } from './github-site-sync';
import { registerWorkspaceSettings } from './settings-routes';
import type { shopifyOrders } from './shopify-orders';
import type { teamStore } from './team';
import type { vaultStore } from './vault';
import type { domainStore } from './domains';
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
import { smsReplyInput } from './sms';
import type { stripeConnect } from './stripe-connect';
import type { workspaceSms } from './sms';
import type { inboundMail } from './inbound-mail';

import { commerceRange } from './commerce-insights';
import type { commerceInsights } from './commerce-insights';

import { mediaInput } from './media-store';
import type { MediaKind, mediaStore } from './media-store';

type Context = {
  store: ReturnType<typeof agentStore>;
  team: ReturnType<typeof teamStore>;
  commerce: ReturnType<typeof shopifyOrders> | undefined;
  sellerPayments: ReturnType<typeof stripeConnect> | undefined;
  media: ReturnType<typeof mediaStore>;
  mediaRates: Partial<Record<MediaKind, string>>;
  salesInsights: (
    id: string,
    range: z.infer<typeof commerceRange>,
  ) => ReturnType<typeof commerceInsights>;
  domains: ReturnType<typeof domainStore>;
  vault: ReturnType<typeof vaultStore> | undefined;
  runs: ReturnType<typeof runStore>;
  mail: ReturnType<typeof mailStore>;
  inbound: ReturnType<typeof inboundMail>;
  sms: ReturnType<typeof workspaceSms> | undefined;
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

  registerWorkspaceSettings(app, {
    team: context.team,
    commerce: context.commerce,
    sellerPayments: context.sellerPayments,
    sms: context.sms,
    vault: context.vault,
    domains: context.domains,
    authorize,
    reportError,
  });

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
  async function streamTurn(request: FastifyRequest, reply: FastifyReply) {
    try {
      const access = await authorize(request, reply);
      if (!access) return;
      const { resource, runId } = resourceParams
        .extend({ runId: z.uuid().optional() })
        .parse(request.params);
      let row = await store.readTurn(access.id, resource);
      if (!row || (runId && row.runId !== runId))
        return reply.code(404).send({ message: 'Turn not found.' });
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
          if (!next || (runId && next.runId !== runId)) break;
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
  }
  app.get(path + '/pip/turns/:resource/events', streamTurn);
  app.get(path + '/ted/unattended/:runId/turns/:resource/events', streamTurn);
  function conditionalWorkspaceRead(
    request: FastifyRequest,
    reply: FastifyReply,
    snapshot: unknown,
  ) {
    const etag =
      '"' +
      createHash('sha256')
        .update(JSON.stringify(snapshot))
        .digest('base64url') +
      '"';
    reply
      .header('ETag', etag)
      .header('Cache-Control', 'private, no-cache')
      .header('Vary', 'Cookie');
    if (
      request.headers['if-none-match']?.split(',').some((value) => {
        const tag = value.trim().replace(/^W\//u, '');
        return tag === '*' || tag === etag;
      })
    )
      return reply.code(304).send();
    return snapshot;
  }

  app.get(path + '/build/active-runs', async (request, reply) => {
    try {
      const access = await authorize(request, reply);
      if (!access) return;
      const [builds, waiting] = await Promise.all([
        store.buildActivity(access.id, { active: true }),
        store.workByKind(access.id, 'website', true, 100),
      ]);
      return conditionalWorkspaceRead(request, reply, {
        companyId: access.id,
        builds: builds.map((row) => ({
          run: buildSummary(row),
          chatId: row.run_id ?? row.turn_id,
          unattended: row.run_id !== null,
        })),
        line: waiting.map(({ id, title }) => ({
          id,
          creationId: id,
          kind: 'approval',
          title,
        })),
      });
    } catch (error) {
      return reportError(error, reply);
    }
  });

  app.get(path + '/build/runs', async (request, reply) => {
    try {
      const access = await authorize(request, reply);
      if (!access) return;
      const { chatId } = z
        .object({ chatId: z.uuid().optional() })
        .parse(request.query);
      const runs = await store.buildActivity(
        access.id,
        chatId ? { chatId } : {},
      );
      return conditionalWorkspaceRead(request, reply, {
        companyId: access.id,
        runs: runs.map(buildSummary),
      });
    } catch (error) {
      return reportError(error, reply);
    }
  });

  app.get(path + '/build/runs/:resource', async (request, reply) => {
    try {
      const access = await authorize(request, reply);
      if (!access) return;
      const { resource } = resourceParams.parse(request.params);
      const [row] = await store.buildActivity(access.id, { buildId: resource });
      if (!row) return reply.code(404).send({ message: 'Build not found.' });
      return { companyId: access.id, run: buildSummary(row) };
    } catch (error) {
      return reportError(error, reply);
    }
  });
  app.get(path + '/ted/chats', async (request, reply) => {
    try {
      const access = await authorize(request, reply);
      if (!access) return;
      const { limit } = z
        .object({ limit: z.coerce.number().int().min(1).max(100).default(25) })
        .parse(request.query);
      return { conversations: await store.conversations(access.id, { limit }) };
    } catch (error) {
      return reportError(error, reply);
    }
  });
  app.get(path + '/ted/chats/:resource/title', async (request, reply) => {
    try {
      const access = await authorize(request, reply);
      if (!access) return;
      const { resource } = resourceParams.parse(request.params);
      const [conversation] = await store.conversations(access.id, {
        id: resource,
      });
      if (!conversation)
        return reply.code(404).send({ message: 'Chat not found.' });
      return conversation;
    } catch (error) {
      return reportError(error, reply);
    }
  });
  app.get(path + '/ted/chats/:resource/queue', async (request, reply) => {
    try {
      const access = await authorize(request, reply);
      if (!access) return;
      const { resource } = resourceParams.parse(request.params);
      const runQueue = await context.runs.queue(access.id, resource);
      const direct = runQueue
        ? undefined
        : await store.readTurn(access.id, resource);
      if (!runQueue && (!direct || direct.runId))
        return reply.code(404).send({ message: 'Chat not found.' });
      const turn = runQueue?.turn ?? direct;
      const items =
        runQueue?.items ??
        (direct?.state === 'queued'
          ? [
              {
                id: direct.id,
                turnId: direct.id,
                prompt: direct.prompt,
                status: direct.state,
              },
            ]
          : []);
      return conditionalWorkspaceRead(request, reply, {
        chatId: resource,
        revision: turn?.revision ?? 0,
        paused: runQueue?.paused ?? false,
        items,
        ...(turn ? { turn: turnSnapshot(turn) } : {}),
      });
    } catch (error) {
      return reportError(error, reply);
    }
  });

  app.get(path + '/ted/chats/:resource', async (request, reply) => {
    try {
      const access = await authorize(request, reply);
      if (!access) return;
      const { resource } = resourceParams.parse(request.params);
      const turns = await context.runs.turns(access.id, resource, 50);
      if (turns) return { id: resource, turns: turns.map(turnSnapshot) };
      const direct = await store.readTurn(access.id, resource);
      if (!direct || direct.runId)
        return reply.code(404).send({ message: 'Chat not found.' });
      return { id: resource, turns: [turnSnapshot(direct)] };
    } catch (error) {
      return reportError(error, reply);
    }
  });
  app.get(path + '/ted/unattended/:resource', async (request, reply) => {
    try {
      const access = await authorize(request, reply);
      if (!access) return;
      const { resource } = resourceParams.parse(request.params);
      const { limit } = z
        .object({
          limit: z.coerce.number().int().min(1).max(50).default(10),
        })
        .parse(request.query);
      const turns = await context.runs.turns(access.id, resource, limit);
      if (!turns) return reply.code(404).send({ message: 'Run not found.' });
      const snapshot = { id: resource, turns: turns.map(turnSnapshot) };
      return conditionalWorkspaceRead(request, reply, snapshot);
    } catch (error) {
      return reportError(error, reply);
    }
  });
  app.get(path + '/run/session', async (request, reply) => {
    try {
      const access = await authorize(request, reply);
      if (!access) return;
      const include = z
        .object({
          passes: z.literal('newest').optional(),
          questions: z.literal('open').optional(),
          report: z.literal('ended').optional(),
        })
        .parse(request.query);
      const run = await context.runs.current(access.id);
      if (!run) return { session: null };
      const [turns, questions, report, waiting] = await Promise.all([
        include.passes && context.runs.turns(access.id, run.id, 10),
        include.questions && context.runs.questions(access.id, run.id),
        include.report &&
          run.endedAt &&
          context.runs.history(access.id, run.id),
        run.waitingFor === 'approval' &&
          context.runs.waitingApprovals(access.id, run.id),
      ]);
      return {
        session: {
          id: run.id,
          chatId: run.id,
          state: run.state,
          startedAt: run.createdAt,
          ending: run.endedAt ? { at: run.endedAt, reason: run.failure } : null,
          ...(waiting ? { waiting } : {}),
        },
        ...(turns
          ? { passes: { id: run.id, turns: turns.map(turnSnapshot) } }
          : {}),
        ...(questions
          ? {
              questions: {
                sessionId: run.id,
                questions: questions.filter((question) => !question.answer),
                files: false,
              },
            }
          : {}),
        ...(report ? { report } : {}),
      };
    } catch (error) {
      return reportError(error, reply);
    }
  });
  for (const view of ['directions', 'questions', 'tasks'] as const) {
    app.get(path + '/run/' + view, async (request, reply) => {
      try {
        const access = await authorize(request, reply);
        if (!access) return;
        const [run] = await context.runs.list(access.id);
        const sessionId = run?.id ?? '';
        if (view === 'questions')
          return {
            sessionId,
            questions: run
              ? await context.runs.questions(access.id, run.id)
              : [],
            files: false,
          };
        const items =
          run?.steps.map((step) => ({
            id: run.id + ':' + step.position,
            goal: step.instruction,
            kind: 'step',
            status: step.finishedAt ? 'completed' : (step.status ?? 'pending'),
          })) ?? [];
        if (view === 'tasks') return { tasks: items };
        return {
          sessionId,
          directions: [],
          aim: { kind: run ? 'goal' : 'idle', title: run?.goal ?? '' },
          ...(run?.pausedAt
            ? { held: { why: 'Paused by the workspace', since: run.pausedAt } }
            : {}),
          sprint: {
            goals: run
              ? [{ id: run.id, goal: run.goal, status: run.state }]
              : [],
            items,
          },
        };
      } catch (error) {
        return reportError(error, reply);
      }
    });
  }
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
  app.get(path + '/media', async (request, reply) => {
    try {
      const access = await authorize(request, reply);
      if (!access) return reply;
      return {
        rates: context.mediaRates,
        jobs: await context.media.list(access.id),
      };
    } catch (error) {
      return reportError(error, reply);
    }
  });
  app.get(path + '/video/renders', async (request, reply) => {
    try {
      const access = await authorize(request, reply);
      if (!access) return reply;
      const jobs = await context.media.list(access.id, 'video');
      return {
        items: jobs.map((job) => ({
          ...job,
          downloadUrl:
            job.state === 'completed'
              ? `/api/companies/${access.id}/media/${job.id}/asset`
              : null,
        })),
        nextCursor: null,
      };
    } catch (error) {
      return reportError(error, reply);
    }
  });
  app.post(path + '/media', async (request, reply) => {
    try {
      const access = await authorize(request, reply, true);
      if (!access) return reply;
      const input = mediaInput.parse(request.body);
      const rate = context.mediaRates[input.kind];
      if (rate === undefined)
        return reply
          .code(503)
          .send({ message: 'This media provider is unavailable.' });
      await context.limit('media-generation', access.accountId, 10, 60);
      const disposition = await context.media.enqueue(
        access.id,
        access.accountId,
        input,
        rate,
      );
      if (disposition === 'accepted')
        return reply.code(202).send({ id: input.id });
      if (disposition === 'insufficient_credits')
        return reply
          .code(402)
          .send({ message: 'Insufficient credits for this generation.' });
      return reply.code(409).send({
        message:
          disposition === 'price_changed'
            ? 'The credit rate changed. Refresh before submitting.'
            : 'This request ID is already in use.',
      });
    } catch (error) {
      return reportError(error, reply);
    }
  });
  app.get(path + '/media/:resource/asset', async (request, reply) => {
    try {
      const access = await authorize(request, reply);
      if (!access) return reply;
      const { resource } = z
        .object({ resource: z.uuid() })
        .parse(request.params);
      const asset = await context.media.asset(access.id, resource);
      if (!asset?.bytes || !asset.mime)
        return reply.code(404).send({ message: 'Asset not found.' });
      const ext = { image: 'png', video: 'mp4', voice: 'mp3' }[asset.kind];
      return reply
        .type(asset.mime)
        .header('X-Content-Type-Options', 'nosniff')
        .header(
          'Content-Disposition',
          'attachment; filename="brightwork-' + resource + '.' + ext + '"',
        )
        .send(asset.bytes);
    } catch (error) {
      return reportError(error, reply);
    }
  });

  app.get(path + '/insights/commerce', async (request, reply) => {
    try {
      const access = await authorize(request, reply);
      if (!access) return reply;
      return await context.salesInsights(
        access.id,
        commerceRange.parse(request.query),
      );
    } catch (error) {
      return reportError(error, reply);
    }
  });

  app.get(path + '/work/sms', async (request, reply) => {
    try {
      const access = await authorize(request, reply);
      if (!access) return reply;
      const sms = context.sms;
      const [connection, messages] = sms
        ? await Promise.all([sms.connection(access.id), sms.list(access.id)])
        : [null, []];
      return {
        enabled: Boolean(sms),
        connected: Boolean(connection?.connected),
        messages,
      };
    } catch (error) {
      return reportError(error, reply);
    }
  });
  app.post(path + '/work/sms', async (request, reply) => {
    try {
      const access = await authorize(request, reply, true);
      if (!access) return reply;
      if (!canLeadRun(access.role))
        return reply
          .code(403)
          .send({ message: 'An owner or admin can send SMS replies.' });
      if (!context.sms)
        return reply.code(503).send({ message: 'SMS is unavailable.' });
      const input = smsReplyInput.parse(request.body);
      await context.limit('sms-reply', access.id, 15, 60);
      const result = await context.sms.reply(access.id, input);
      if ('error' in result)
        return reply.code(409).send({ message: result.error });
      return result;
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
      return {
        email,
        thread: await context.inbound.thread(access.id, email.threadId),
      };
    } catch (error) {
      return reportError(error, reply);
    }
  });

  app.get(
    path + '/work/inbound/:resource/attachments/:file',
    async (request, reply) => {
      try {
        const access = await authorize(request, reply);
        if (!access) return;
        const { resource, file } = resourceParams
          .extend({ file: z.uuid() })
          .parse(request.params);
        await context.limit('mail-attachment', access.accountId, 10, 60);
        const result = await context.inbound.download(
          access.id,
          resource,
          file,
        );
        if (!result)
          return reply.code(404).send({ message: 'Attachment not available.' });
        const name =
          result.filename
            .replace(/[^a-z0-9_. -]/giu, '_')
            .replace(/^\.+/u, '') || 'attachment';
        return reply
          .header('Content-Disposition', 'attachment; filename="' + name + '"')
          .header('X-Content-Type-Options', 'nosniff')
          .type('application/octet-stream')
          .send(result.body);
      } catch (error) {
        return reportError(error, reply);
      }
    },
  );

  app.post(
    path + '/work/inbound/:resource/reply-draft',
    async (request, reply) => {
      try {
        const access = await authorize(request, reply, true);
        if (!access) return;
        const { resource } = resourceParams.parse(request.params);
        const { body } = z
          .object({ body: z.string().trim().min(1).max(8000) })
          .parse(request.body);
        const email = await context.inbound.read(access.id, resource);
        if (!email)
          return reply.code(404).send({ message: 'Email not found.' });
        const address =
          /^[^<>]*<([^<>]+)>$/u.exec(email.sender)?.[1] ?? email.sender;
        const recipient = z.email().safeParse(address.trim());
        if (!recipient.success || !email.messageId)
          return reply.code(409).send({
            message: 'This email does not have a reply address and message ID.',
          });
        const title = (
          /^Re:/iu.test(email.subject) ? email.subject : 'Re: ' + email.subject
        )
          .replace(/[\r\n]+/gu, ' ')
          .trim()
          .slice(0, 160);
        const item = await store.saveArtifact({
          businessId: access.id,
          kind: 'email',
          state: 'pending',
          title: title || 'Re: Your message',
          body,
          replyRecipient: recipient.data,
          replyMessageId: email.messageId,
        });
        return reply.code(201).send({ item: { id: item.id } });
      } catch (error) {
        return reportError(error, reply);
      }
    },
  );
  for (const { route, kind } of [
    { route: '/inbox/drafts', kind: 'email' },
    { route: '/social/posts', kind: 'post' },
  ] as const) {
    app.get(path + route, async (request, reply) => {
      try {
        const access = await authorize(request, reply);
        if (!access) return;
        const { limit, waiting } = z
          .object({
            limit: z.coerce.number().int().min(1).max(100).default(50),
            waiting: z.enum(['true', 'false']).default('false'),
          })
          .parse(request.query);
        const items = await store.workByKind(
          access.id,
          kind,
          waiting === 'true',
          limit,
        );
        return {
          items: items.map((item) => describeWork(item, new Date())),
          nextCursor: null,
        };
      } catch (error) {
        return reportError(error, reply);
      }
    });
  }
  app.get(path + '/inbox/changes', async (request, reply) => {
    try {
      const access = await authorize(request, reply);
      if (!access) return;
      const { seen } = z
        .object({ seen: z.string().max(256).optional() })
        .parse(request.query);
      const deadline = Date.now() + 20_000;
      const stop = new AbortController();
      const close = () => stop.abort();
      reply.raw.once('close', close);
      try {
        for (;;) {
          const state = await Promise.all([
            context.inbound.list(access.id),
            store.inboxRevisionRows(access.id),
          ]);
          const revision = createHash('sha256')
            .update(JSON.stringify(state))
            .digest('base64url');
          if (reply.raw.destroyed || stop.signal.aborted) return reply.hijack();
          if (revision !== seen || Date.now() >= deadline) return { revision };
          await delay(1_000, undefined, { signal: stop.signal });
        }
      } catch (error) {
        if (stop.signal.aborted) return reply.hijack();
        throw error;
      } finally {
        reply.raw.off('close', close);
      }
    } catch (error) {
      return reportError(error, reply);
    }
  });
  app.get(path + '/build/website-waits', async (request, reply) => {
    try {
      const access = await authorize(request, reply);
      if (!access) return;
      const items = await store.workByKind(access.id, 'website', true, 100);
      return {
        companyId: access.id,
        websites: items.map(({ id, title, state, revision }) => ({
          id,
          title,
          state,
          revision,
        })),
        unscanned: [],
      };
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
  app.get(path + '/work/files', async (request, reply) => {
    try {
      const access = await authorize(request, reply);
      if (!access) return;
      const { q } = z
        .object({ q: z.string().trim().max(160).default('') })
        .parse(request.query);
      return { files: await store.listFiles(access.id, q) };
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
  const storePath = path + '/work/:resource/store';
  app.get(storePath, async (request, reply) => {
    try {
      const access = await authorize(request, reply);
      if (!access) return;
      const { resource } = resourceParams.parse(request.params);
      const dashboard = await store.generatedStore.read(access.id, resource);
      if (!dashboard)
        return reply.code(404).send({ message: 'Store not found.' });
      return {
        ...dashboard,
        paymentReady:
          (await context.sellerPayments?.readyForCheckout(access.id)) ?? false,
      };
    } catch (error) {
      return reportError(error, reply);
    }
  });
  app.get(storePath + '/photos/:product', async (request, reply) => {
    try {
      const access = await authorize(request, reply);
      if (!access) return;
      const { resource, product } = resourceParams
        .extend({ product: z.uuid() })
        .parse(request.params);
      return sendStorePhoto(
        reply,
        await store.generatedStore.photo(resource, product, access.id),
      );
    } catch (error) {
      return reportError(error, reply);
    }
  });
  const storeUpdate = z.discriminatedUnion('action', [
    z.object({ action: z.literal('product'), product: productEdit }),
    z.object({ action: z.literal('currency'), currency: storeCurrency }),
    z.object({
      action: z.literal('delivery'),
      revision: z.int().nonnegative(),
      zones: storeDeliveryZones,
    }),
    z.object({ action: z.literal('order'), id: z.uuid(), status: orderAction }),
    z.object({ action: z.literal('payment'), id: z.uuid() }),
    z.object({ action: z.literal('close_payment'), id: z.uuid() }),
  ]);
  app.post(storePath, async (request, reply) => {
    try {
      const access = await authorize(request, reply, true);
      if (!access) return;
      if (!canLeadRun(access.role))
        return reply
          .code(403)
          .send({ message: 'Only owners and admins can manage stores.' });
      const { resource } = resourceParams.parse(request.params);
      const update = storeUpdate.parse(request.body);
      const dashboard = await store.generatedStore.scopedStore(
        access.id,
        resource,
      );
      if (!dashboard)
        return reply.code(404).send({ message: 'Store not found.' });
      if (update.action === 'payment' || update.action === 'close_payment') {
        if (!context.sellerPayments)
          return reply
            .code(503)
            .send({ message: 'Stripe test payments are unavailable.' });
        if (update.action === 'payment') {
          const sale = await store.generatedStore.createPayment(
            access.id,
            resource,
            update.id,
          );
          if (sale) return { saved: true };
        } else if (
          await context.sellerPayments.closeStoreCheckout(
            access.id,
            resource,
            update.id,
          )
        ) {
          return { saved: true };
        }
        return reply.code(409).send({
          message:
            update.action === 'payment'
              ? 'Confirm the order and check your Stripe seller settings before creating a payment link.'
              : 'Checkout could not be closed. Check the payment in Stripe before cancelling the order.',
        });
      }
      const changed =
        update.action === 'product'
          ? await store.generatedStore.saveProduct(
              access.id,
              resource,
              update.product,
            )
          : update.action === 'delivery'
            ? await store.generatedStore.setDelivery(
                access.id,
                resource,
                update.revision,
                update.zones,
              )
            : update.action === 'currency'
              ? await store.generatedStore.setCurrency(
                  access.id,
                  resource,
                  update.currency,
                )
              : await store.generatedStore.changeOrder(
                  access.id,
                  resource,
                  update.id,
                  update.status,
                );
      if (!changed)
        return reply.code(409).send({
          message:
            'This change conflicts with the current store. Refresh and try again.',
        });
      return { saved: true };
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
  app.get(path + '/work/:resource/email-history', async (request, reply) => {
    try {
      const access = await authorize(request, reply);
      if (!access) return;
      const { resource } = resourceParams.parse(request.params);
      return { events: await context.mail.history(access.id, resource) };
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
        replyAddress: context.inbound.address(access.id),
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
  function describeCreation(
    row: Awaited<ReturnType<typeof store.creations>>[number],
  ) {
    const pages = [
      { path: '/', title: row.title, state: row.state },
      ...row.pages.map(({ slug, title }) => ({
        path: '/' + slug,
        title,
        state: row.state,
      })),
    ];
    const url = row.publication && hosting ? hosting.url(row.id) : null;
    return {
      id: row.id,
      title: row.title,
      kind: row.kind,
      createdAt: row.createdAt,
      updatedAt: row.currentVersion.savedAt,
      currentVersionId: row.currentVersion.id,
      currentVersion: {
        id: row.currentVersion.id,
        versionNumber: row.currentVersion.revision,
        savedAt: row.currentVersion.savedAt,
        pagePaths: pages.map((page) => page.path),
        pages,
      },
      pages,
      publication: row.publication && {
        releaseId: row.publication.id,
        revision: row.publication.revision,
        publishedAt: row.publication.publishedAt,
        published: true,
        publishedVersionId: row.publishedVersionId,
        hostname: url ? new URL(url).hostname : null,
        url,
      },
      publicationCapability: {
        available: Boolean(hosting),
        currentVersion: row.currentVersion.id,
      },
    };
  }

  app.get(path + '/creations/site-care/changes', async (request, reply) => {
    try {
      const access = await authorize(request, reply);
      if (!access) return;
      const results = await store.websiteReviews(access.id, {
        onlyPublished: true,
      });
      return {
        companyId: access.id,
        changes: results.map(({ change }) => change),
      };
    } catch (error) {
      return reportError(error, reply);
    }
  });
  app.get(
    path + '/creations/:resource/site-care/:versionId',
    async (request, reply) => {
      try {
        const access = await authorize(request, reply);
        if (!access) return;
        const { resource, versionId } = versionParams.parse(request.params);
        const [result] = await store.websiteReviews(access.id, {
          id: resource,
          versionId,
          onlyPublished: true,
        });
        if (!result)
          return reply
            .code(404)
            .send({ message: 'Pending website change not found.' });
        return { companyId: access.id, change: result.change };
      } catch (error) {
        return reportError(error, reply);
      }
    },
  );
  app.get(path + '/work/:resource/review', async (request, reply) => {
    try {
      const access = await authorize(request, reply);
      if (!access) return;
      const { resource } = resourceParams.parse(request.params);
      const { revision } = z
        .object({ revision: z.coerce.number().int().positive() })
        .parse(request.query);
      const [result] = await store.websiteReviews(access.id, {
        id: resource,
        revision,
      });
      if (!result)
        return reply.code(404).send({
          message: 'Refresh the work item to review its current draft.',
        });
      return result;
    } catch (error) {
      return reportError(error, reply);
    }
  });
  app.get(path + '/creations', async (request, reply) => {
    try {
      const access = await authorize(request, reply);
      if (!access) return;
      const creations = await store.creations(access.id);
      return {
        companyId: access.id,
        creations: creations.map(describeCreation),
        nextCursor: null,
      };
    } catch (error) {
      return reportError(error, reply);
    }
  });
  app.get(path + '/creations/:resource', async (request, reply) => {
    try {
      const access = await authorize(request, reply);
      if (!access) return;
      const { resource } = resourceParams.parse(request.params);
      const [row] = await store.creations(access.id, resource);
      if (!row) return reply.code(404).send({ message: 'Website not found.' });
      return { companyId: access.id, creation: describeCreation(row) };
    } catch (error) {
      return reportError(error, reply);
    }
  });
  app.get(path + '/creations/:resource/versions', async (request, reply) => {
    try {
      const access = await authorize(request, reply);
      if (!access) return;
      const { resource } = resourceParams.parse(request.params);
      const versions = await store.websiteHistory(access.id, resource);
      if (!versions.length)
        return reply.code(404).send({ message: 'Website not found.' });
      return {
        companyId: access.id,
        creationId: resource,
        versions: versions.map(({ revision, ...version }) => ({
          ...version,
          versionNumber: revision,
          previewable: true,
        })),
        nextCursor: null,
      };
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
        prior.id,
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
  app.patch(path + '/schedule/events/:resource', async (request, reply) => {
    try {
      const access = await authorize(request, reply, true);
      if (!access) return;
      const { resource } = resourceParams.parse(request.params);
      const { start, end, ...draft } = eventDraft.parse(request.body);
      const dates = calendarEventTimes(start, end, draft.timezone);
      if (!dates)
        return reply.code(400).send({
          message: 'Choose valid local times and an end after the start.',
        });
      const event = await store.updateCalendarEvent(access.id, resource, {
        ...draft,
        ...dates,
      });
      if (!event) return reply.code(404).send({ message: 'Event not found.' });
      return { event };
    } catch (error) {
      return reportError(error, reply);
    }
  });
  app.delete(path + '/schedule/events/:resource', async (request, reply) => {
    try {
      const access = await authorize(request, reply, true);
      if (!access) return;
      const { resource } = resourceParams.parse(request.params);
      if (!(await store.removeCalendarEvent(access.id, resource)))
        return reply.code(404).send({ message: 'Event not found.' });
      return { deleted: true };
    } catch (error) {
      return reportError(error, reply);
    }
  });
  app.post(path + '/work/tasks', async (request, reply) => {
    try {
      const access = await authorize(request, reply, true);
      if (!access) return;
      const { automatic, whenEmailArrives, ...task } = z
        .object({
          title: z.string().trim().min(1).max(160),
          body: z.string().trim().max(4000),
          dueAt: z.iso.datetime({ offset: true }).optional(),
          recurrence: z.enum(recurrenceRules).default('once'),
          automatic: z.boolean().default(false),
          whenEmailArrives: z.boolean().default(false),
          scheduleTimezone: timeZone.default('UTC'),
        })
        .parse(request.body);
      const executes = automatic || whenEmailArrives;
      if (executes && !canLeadRun(access.role))
        return reply
          .code(403)
          .send({ message: 'An owner or admin can schedule Pip execution.' });
      if (executes && !agentEnabled)
        return reply.code(503).send({
          message: 'Connect an LLM provider to schedule Pip execution.',
        });
      const dueAt = task.dueAt ? new Date(task.dueAt) : null;
      if (
        whenEmailArrives &&
        (dueAt || automatic || task.recurrence !== 'once')
      )
        return reply.code(400).send({
          message: 'Choose either a schedule or an incoming email trigger.',
        });
      if (whenEmailArrives && !context.inbound.address(access.id))
        return reply
          .code(503)
          .send({ message: 'Connect inbound email to run this task.' });
      if (
        (!whenEmailArrives && !dueAt) ||
        (executes && (!task.body || (dueAt && dueAt.getTime() <= Date.now())))
      )
        return reply.code(400).send({
          message:
            'Add instructions for Pip and choose a future time or an inbox trigger.',
        });
      return {
        item: await store.saveArtifact(
          {
            ...task,
            businessId: access.id,
            kind: 'task',
            dueAt,
          },
          executes ? access.accountId : undefined,
          whenEmailArrives,
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
  app.get(path + '/traffic/visits', async (request, reply) => {
    try {
      const access = await authorize(request, reply);
      if (!access) return;
      const range = z
        .object({
          from: z.iso.datetime({ offset: true }),
          to: z.iso.datetime({ offset: true }),
        })
        .parse(request.query);
      const from = new Date(range.from);
      const to = new Date(range.to);
      const duration = to.getTime() - from.getTime();
      if (duration < 1 || duration > 90 * 86_400_000)
        return reply
          .code(400)
          .send({ message: 'Choose a visitor range up to 90 days.' });
      return await store.reportVisits(access.id, from, to);
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
