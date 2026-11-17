import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Queue, Worker } from 'bullmq';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import Fastify from 'fastify';
import Redis from 'ioredis';
import postgres from 'postgres';
import { accounts, businesses, members, publications } from '../src/db/schema';
import { agentStore } from '../src/workspace/agent-store';
import { creditConfig, creditLedger } from '../src/workspace/credits';
import { registerEmailDelivery } from '../src/workspace/email-delivery';
import { inboundMail } from '../src/workspace/inbound-mail';
import { mailStore } from '../src/workspace/mail-store';
import { runStore } from '../src/workspace/run-store';
import { taskAutomationStore } from '../src/workspace/task-automation';
import { agentRunner } from '../../worker/src/agent';
import type { ToolCall } from '../src/llm';

const url = process.env.TEST_DATABASE_URL;

test(
  'Run and Schedule persist work through pause, restart and repeated dispatch',
  { skip: !url },
  async () => {
    assert.ok(url);
    const schema = 'brightwork_test_' + randomUUID().replaceAll('-', '');
    const admin = postgres(url, { max: 1, connect_timeout: 5 });
    const client = postgres(url, {
      max: 4,
      connect_timeout: 5,
      connection: { search_path: schema },
    });
    try {
      await admin`create schema ${admin(schema)}`;
      const db = drizzle(client);
      await migrate(db, {
        migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
        migrationsSchema: schema,
      });
      const [account] = await db
        .insert(accounts)
        .values({ email: 'fixture@example.test' })
        .returning();
      const [business] = await db
        .insert(businesses)
        .values({ name: 'Run fixture' })
        .returning();
      assert.ok(account && business);
      const [otherBusiness] = await db
        .insert(businesses)
        .values({ name: 'Separate mailbox fixture' })
        .returning();
      assert.ok(otherBusiness);
      const emailId = randomUUID();
      const replyId = randomUUID();
      const attachmentId = randomUUID();
      const attachmentBody = Buffer.from('synthetic attachment contents');
      let attachmentReads = 0;
      let unsafeAttachment = false;
      const rootMessageId = '<original@sender.example.test>';
      const signingKey = Buffer.alloc(32, 56);
      let retrievals = 0;
      const inbound = inboundMail(
        db,
        {
          apiKey: 'fixture',
          domain: 'mail.example.test',
          secret: 'whsec_' + signingKey.toString('base64'),
        },
        async (url) => {
          if (
            url ===
            'https://api.resend.com/emails/receiving/' +
              emailId +
              '/attachments/' +
              attachmentId
          ) {
            attachmentReads += 1;
            return Response.json({
              id: attachmentId,
              size: attachmentBody.length,
              download_url: unsafeAttachment
                ? 'http://127.0.0.1/private'
                : 'https://inbound-cdn.resend.com/example?signature=test',
            });
          }
          if (
            String(url) ===
            'https://inbound-cdn.resend.com/example?signature=test'
          ) {
            attachmentReads += 1;
            return new Response(attachmentBody);
          }
          if (url === 'https://api.resend.com/emails/receiving/' + replyId) {
            retrievals += 1;
            return Response.json({
              text: 'Fixture reply',
              message_id: '<reply@sender.example.test>',
              headers: { 'In-Reply-To': rootMessageId },
            });
          }
          assert.equal(
            url,
            'https://api.resend.com/emails/receiving/' + emailId,
          );
          retrievals += 1;
          return retrievals === 1
            ? Response.json({}, { status: 503 })
            : Response.json({
                text: 'A mailbox fixture.',
                html: null,
                message_id: rootMessageId,
              });
        },
      );
      const server = Fastify();
      try {
        inbound.register(server);
        const timestamp = String(Math.floor(Date.now() / 1000));
        const svixId = 'msg_inbound_fixture';
        const address = inbound.address(business.id);
        assert.ok(address);
        const payload = JSON.stringify(
          {
            type: 'email.received',
            data: {
              email_id: emailId,
              created_at: '2026-11-17T01:00:00.000123+00:00',
              from: 'Sender <sender@example.test>',
              subject: 'Fixture delivery',
              attachments: [{ id: attachmentId, filename: 'fixture.pdf' }],
              to: [
                address,
                `Business <${address.toUpperCase()}>`,
                `workspace-${otherBusiness.id}@elsewhere.example.test`,
                `workspace-${randomUUID()}@mail.example.test`,
              ],
            },
          },
          null,
          2,
        );
        const signature = createHmac('sha256', signingKey)
          .update(`${svixId}.${timestamp}.${payload}`)
          .digest('base64');
        const inject = (raw: string, sig = signature) =>
          server.inject({
            method: 'POST',
            url: '/api/webhooks/inbound-email',
            headers: {
              'content-type': 'application/json',
              'svix-id': svixId,
              'svix-timestamp': timestamp,
              'svix-signature': 'v1,' + sig,
            },
            payload: raw,
          });
        assert.equal((await inject(payload + ' ')).statusCode, 401);
        assert.equal(retrievals, 0);
        assert.equal((await inject(payload)).statusCode, 503);
        assert.deepEqual(await inbound.list(business.id), []);
        assert.equal((await inject(payload)).statusCode, 200);
        assert.equal((await inject(payload)).statusCode, 200);
        assert.equal(retrievals, 2);
        const [received, duplicate] = await inbound.list(business.id);
        assert.ok(received);
        assert.equal(duplicate, undefined);
        assert.equal(received.subject, 'Fixture delivery');
        assert.equal(
          (await inbound.read(business.id, received.id))?.body,
          'A mailbox fixture.',
        );
        assert.deepEqual(await inbound.list(otherBusiness.id), []);
        assert.equal(
          await inbound.read(otherBusiness.id, received.id),
          undefined,
        );
        assert.equal(
          (await inboundMail(db).list(business.id))[0]?.id,
          received.id,
        );
        assert.deepEqual(
          (await inbound.read(business.id, received.id))?.attachments,
          [{ id: attachmentId, filename: 'fixture.pdf' }],
        );
        assert.equal(
          await inbound.download(otherBusiness.id, received.id, attachmentId),
          null,
        );
        assert.equal(
          await inbound.download(business.id, received.id, randomUUID()),
          null,
        );
        assert.equal(attachmentReads, 0);
        assert.deepEqual(
          await inbound.download(business.id, received.id, attachmentId),
          {
            filename: 'fixture.pdf',
            body: attachmentBody,
          },
        );
        assert.equal(attachmentReads, 2);
        unsafeAttachment = true;
        assert.equal(
          await inbound.download(business.id, received.id, attachmentId),
          null,
        );
        assert.equal(attachmentReads, 3);
        const replyPayload = JSON.stringify({
          type: 'email.received',
          data: {
            email_id: replyId,
            created_at: '2026-11-17T01:05:00Z',
            from: 'sender@example.test',
            subject: 'Re: Fixture delivery',
            to: [address],
          },
        });
        const replySignature = createHmac('sha256', signingKey)
          .update(`${svixId}.${timestamp}.${replyPayload}`)
          .digest('base64');
        assert.equal(
          (await inject(replyPayload, replySignature)).statusCode,
          200,
        );
        assert.equal(
          (await inject(replyPayload, replySignature)).statusCode,
          200,
        );
        assert.equal(retrievals, 3);
        assert.deepEqual(
          (await inbound.thread(business.id, received.threadId)).map(
            (item) => item.subject,
          ),
          ['Re: Fixture delivery', 'Fixture delivery'],
        );
        assert.deepEqual(
          await inbound.thread(otherBusiness.id, received.threadId),
          [],
        );
      } finally {
        await server.close();
      }
      await db.insert(members).values({
        accountId: account.id,
        businessId: business.id,
        role: 'owner',
      });
      const agent = agentStore(db);
      const calendarEvent = await agent.createCalendarEvent({
        businessId: business.id,
        title: 'Planning session',
        timezone: 'Australia/Perth',
        startsAt: new Date('2026-11-16T15:30:00Z'),
        endsAt: new Date('2026-11-17T16:00:00Z'),
        attendees: 'Fixture attendee',
        notes: 'Bring an outline.',
      });
      assert.ok(calendarEvent);
      const windowStart = new Date('2026-11-17T04:00:00Z');
      const windowEnd = new Date('2026-11-17T20:00:00Z');
      assert.deepEqual(
        (
          await agent.listCalendarEvents(business.id, windowStart, windowEnd, 1)
        ).map((event) => event.id),
        [calendarEvent.id],
      );
      assert.deepEqual(
        await agent.listCalendarEvents(
          otherBusiness.id,
          windowStart,
          windowEnd,
          1,
        ),
        [],
      );
      assert.deepEqual(
        await agent.listCalendarEvents(
          business.id,
          calendarEvent.endsAt,
          windowEnd,
          1,
        ),
        [],
      );
      const runs = runStore(db);
      let time = Date.now() + 60_000;
      const clock = () => new Date((time += 5_000));
      const started = await runs.create(business.id, account.id, {
        goal: 'Publish a homepage',
        steps: ['Build a draft'],
        creditLimit: '0.10',
        publishWebsites: true,
      });
      assert.ok(started);
      assert.equal(
        await runs.create(business.id, account.id, {
          goal: 'Duplicate',
          steps: ['Build'],
          creditLimit: '1',
          publishWebsites: false,
        }),
        null,
      );
      const work = await runs.advance(clock());
      assert.ok(work?.turnId);
      assert.equal((await runs.advance(clock()))?.turnId, work.turnId);
      assert.ok(await runs.control(business.id, started.id, 'pause'));
      assert.equal(await agent.claimTurn(work.turnId), null);
      assert.ok(await runs.control(business.id, started.id, 'resume'));
      const claim = await agent.claimTurn(work.turnId);
      assert.ok(claim);
      assert.equal(await agent.claimTurn(work.turnId), null);

      const credits = creditLedger(db, creditConfig.parse({}));
      assert.equal(
        await credits.debit(account.id, work.turnId, 'fixture', 'model'),
        true,
      );
      assert.equal(
        await credits.debit(account.id, work.turnId, 'fixture', 'model'),
        true,
      );
      assert.equal(
        await credits.debit(account.id, work.turnId, 'over-limit', 'tool'),
        false,
      );
      const page = await agent.saveArtifact({
        businessId: business.id,
        turnId: work.turnId,
        kind: 'website',
        state: 'pending',
        title: 'Example homepage',
        body: '<h1>Example homepage</h1>',
        pages: [
          {
            slug: 'about',
            title: 'About',
            html: '<h1>About our business</h1>',
          },
        ],
      });
      await agent.updateTurn(work.turnId, {
        state: 'completed',
        answer: 'Draft saved.',
      });
      await runs.advance(clock());
      assert.equal((await runs.list(business.id))[0]?.waitingFor, 'approval');
      assert.equal(await agent.published(page.id), undefined);
      const decide = () =>
        agent.decide(business.id, page.id, page.revision, true, account.id);
      assert.equal(
        (await Promise.all([decide(), decide()])).filter(Boolean).length,
        1,
      );
      assert.equal(await agent.published(page.id), undefined);
      assert.ok(await runs.control(business.id, started.id, 'pause'));
      assert.equal(await runs.advance(clock()), null);
      assert.ok(await runs.control(business.id, started.id, 'resume'));

      const restarted = runStore(db);
      await restarted.advance(clock());
      await restarted.advance(clock());
      await restarted.advance(clock());
      assert.equal((await agent.published(page.id))?.document, page.body);
      assert.deepEqual((await agent.published(page.id))?.pages, page.pages);
      const [version] = await agent.websiteHistory(business.id, page.id);
      assert.ok(version);
      assert.deepEqual(
        (await agent.websiteVersion(business.id, page.id, version.id))?.pages,
        page.pages,
      );
      assert.equal(
        (
          await db
            .select()
            .from(publications)
            .where(eq(publications.artifactId, page.id))
        ).length,
        1,
      );
      const [finished] = await restarted.list(business.id);
      assert.ok(finished);
      assert.equal(finished.state, 'completed');
      assert.equal(finished.publications[0]?.state, 'published');
      assert.equal(finished.creditsUsed, '0.1000000000');

      const startedResearch = await runs.create(business.id, account.id, {
        goal: 'Research a source, ask the owner, and prepare a reviewed homepage',
        steps: ['Read an example page and ask for the headline'],
        creditLimit: '1',
        publishWebsites: true,
      });
      assert.ok(startedResearch);
      const completions = [
        {
          name: 'read_public_page',
          input: { url: 'https://example.test/about' },
        },
        {
          name: 'ask_owner',
          input: {
            title: 'Which headline?',
            body: 'Choose the public headline.',
          },
        },
        null,
        {
          name: 'build',
          input: {
            title: 'Research homepage',
            body: '<h1>Chosen headline</h1>',
          },
        },
        null,
      ];
      let llmCalls = 0;
      const run = agentRunner(
        agent,
        credits,
        async (messages, tools) => {
          assert.ok(
            tools.some((tool) => tool.function.name === 'read_public_page'),
          );
          const fixture = completions[llmCalls++];
          if (fixture?.name === 'build')
            assert.ok(
              messages.some((message) =>
                JSON.stringify(message).includes('Chosen headline'),
              ),
            );
          const calls: ToolCall[] = fixture
            ? [
                {
                  type: 'function',
                  id: 'fixture-' + llmCalls,
                  function: {
                    name: fixture.name,
                    arguments: JSON.stringify(fixture.input),
                  },
                },
              ]
            : [];
          return {
            text: fixture ? '' : 'Step complete.',
            calls,
            usage: undefined,
          };
        },
        undefined,
        async (url) => ({
          url: url.href,
          title: 'Example source',
          paragraphs: ['Public fixture evidence about the company.'],
          score: 1,
        }),
      );
      const first = await runs.advance(clock());
      assert.ok(first?.turnId);
      await Promise.all([run(first.turnId), run(first.turnId)]);
      assert.equal(llmCalls, 3);
      const evidence = (
        await agent.readTurn(business.id, first.turnId)
      )?.parts.find(
        (part) => part.type === 'tool' && part.name === 'read_public_page',
      );
      assert.match(JSON.stringify(evidence), /Example source/);
      const question = (await agent.listArtifacts(business.id)).find(
        (item) => item.turnId === first.turnId && item.kind === 'question',
      );
      assert.ok(question);
      await runs.advance(clock());
      assert.equal((await runs.list(business.id))[0]?.waitingFor, 'answer');
      assert.ok(
        await agent.answerQuestion(business.id, question.id, 'Chosen headline'),
      );
      const next = await restarted.advance(clock());
      assert.ok(next?.turnId && next.turnId !== first.turnId);
      const redisUrl = process.env.REDIS_URL;
      if (redisUrl) {
        const connection = new Redis(redisUrl, {
          maxRetriesPerRequest: null,
          connectTimeout: 5000,
        });
        const options = { connection, prefix: schema };
        const queue = new Queue<{ turnId: string }>('run-fixture', options);
        const startWorker = () =>
          new Worker<{ turnId: string }>(
            'run-fixture',
            (job) => run(job.data.turnId),
            { ...options, autorun: false },
          );
        const original = startWorker();
        const replacement = startWorker();
        try {
          await original.waitUntilReady();
          await original.close();
          const job = { turnId: next.turnId };
          await Promise.all([
            queue.add('turn', job, { jobId: next.turnId }),
            queue.add('turn', job, { jobId: next.turnId }),
          ]);
          const terminal = once(replacement, 'completed', {
            signal: AbortSignal.timeout(10_000),
          });
          await Promise.race([replacement.run(), terminal]);
          const counts = await queue.getJobCounts('completed', 'waiting');
          assert.equal(counts.completed, 1);
          assert.equal(counts.waiting, 0);
        } finally {
          await replacement.close();
          await original.close();
          await queue.obliterate({ force: true });
          await queue.close();
          connection.disconnect();
        }
      } else {
        await run(next.turnId);
      }
      assert.equal(llmCalls, 5);
      const reviewed = (await agent.listArtifacts(business.id)).find(
        (item) => item.turnId === next.turnId && item.kind === 'website',
      );
      assert.ok(reviewed);
      await restarted.advance(clock());
      assert.equal((await runs.list(business.id))[0]?.waitingFor, 'approval');
      assert.ok(
        await agent.decide(
          business.id,
          reviewed.id,
          reviewed.revision,
          true,
          account.id,
        ),
      );
      assert.equal(
        (await runs.list(business.id))[0]?.publications[0]?.state,
        'queued',
      );
      // The second attempt can still see an answered question only on the first turn.
      for (let index = 0; index < 3; index += 1)
        await restarted.advance(clock());
      const report = await runs.history(business.id, startedResearch.id);
      assert.ok(report);
      assert.equal(report.run.state, 'completed');
      assert.ok(
        report.events.some(
          (event) => event.kind === 'waiting' && event.detail === 'answer',
        ),
      );
      assert.ok(report.events.some((event) => event.kind === 'step_finished'));
      assert.equal(
        await runs.history(otherBusiness.id, startedResearch.id),
        null,
      );

      const lowBudget = await runs.create(business.id, account.id, {
        goal: 'Exercise the credit cap',
        steps: ['Try a model call'],
        creditLimit: '0.01',
        publishWebsites: false,
      });
      assert.ok(lowBudget);
      const denied = await restarted.advance(clock());
      assert.ok(denied?.turnId);
      await run(denied.turnId);
      assert.equal(llmCalls, 5);
      await restarted.advance(clock());
      assert.equal(
        (await runs.history(business.id, lowBudget.id))?.run.state,
        'failed',
      );
      assert.match(
        (await runs.history(business.id, lowBudget.id))?.run.failure ?? '',
        /credit limit/,
      );

      const task = await agent.saveArtifact(
        {
          businessId: business.id,
          title: 'Schedule fixture',
          body: 'Write a follow-up',
          kind: 'task',
          dueAt: new Date(time),
          recurrence: 'once',
        },
        account.id,
      );
      const schedule = taskAutomationStore(db);
      const scheduled = await schedule.advance(clock());
      assert.ok(scheduled?.turnId);
      assert.equal(
        (await taskAutomationStore(db).advance(clock()))?.turnId,
        scheduled.turnId,
      );
      assert.ok(
        await agent.controlTaskAutomation(
          business.id,
          task.id,
          account.id,
          false,
        ),
      );
      assert.equal(await agent.claimTurn(scheduled.turnId), null);
      assert.equal(
        (await agent.readTurn(business.id, scheduled.turnId))?.state,
        'failed',
      );
      assert.equal(await schedule.advance(clock()), null);

      const recurringStart = new Date(time + 60_000);
      await agent.saveArtifact(
        {
          businessId: business.id,
          title: 'Recurring fixture',
          body: 'Report',
          kind: 'task',
          dueAt: recurringStart,
          recurrence: 'daily',
        },
        account.id,
      );
      time = recurringStart.getTime() + 2 * 86_400_000 + 1;
      const executed = new Set<string>();
      for (let day = 0; day < 3; day += 1) {
        const occurrence = await schedule.advance(clock());
        assert.ok(occurrence?.turnId);
        assert.ok(!executed.has(occurrence.turnId));
        executed.add(occurrence.turnId);
        assert.equal(
          (await taskAutomationStore(db).advance(clock()))?.turnId,
          occurrence.turnId,
        );
        assert.match(
          (await agent.readTurn(business.id, occurrence.turnId))?.prompt ?? '',
          new RegExp(
            new Date(recurringStart.getTime() + day * 86_400_000)
              .toISOString()
              .slice(0, 10),
          ),
        );
        assert.ok(await agent.claimTurn(occurrence.turnId));
        await agent.updateTurn(occurrence.turnId, {
          state: 'completed',
          answer: 'Done.',
        });
      }
      assert.equal(await schedule.advance(clock()), null);

      const draft = await agent.saveArtifact({
        businessId: business.id,
        title: 'Hello',
        body: 'Approved message',
        kind: 'email',
        state: 'pending',
        replyRecipient: 'hello@example.test',
        replyMessageId: rootMessageId,
      });
      const mail = mailStore(db);
      const request = {
        businessId: business.id,
        artifactId: draft.id,
        revision: draft.revision,
        actorId: account.id,
        sender: 'owner@example.test',
        recipient: 'hello@example.test',
        replyAddress: 'workspace@example.test',
      };
      assert.equal(await mail.queue(request), null);
      assert.ok(
        await agent.decide(
          business.id,
          draft.id,
          draft.revision,
          true,
          account.id,
        ),
      );
      const queued = await mail.queue(request);
      assert.ok(queued);
      assert.deepEqual(await mail.queue(request), queued);
      assert.equal(
        await mail.queue({ ...request, recipient: 'other@example.test' }),
        null,
      );
      const attempt = await mail.claim(clock());
      assert.ok(attempt);
      assert.equal(await mail.claim(clock()), null);

      const [other] = await db
        .insert(businesses)
        .values({ name: 'Other workspace' })
        .returning();
      assert.ok(other);
      await agent.saveArtifact({
        businessId: other.id,
        title: 'Hello',
        body: 'Private',
        kind: 'document',
      });
      const matches = await agent.searchWork(account.id, business.id, 'Hello');
      assert.deepEqual(
        matches.map((item) => item.id),
        [draft.id],
      );
      await agent.saveArtifact({
        businessId: business.id,
        title: 'Plan 50%_draft',
        body: 'Draft',
        kind: 'document',
      });
      await agent.saveArtifact({
        businessId: business.id,
        title: 'Plan 500draft',
        body: 'Other draft',
        kind: 'document',
      });
      assert.equal(
        (await agent.searchWork(account.id, business.id, '50%_')).length,
        1,
      );
      const providerId = randomUUID();
      const deliveryServer = Fastify();
      try {
        registerEmailDelivery(
          deliveryServer,
          db,
          'whsec_' + signingKey.toString('base64'),
        );
        const timestamp = String(Math.floor(Date.now() / 1000));
        function deliver(
          id: string,
          type: string,
          time: string,
          key = signingKey,
        ) {
          const payload = JSON.stringify({
            type,
            created_at: time,
            data: { email_id: providerId, to: ['hello@example.test'] },
          });
          const signature = createHmac('sha256', key)
            .update(id + '.' + timestamp + '.' + payload)
            .digest('base64');
          return deliveryServer.inject({
            method: 'POST',
            url: '/api/webhooks/email-delivery',
            payload,
            headers: {
              'content-type': 'application/json',
              'svix-id': id,
              'svix-timestamp': timestamp,
              'svix-signature': 'v1,' + signature,
            },
          });
        }
        const sent = '2026-11-18T02:00:00Z';
        const delivered = '2026-11-18T02:00:02Z';
        assert.equal(
          (
            await deliver(
              'delivery_wrong',
              'email.bounced',
              delivered,
              Buffer.alloc(32),
            )
          ).statusCode,
          401,
        );
        assert.equal(
          (await deliver('delivery_final', 'email.delivered', delivered))
            .statusCode,
          200,
        );
        assert.deepEqual(await mail.history(business.id, draft.id), []);
        await mail.record(
          attempt,
          { kind: 'accepted', id: providerId },
          clock(),
        );
        assert.equal(
          (await deliver('delivery_final', 'email.delivered', delivered))
            .statusCode,
          200,
        );
        assert.equal(
          (await deliver('delivery_sent', 'email.sent', sent)).statusCode,
          200,
        );
        const history = await mailStore(db).history(business.id, draft.id);
        assert.deepEqual(
          history.map((event) => event.status),
          ['delivered', 'sent'],
        );
        assert.equal(history[0]?.revision, draft.revision);
        assert.deepEqual(await mail.history(other.id, draft.id), []);
      } finally {
        await deliveryServer.close();
      }
      assert.equal(
        (await agent.workItem(business.id, draft.id))?.emailState,
        'accepted',
      );
      assert.equal(await mail.claim(clock()), null);
    } finally {
      await client.end();
      await admin`drop schema if exists ${admin(schema)} cascade`.finally(() =>
        admin.end(),
      );
    }
  },
);
