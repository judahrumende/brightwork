import { storeBuyers } from '../src/workspace/store-buyers';
import { productEdit } from '../src/workspace/generated-store';
import { siteHosting } from '../src/workspace/publication';
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
import {
  accounts,
  businesses,
  inboundEmails,
  members,
  publications,
} from '../src/db/schema';
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

function fixturePage(title: string, links = '') {
  return `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width"><title>${title}</title><style>main{max-width:60rem;margin:auto}</style></head><body><main><h1>${title}</h1>${links}</main></body></html>`;
}

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
            design: 'Editorial typography and a restrained palette.',
            changes: [
              {
                slug: '',
                action: 'write',
                title: 'Research homepage',
                brief: 'Use the headline supplied by the owner.',
              },
            ],
          },
        },
        null,
      ];
      let llmCalls = 0;
      const run = agentRunner(
        agent,
        credits,
        async (messages, tools, options) => {
          if (!tools.length) {
            llmCalls += 1;
            assert.match(JSON.stringify(messages), /Chosen headline/);
            return {
              text: options?.json
                ? JSON.stringify(completions[3]?.input)
                : fixturePage('Chosen headline'),
              calls: [],
              usage: undefined,
            };
          }
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
                    arguments: JSON.stringify(
                      fixture.name === 'build' ? {} : fixture.input,
                    ),
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
      assert.equal(llmCalls, 6);
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
      assert.equal(llmCalls, 6);
      await restarted.advance(clock());
      assert.equal(
        (await runs.history(business.id, lowBudget.id))?.run.state,
        'failed',
      );
      assert.match(
        (await runs.history(business.id, lowBudget.id))?.run.failure ?? '',
        /credit limit/,
      );

      async function websiteTurn(
        workspaceId: string,
        input: {
          storeCurrency?: 'AUD';
          targetId?: string;
          title?: string;
          design: string;
          changes: object[];
        },
        pages: Array<string | (() => Promise<string>)>,
        denyPage = false,
      ) {
        const turn = await agent.addTurn(
          workspaceId,
          account.id,
          'Build the requested website changes.',
        );
        const modelKeys: string[] = [];
        let pageCalls = 0;
        let planned = false;
        const build = agentRunner(
          agent,
          {
            async debit(accountId, turnId, key, kind) {
              if (kind === 'model') modelKeys.push(key);
              if (denyPage && key === 'website:0:0:1') return false;
              return credits.debit(accountId, turnId, key, kind);
            },
          },
          async (messages, tools, options) => {
            if (!tools.length) {
              if (options?.json)
                return {
                  calls: [],
                  text: JSON.stringify(input),
                  usage: { prompt_tokens: 10, completion_tokens: 12 },
                };
              assert.equal(options?.maxTokens, 8192);
              const page = pages[pageCalls++];
              assert.ok(page);
              if (
                pageCalls === 2 &&
                typeof page === 'string' &&
                page.includes('First page')
              ) {
                assert.match(
                  messages[0]?.content ?? '',
                  /Fix navigation targets/,
                );
              }
              return {
                calls: [],
                text: typeof page === 'string' ? page : await page(),
                usage: { prompt_tokens: 10, completion_tokens: 12 },
              };
            }
            if (planned)
              return { text: 'Turn finished.', calls: [], usage: undefined };
            planned = true;
            return {
              text: '',
              calls: [
                {
                  id: turn.id,
                  type: 'function',
                  function: {
                    name: 'build',
                    arguments: JSON.stringify({ targetId: input.targetId }),
                  },
                },
              ],
              usage: { prompt_tokens: 10, completion_tokens: 12 },
            };
          },
        );
        await build(turn.id);
        return {
          turn: await agent.readTurn(workspaceId, turn.id),
          pageCalls,
          modelKeys,
        };
      }

      const writePage = (slug: string, title: string) => ({
        slug,
        title,
        action: 'write',
        brief: 'Write ' + title,
      });
      const newSite = {
        title: 'Website fixture',
        design: 'One consistent editorial design.',
        changes: [writePage('', 'Home'), writePage('about', 'About')],
      };
      const home = fixturePage('First page', '<a href="/about">About</a>');
      const about = fixturePage('About', '<a href="/">Home</a>');
      const initial = await websiteTurn(business.id, newSite, [
        fixturePage('Broken first attempt', '<a href="/missing">Broken</a>'),
        home,
        about,
      ]);
      assert.equal(initial.pageCalls, 3);
      assert.equal(new Set(initial.modelKeys).size, 5);
      assert.equal(initial.turn?.state, 'completed');
      assert.deepEqual(initial.turn?.usage, {
        inputTokens: 50,
        outputTokens: 60,
      });
      assert.ok(initial.turn);
      const [firstBuild] = await agent.buildActivity(business.id, {
        chatId: initial.turn.id,
      });
      assert.equal(firstBuild?.revision, 1);
      assert.ok(firstBuild?.creation_id);
      const siteId = firstBuild.creation_id;
      const chosen = await agent.workItem(business.id, siteId);
      assert.equal(chosen?.body, home);
      assert.equal(chosen?.pages[0]?.html, about);
      assert.ok(await agent.decide(business.id, siteId, 1, true, account.id));
      assert.ok(await agent.publish(business.id, siteId, 1, true));

      const target = {
        targetId: siteId,
        design: newSite.design,
        changes: [writePage('about', 'New About')],
      };
      const newAbout = fixturePage('New About');
      const updated = await websiteTurn(business.id, target, [newAbout]);
      assert.equal(updated.turn?.state, 'completed');
      assert.ok(updated.turn);
      const [secondBuild] = await agent.buildActivity(business.id, {
        chatId: updated.turn.id,
      });
      assert.equal(secondBuild?.revision, 2);
      assert.equal(secondBuild?.creation_id, siteId);
      assert.equal(secondBuild?.state, 'completed');
      assert.notEqual(secondBuild?.version_id, firstBuild.version_id);
      assert.notEqual(secondBuild?.source_hash, firstBuild.source_hash);
      assert.equal(
        (await agent.buildActivity(business.id, { chatId: initial.turn.id }))[0]
          ?.version_id,
        firstBuild.version_id,
      );
      assert.equal((await agent.workItem(business.id, siteId))?.body, home);
      assert.equal(
        (await agent.workItem(business.id, siteId))?.pages[0]?.html,
        newAbout,
      );
      assert.equal((await agent.published(siteId))?.pages[0]?.html, about);
      assert.deepEqual(
        (await agent.websiteHistory(business.id, siteId)).map(
          ({ revision }) => revision,
        ),
        [2, 1],
      );

      const failed = await websiteTurn(business.id, target, [
        fixturePage(
          'Unverified contact',
          '<a href="mailto:fake@example.test">Email us</a>',
        ),
        fixturePage(
          'Unverified contact',
          '<a href="tel:0412345678">Call us</a>',
        ),
      ]);
      assert.equal(failed.turn?.state, 'failed');
      assert.match(failed.turn?.answer ?? '', /Omit invented contact/);
      const deniedSite = await websiteTurn(business.id, newSite, [], true);
      assert.equal(deniedSite.turn?.state, 'failed');
      assert.equal(deniedSite.pageCalls, 0);
      const removal = await websiteTurn(
        business.id,
        { ...target, changes: [{ slug: 'about', action: 'remove' }] },
        [],
      );
      assert.match(removal.turn?.answer ?? '', /Update navigation/);
      const foreign = await websiteTurn(otherBusiness.id, target, []);
      assert.match(foreign.turn?.answer ?? '', /not found in this workspace/);
      assert.equal((await agent.workItem(business.id, siteId))?.revision, 2);
      assert.equal(
        (await agent.creations(business.id)).filter(
          (item) => item.title === newSite.title,
        ).length,
        1,
      );

      const concurrent = await websiteTurn(business.id, target, [
        async () => {
          assert.ok(
            await agent.editWebsite(
              business.id,
              siteId,
              2,
              'Manual edit',
              home,
            ),
          );
          return fixturePage('Outdated edit');
        },
      ]);
      assert.equal(concurrent.turn?.state, 'failed');
      assert.match(concurrent.turn?.answer ?? '', /draft changed/);
      assert.equal(
        (await agent.workItem(business.id, siteId))?.title,
        'Manual edit',
      );
      assert.equal((await agent.published(siteId))?.pages[0]?.html, about);

      const shop = await websiteTurn(
        business.id,
        {
          title: 'Fieldwork store',
          design: 'Warm paper and strong type',
          storeCurrency: 'AUD',
          changes: [writePage('', 'Home')],
        },
        [fixturePage('Fieldwork')],
      );
      assert.equal(shop.turn?.state, 'completed');
      const shopId = (await agent.listArtifacts(business.id)).find(
        (item) => item.turnId === shop.turn?.id,
      )?.id;
      assert.ok(shopId);
      assert.equal((await agent.workItem(business.id, shopId))?.isStore, true);
      assert.equal(
        (await agent.generatedStore.read(business.id, shopId))?.currency,
        'AUD',
      );
      assert.equal(
        await agent.generatedStore.read(otherBusiness.id, shopId),
        null,
      );
      const product = {
        name: 'Copper <Kettle>',
        description: 'Pour-over kettle.',
        price: 4500,
        stock: 1,
        active: true,
      };
      assert.equal(
        await agent.generatedStore.saveProduct(
          otherBusiness.id,
          shopId,
          product,
        ),
        false,
      );
      assert.ok(
        await agent.generatedStore.saveProduct(business.id, shopId, product),
      );
      const shopApp = Fastify();
      const buyers = storeBuyers(db, 'synthetic-buyer-test-secret');
      let delivery: { email: string; code: string; host: string } | undefined;
      siteHosting(
        shopApp,
        agent,
        'https://studio.example.test',
        'sites.example.test',
        async () => {},
        {
          buyers,
          sendCode: async (email, code, host) => {
            delivery = { email, code, host };
          },
          limit: async () => {},
          paymentOrigin: 'https://studio.example.test',
        },
      );
      try {
        const host = shopId + '.sites.example.test';
        const browser = { host, origin: 'https://' + host };
        const catalogPath = '/store/catalog';
        assert.equal(
          (await shopApp.inject({ url: catalogPath, headers: { host } }))
            .statusCode,
          404,
        );
        assert.equal(
          (await shopApp.inject({ url: '/store/account', headers: { host } }))
            .statusCode,
          404,
        );
        assert.ok(await agent.decide(business.id, shopId, 1, true, account.id));
        assert.ok(await agent.publish(business.id, shopId, 1, true));
        const listing = await shopApp.inject({
          url: catalogPath,
          headers: { host },
        });
        assert.equal(listing.statusCode, 200);
        assert.match(listing.body, /Copper &lt;Kettle&gt;/u);
        assert.equal(
          (
            await shopApp.inject({
              url: catalogPath,
              headers: { host: 'studio.example.test' },
            })
          ).statusCode,
          404,
        );
        const [savedProduct] = (await agent.generatedStore.read(
          business.id,
          shopId,
        ))!.products;
        assert.ok(savedProduct);
        function placeOrder(id: string, headers = browser) {
          return shopApp.inject({
            method: 'POST',
            url: '/store/orders',
            headers: {
              ...headers,
              'content-type': 'application/x-www-form-urlencoded',
            },
            payload: new URLSearchParams({
              id,
              productId: savedProduct!.id,
              revision: '1',
              email: 'buyer@example.test',
              quantity: '1',
            }).toString(),
          });
        }
        const firstId = randomUUID();
        const secondId = randomUUID();
        assert.equal(
          (
            await placeOrder(firstId, {
              ...browser,
              origin: 'https://other.example.test',
            })
          ).statusCode,
          403,
        );
        assert.equal((await placeOrder(firstId)).statusCode, 200);
        assert.equal((await placeOrder(firstId)).statusCode, 200);
        assert.equal((await placeOrder(secondId)).statusCode, 200);
        assert.equal(
          (await agent.generatedStore.read(business.id, shopId))?.orders.length,
          2,
        );
        const confirmations = await Promise.all(
          [firstId, secondId].map((id) =>
            agent.generatedStore.changeOrder(
              business.id,
              shopId,
              id,
              'confirmed',
            ),
          ),
        );
        assert.equal(confirmations.filter(Boolean).length, 1);
        const confirmed = confirmations[0] ? firstId : secondId;
        assert.equal(
          await agent.generatedStore.changeOrder(
            otherBusiness.id,
            shopId,
            confirmed,
            'fulfilled',
          ),
          false,
        );
        assert.ok(
          await agent.generatedStore.changeOrder(
            business.id,
            shopId,
            confirmed,
            'cancelled',
          ),
        );
        assert.equal(
          (await agent.generatedStore.read(business.id, shopId))?.products[0]
            ?.stock,
          1,
        );
        assert.ok(
          await agent.generatedStore.changeOrder(
            business.id,
            shopId,
            confirmed === firstId ? secondId : firstId,
            'confirmed',
          ),
        );
        assert.ok(
          await agent.generatedStore.changeOrder(
            business.id,
            shopId,
            confirmed === firstId ? secondId : firstId,
            'fulfilled',
          ),
        );
        assert.equal(
          (await agent.generatedStore.read(business.id, shopId))?.products[0]
            ?.stock,
          0,
        );

        const [kettle] = (await agent.generatedStore.read(business.id, shopId))!
          .products;
        assert.ok(kettle);
        assert.ok(
          await agent.generatedStore.saveProduct(business.id, shopId, {
            ...kettle,
            stock: 1,
          }),
        );
        assert.ok(
          await agent.generatedStore.saveProduct(business.id, shopId, {
            name: 'Filters',
            description: '',
            price: 700,
            stock: 2,
            active: true,
          }),
        );
        const productsNow = (await agent.generatedStore.read(
          business.id,
          shopId,
        ))!.products;
        const cartId = randomUUID();
        const cartFields = new URLSearchParams({
          id: cartId,
          email: 'cart@example.test',
        });
        for (const current of productsNow)
          cartFields.set(`cart:${current.id}:${current.revision}`, '1');
        function postCart(payload: URLSearchParams) {
          return shopApp.inject({
            method: 'POST',
            url: '/store/orders',
            headers: {
              ...browser,
              'content-type': 'application/x-www-form-urlencoded',
            },
            payload: payload.toString(),
          });
        }
        const currentListing = await shopApp.inject({
          url: catalogPath,
          headers: { host },
        });
        assert.match(currentListing.body, /name="cart:/u);
        assert.equal(currentListing.headers['referrer-policy'], 'same-origin');
        assert.equal((await postCart(cartFields)).statusCode, 200);
        assert.equal((await postCart(cartFields)).statusCode, 200);
        const cart = (
          await agent.generatedStore.read(business.id, shopId)
        )?.orders.find((order) => order.id === cartId);
        assert.deepEqual(
          cart?.items.map((item) => item.unitPrice).sort((a, b) => a - b),
          [700, 4500],
        );

        const currentKettle = productsNow.find(
          (entry) => entry.id === kettle.id,
        );
        assert.ok(currentKettle);
        assert.ok(
          await agent.generatedStore.saveProduct(business.id, shopId, {
            ...currentKettle,
            stock: 0,
          }),
        );
        assert.equal(
          await agent.generatedStore.changeOrder(
            business.id,
            shopId,
            cartId,
            'confirmed',
          ),
          false,
        );
        assert.equal(
          (await agent.generatedStore.read(business.id, shopId))?.products.find(
            (entry) => entry.name === 'Filters',
          )?.stock,
          2,
        );
        const freshKettle = (
          await agent.generatedStore.read(business.id, shopId)
        )?.products.find((entry) => entry.id === kettle.id);
        assert.ok(freshKettle);
        assert.ok(
          await agent.generatedStore.saveProduct(business.id, shopId, {
            ...freshKettle,
            stock: 1,
            price: 5000,
          }),
        );
        assert.ok(
          await agent.generatedStore.changeOrder(
            business.id,
            shopId,
            cartId,
            'confirmed',
          ),
        );
        assert.deepEqual(
          (await agent.generatedStore.read(business.id, shopId))?.products
            .map(({ stock }) => stock)
            .sort((a, b) => a - b),
          [0, 1],
        );
        assert.ok(
          await agent.generatedStore.changeOrder(
            business.id,
            shopId,
            cartId,
            'cancelled',
          ),
        );
        assert.deepEqual(
          (await agent.generatedStore.read(business.id, shopId))?.products
            .map(({ stock }) => stock)
            .sort((a, b) => a - b),
          [1, 2],
        );

        const initial = (await agent.generatedStore.read(
          business.id,
          shopId,
        ))!.products.find((p) => p.id === kettle.id);
        assert.ok(initial);
        const png =
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aAC0AAAAASUVORK5CYII=';
        assert.equal(
          productEdit.safeParse({
            ...initial,
            photo: {
              data: 'data:image/png;base64,PGh0bWw+',
              alt: 'Invalid',
            },
          }).success,
          false,
        );
        assert.ok(
          await agent.generatedStore.saveProduct(
            business.id,
            shopId,
            productEdit.parse({
              ...initial,
              photo: {
                data: 'data:image/png;base64,' + png,
                alt: 'Copper kettle',
              },
            }),
          ),
        );
        const variant = {
          parentId: kettle.id,
          name: 'Large',
          description: '',
          price: 6200,
          stock: 3,
          active: true,
          sku: 'KETTLE-L',
        };
        assert.equal(
          await agent.generatedStore.saveProduct(
            otherBusiness.id,
            shopId,
            variant,
          ),
          false,
        );
        assert.ok(
          await agent.generatedStore.saveProduct(business.id, shopId, variant),
        );
        assert.equal(
          await agent.generatedStore.saveProduct(business.id, shopId, {
            ...variant,
            name: 'large',
            sku: 'another',
          }),
          false,
        );
        assert.equal(
          await agent.generatedStore.saveProduct(business.id, shopId, {
            ...variant,
            name: 'Medium',
            sku: 'kettle-l',
          }),
          false,
        );
        const withVariant = (await agent.generatedStore.read(
          business.id,
          shopId,
        ))!.products;
        const large = withVariant.find((p) => p.parentId === kettle.id);
        const parent = withVariant.find((p) => p.id === kettle.id);
        assert.ok(large && parent);
        assert.equal(parent.photoAlt, 'Copper kettle');
        assert.equal(large.sku, 'KETTLE-L');
        assert.equal(
          await agent.generatedStore.photo(shopId, kettle.id, otherBusiness.id),
          undefined,
        );
        const variantListing = await shopApp.inject({
          url: catalogPath,
          headers: { host },
        });
        assert.match(variantListing.body, /<h3>Large<\/h3>/u);
        assert.match(variantListing.body, new RegExp('cart:' + large.id, 'u'));
        assert.doesNotMatch(
          variantListing.body,
          new RegExp('cart:' + kettle.id, 'u'),
        );
        const imagePath = '/store/photos/' + kettle.id;
        const image = await shopApp.inject({
          url: imagePath,
          headers: { host },
        });
        assert.equal(image.statusCode, 200);
        assert.equal(image.headers['content-type'], 'image/png');
        assert.ok(image.rawPayload.equals(Buffer.from(png, 'base64')));
        assert.equal(
          (
            await shopApp.inject({
              url: imagePath,
              headers: { host: 'studio.example.test' },
            })
          ).statusCode,
          404,
        );

        const staleRoot = new URLSearchParams({
          id: randomUUID(),
          email: 'variant@example.test',
          [`cart:${parent.id}:${parent.revision}`]: '1',
        });
        assert.equal((await postCart(staleRoot)).statusCode, 409);
        const variantOrder = randomUUID();
        const buyVariant = new URLSearchParams({
          id: variantOrder,
          email: 'variant@example.test',
          [`cart:${large.id}:${large.revision}`]: '2',
        });
        assert.equal((await postCart(buyVariant)).statusCode, 200);
        assert.ok(
          await agent.generatedStore.changeOrder(
            business.id,
            shopId,
            variantOrder,
            'confirmed',
          ),
        );
        const variantDashboard = await agent.generatedStore.read(
          business.id,
          shopId,
        );
        assert.equal(
          variantDashboard?.orders.find((order) => order.id === variantOrder)
            ?.items[0]?.productName,
          'Copper <Kettle> · Large',
        );
        assert.equal(
          variantDashboard?.products.find((product) => product.id === large.id)
            ?.stock,
          1,
        );
        assert.equal(
          variantDashboard?.products.find((product) => product.id === parent.id)
            ?.stock,
          1,
        );
        assert.ok(
          await agent.generatedStore.changeOrder(
            business.id,
            shopId,
            variantOrder,
            'cancelled',
          ),
        );
        assert.ok(
          await agent.generatedStore.saveProduct(business.id, shopId, {
            ...parent,
            active: false,
          }),
        );
        const hidden = await shopApp.inject({
          url: catalogPath,
          headers: { host },
        });
        assert.doesNotMatch(hidden.body, /Copper &lt;Kettle&gt;/u);
        assert.equal(
          (await shopApp.inject({ url: imagePath, headers: { host } }))
            .statusCode,
          404,
        );

        const accountPath = '/store/account';
        const history = (cookie?: string, accountHost = host) =>
          shopApp.inject({
            url: accountPath,
            headers: { host: accountHost, ...(cookie ? { cookie } : {}) },
          });
        const postAccount = (
          path: string,
          values: Record<string, string>,
          cookie?: string,
        ) =>
          shopApp.inject({
            method: 'POST',
            url: accountPath + path,
            headers: {
              ...browser,
              'content-type': 'application/x-www-form-urlencoded',
              ...(cookie ? { cookie } : {}),
            },
            payload: new URLSearchParams(values).toString(),
          });
        assert.doesNotMatch((await history()).body, new RegExp(firstId, 'u'));
        assert.match((await history()).body, /Email me a code/u);
        const challengePage = await postAccount('/code', {
          email: 'Buyer@Example.test',
        });
        assert.equal(challengePage.statusCode, 200);
        assert.equal(delivery?.email, 'buyer@example.test');
        assert.equal(delivery?.host, host);
        assert.ok(delivery?.code);
        const challenge = /name="challenge" value="([a-f0-9-]+)"/u.exec(
          challengePage.body,
        )?.[1];
        assert.ok(challenge);
        assert.equal(
          (
            await postAccount('/verify', {
              challenge,
              code: delivery.code === '000000' ? '111111' : '000000',
            })
          ).statusCode,
          401,
        );
        const verified = await postAccount('/verify', {
          challenge,
          code: delivery.code,
        });
        assert.equal(verified.statusCode, 303);
        const header = String(verified.headers['set-cookie']);
        assert.match(
          header,
          /^__Host-bw-buyer=.*HttpOnly; SameSite=Lax; Max-Age=\d+; Secure/u,
        );
        const buyerCookie = header.split(';')[0]!;
        assert.equal(
          (await postAccount('/verify', { challenge, code: delivery.code }))
            .statusCode,
          401,
        );
        const customerPage = await history(buyerCookie);
        assert.equal(customerPage.headers['cache-control'], 'no-store');
        assert.match(customerPage.body, new RegExp(firstId, 'u'));
        assert.doesNotMatch(customerPage.body, new RegExp(variantOrder, 'u'));
        assert.match(customerPage.body, /Copper &lt;Kettle&gt;/u);

        const signup = await buyers.challenge(shopId, 'new-buyer@example.test');
        const wrongCode = signup.code === '111111' ? '222222' : '111111';
        for (let attempt = 0; attempt < 5; attempt++)
          assert.equal(await buyers.verify(shopId, signup.id, wrongCode), null);
        assert.equal(await buyers.verify(shopId, signup.id, signup.code), null);
        const fresh = await buyers.challenge(shopId, 'new-buyer@example.test');
        assert.ok(await buyers.verify(shopId, fresh.id, fresh.code));
        const merchants = await agent.generatedStore.read(business.id, shopId);
        const freshCustomer = merchants?.customers.find(
          (customer) => customer.email === 'new-buyer@example.test',
        );
        assert.ok(freshCustomer?.joinedAt);
        assert.equal(freshCustomer.orderCount, 0);
        assert.equal(freshCustomer.lastOrderAt, null);

        const sibling = await agent.saveArtifact({
          businessId: otherBusiness.id,
          kind: 'website',
          title: 'Sibling store',
          body: '<h1>Sibling store</h1>',
          state: 'approved',
        });
        await client`insert into generated_stores(site_id, first_revision, currency) values (${sibling.id}, 1, 'AUD')`;
        assert.ok(await agent.publish(otherBusiness.id, sibling.id, 1, true));
        const siblingPage = await history(
          buyerCookie,
          sibling.id + '.sites.example.test',
        );
        assert.match(siblingPage.body, /Email me a code/u);
        assert.doesNotMatch(siblingPage.body, new RegExp(firstId, 'u'));

        const filters = (await agent.generatedStore.read(
          business.id,
          shopId,
        ))!.products.find((value) => value.name === 'Filters');
        assert.ok(filters);
        const withSession = randomUUID();
        const sessionOrder = await shopApp.inject({
          method: 'POST',
          url: '/store/orders',
          headers: {
            ...browser,
            cookie: buyerCookie,
            'content-type': 'application/x-www-form-urlencoded',
          },
          payload: new URLSearchParams({
            id: withSession,
            email: 'spoof@example.test',
            [`cart:${filters.id}:${filters.revision}`]: '1',
          }).toString(),
        });
        assert.equal(sessionOrder.statusCode, 200);
        assert.equal(
          (await agent.generatedStore.read(business.id, shopId))?.orders.find(
            (value) => value.id === withSession,
          )?.email,
          'buyer@example.test',
        );
        assert.match(
          (await history(buyerCookie)).body,
          new RegExp(withSession, 'u'),
        );
        assert.equal(
          (await postAccount('/sign-out', {}, buyerCookie)).statusCode,
          303,
        );
        assert.doesNotMatch(
          (await history(buyerCookie)).body,
          new RegExp(withSession, 'u'),
        );

        const zone = {
          country: 'AU',
          shipping: 600,
          taxRate: 1000,
          freeAbove: 1500,
          taxShipping: true,
        };
        assert.equal(
          await agent.generatedStore.setDelivery(otherBusiness.id, shopId, 0, [
            zone,
          ]),
          false,
        );
        assert.ok(
          await agent.generatedStore.setDelivery(business.id, shopId, 0, [
            zone,
          ]),
        );
        assert.equal(
          await agent.generatedStore.setDelivery(business.id, shopId, 0, [
            zone,
          ]),
          false,
        );
        const catalogWithDelivery = await shopApp.inject({
          url: catalogPath,
          headers: { host },
        });
        assert.match(catalogWithDelivery.body, /Review order/u);
        assert.match(catalogWithDelivery.body, /Australia/u);

        const deliveryValues = {
          id: randomUUID(),
          email: 'buyer@example.test',
          [`cart:${filters.id}:${filters.revision}`]: '1',
          country: 'AU',
          name: 'Fixture <Buyer>',
          street: '123 Test Street',
          city: 'Perth',
          region: 'WA',
          postalCode: '6000',
          unit: '',
        };
        function sendDelivery(path: string, values: Record<string, string>) {
          return shopApp.inject({
            method: 'POST',
            url: path,
            headers: {
              ...browser,
              'content-type': 'application/x-www-form-urlencoded',
            },
            payload: new URLSearchParams(values).toString(),
          });
        }
        assert.equal(
          (await sendDelivery('/store/orders', deliveryValues)).statusCode,
          409,
        );
        assert.equal(
          (
            await sendDelivery('/store/review', {
              ...deliveryValues,
              country: 'NZ',
            })
          ).statusCode,
          409,
        );
        const before = await agent.generatedStore.read(business.id, shopId);
        const firstReview = await sendDelivery('/store/review', deliveryValues);
        assert.equal(firstReview.statusCode, 200);
        assert.match(firstReview.body, /Fixture &lt;Buyer&gt;/u);
        assert.match(firstReview.body, /14\.30/u);
        const expiredSettingsQuote = /name="quote" value="([a-f0-9-]+)"/u.exec(
          firstReview.body,
        )?.[1];
        assert.ok(expiredSettingsQuote);
        assert.equal(
          (await agent.generatedStore.read(business.id, shopId))?.orders.length,
          before?.orders.length,
        );

        assert.ok(
          await agent.generatedStore.setDelivery(business.id, shopId, 1, [
            { ...zone, shipping: 500 },
          ]),
        );
        assert.equal(
          (await sendDelivery('/store/orders', { quote: expiredSettingsQuote }))
            .statusCode,
          409,
        );
        const secondReview = await sendDelivery(
          '/store/review',
          deliveryValues,
        );
        assert.match(secondReview.body, /13\.20/u);
        const quote = /name="quote" value="([a-f0-9-]+)"/u.exec(
          secondReview.body,
        )?.[1];
        assert.ok(quote);
        const submit = await sendDelivery('/store/orders', {
          quote,
          shipping: '0',
          tax: '0',
        });
        assert.equal(submit.statusCode, 200);
        assert.equal(
          (await sendDelivery('/store/orders', { quote })).statusCode,
          200,
        );
        assert.ok(
          await agent.generatedStore.setDelivery(business.id, shopId, 2, [
            { ...zone, taxRate: 0 },
          ]),
        );
        const finalized = await agent.generatedStore.read(business.id, shopId);
        assert.equal(
          finalized?.orders.length,
          (before?.orders.length ?? 0) + 1,
        );
        const deliverySnapshot = finalized?.orders.find(
          (value) => value.id === quote,
        )?.delivery;
        assert.equal(deliverySnapshot?.shipping, 500);
        assert.equal(deliverySnapshot?.tax, 120);
        assert.equal(deliverySnapshot?.address.city, 'Perth');
        assert.ok(
          await agent.generatedStore.setDelivery(business.id, shopId, 3, [
            { ...zone, freeAbove: 700, taxRate: 1000, taxShipping: false },
          ]),
        );
        const free = await sendDelivery('/store/review', deliveryValues);
        assert.equal(free.statusCode, 200);
        assert.match(free.body, /7\.70/u);
        const freeQuote = /name="quote" value="([a-f0-9-]+)"/u.exec(
          free.body,
        )?.[1];
        assert.ok(freeQuote);
        assert.ok(
          await agent.generatedStore.saveProduct(business.id, shopId, {
            ...filters,
            price: 800,
          }),
        );
        assert.equal(
          (await sendDelivery('/store/orders', { quote: freeQuote }))
            .statusCode,
          409,
        );
        assert.doesNotMatch((await history()).body, /123 Test Street/u);
      } finally {
        await shopApp.close();
      }

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

      const inboxTask = await agent.saveArtifact(
        {
          businessId: business.id,
          kind: 'task',
          title: 'Prepare a receipt checklist',
          body: 'Draft a generic checklist for today.',
        },
        account.id,
        true,
      );
      assert.equal(
        (await agent.workItem(business.id, inboxTask.id))?.emailTriggered,
        true,
      );
      const arrived = (workspace: string, deliveryId: string) =>
        db
          .insert(inboundEmails)
          .values({
            businessId: workspace,
            providerId: deliveryId,
            sender: 'sender@example.test',
            subject: 'Untrusted subject',
            body: 'Untrusted instructions',
            receivedAt: new Date(0),
          })
          .onConflictDoNothing({
            target: [inboundEmails.providerId, inboundEmails.businessId],
          });
      await arrived(otherBusiness.id, randomUUID());
      assert.equal(await schedule.advance(clock()), null);
      const newEmailId = randomUUID();
      await arrived(business.id, newEmailId);
      await arrived(business.id, newEmailId);
      const results = await Promise.all([
        schedule.advance(clock()),
        taskAutomationStore(db).advance(clock()),
      ]);
      const turns = new Set(
        results.flatMap((result) => (result?.turnId ? [result.turnId] : [])),
      );
      assert.equal(turns.size, 1);
      const [inboxTurn] = turns;
      assert.ok(inboxTurn);
      assert.equal(
        (await taskAutomationStore(db).advance(clock()))?.turnId,
        inboxTurn,
      );
      const claimedInbox = await agent.claimTurn(inboxTurn);
      assert.ok(claimedInbox);
      assert.match(claimedInbox.row.prompt, /Draft a generic checklist/);
      assert.doesNotMatch(claimedInbox.row.prompt, /Untrusted/);
      assert.equal(await agent.claimTurn(inboxTurn), null);
      await agent.updateTurn(inboxTurn, {
        state: 'completed',
        answer: 'Done.',
      });
      assert.equal(await schedule.advance(clock()), null);
      assert.equal(
        await agent.controlTaskAutomation(
          business.id,
          inboxTask.id,
          account.id,
          false,
        ),
        true,
      );
      await arrived(business.id, randomUUID());
      assert.equal(await schedule.advance(clock()), null);
      assert.equal(
        await agent.controlTaskAutomation(
          business.id,
          inboxTask.id,
          account.id,
          true,
        ),
        true,
      );
      assert.equal(await schedule.advance(clock()), null);
      await arrived(business.id, randomUUID());
      const resumed = await schedule.advance(clock());
      assert.ok(resumed?.turnId && resumed.turnId !== inboxTurn);

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
