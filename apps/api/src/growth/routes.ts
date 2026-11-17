import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, desc, eq, like } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthEnv } from '../auth/config';
import type { Database } from '../db/database';
import { adWalletBudgets, artifacts, socialPublications } from '../db/schema';
import { pageReader, publicPageUrl } from '../research/page';
import {
  searchTerms,
  searxngEndpoint,
  searxngSearch,
} from '../research/searxng';
import type { agentStore } from '../workspace/agent-store';
import { googleListing, metaAds, metaPage, money } from './providers';

const root = '/api/companies/:id/growth';
const uuid = z.uuid();
const urlInput = z.string().trim().max(2048);
class GrowthError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function registerGrowth(
  app: FastifyInstance,
  options: {
    env: AuthEnv;
    db: Database;
    store: ReturnType<typeof agentStore>;
    identify: (request: FastifyRequest) => Promise<string>;
    requireOrigin: (request: FastifyRequest) => unknown;
    reportError: (error: unknown, reply: FastifyReply) => unknown;
    limit: (
      kind: string,
      account: string,
      max: number,
      seconds: number,
    ) => Promise<void>;
  },
) {
  const { env, db, store } = options;
  const publicUrl = publicPageUrl(env.APP_ORIGIN, env.SITE_BASE_DOMAIN);
  const readPage = pageReader(publicUrl);
  const search =
    env.SEARXNG_BASE_URL &&
    searxngSearch(searxngEndpoint(env.SEARXNG_BASE_URL));
  const page =
    env.GROWTH_META_PAGE_ID && env.GROWTH_META_PAGE_TOKEN
      ? metaPage(env.GROWTH_META_PAGE_ID, env.GROWTH_META_PAGE_TOKEN)
      : null;
  const ads =
    env.GROWTH_META_AD_ACCOUNT_ID && env.GROWTH_META_AD_TOKEN
      ? metaAds(env.GROWTH_META_AD_ACCOUNT_ID, env.GROWTH_META_AD_TOKEN)
      : null;
  const google =
    env.GROWTH_GOOGLE_LOCATION_ID && env.GROWTH_GOOGLE_ACCESS_TOKEN
      ? googleListing(
          env.GROWTH_GOOGLE_LOCATION_ID,
          env.GROWTH_GOOGLE_ACCESS_TOKEN,
        )
      : null;
  type Access = { id: string; actor: string; role: string; connected: boolean };
  function route(
    method: 'GET' | 'POST',
    path: string,
    permission: 'read' | 'write' | 'admin',
    handle: (request: FastifyRequest, access: Access) => Promise<unknown>,
  ) {
    app.route({
      method,
      url: root + path,
      bodyLimit: 24_000,
      async handler(request, reply) {
        reply.header('Cache-Control', 'no-store');
        try {
          if (method === 'POST') options.requireOrigin(request);
          const actor = await options.identify(request);
          const { id } = z.object({ id: uuid }).parse(request.params);
          const member = await store.membership(actor, id);
          if (!member) throw new GrowthError(404, 'Business not found.');
          const admin = member.role === 'owner' || member.role === 'admin';
          if (
            (permission === 'write' && member.role === 'viewer') ||
            (permission === 'admin' && !admin)
          )
            throw new GrowthError(
              403,
              'You do not have access to this action.',
            );
          return await handle(request, {
            id,
            actor,
            role: member.role,
            connected: id === env.GROWTH_WORKSPACE_ID,
          });
        } catch (error) {
          if (error instanceof GrowthError)
            return reply.code(error.status).send({ message: error.message });
          return options.reportError(error, reply);
        }
      },
    });
  }
  function requireProvider<T>(access: Access, provider: T | null): T {
    if (access.connected && provider) return provider;
    throw new GrowthError(
      503,
      'Connect this provider for the workspace first.',
    );
  }
  async function remote<T>(action: () => Promise<T>) {
    try {
      return await action();
    } catch {
      throw new GrowthError(
        502,
        'The connected provider did not confirm the request. Refresh before trying again.',
      );
    }
  }
  function checkedUrl(input: string) {
    const url = publicUrl(input);
    if (!url)
      throw new GrowthError(400, 'Enter a public HTTP or HTTPS website URL.');
    return url;
  }

  route('GET', '', 'read', async (_request, access) => ({
    browse: true,
    leads: Boolean(search),
    social: access.connected && Boolean(page),
    pageId: access.connected ? (page?.id ?? null) : null,
    ads: access.connected && Boolean(ads),
    google: access.connected && Boolean(google),
  }));
  route('POST', '/browse', 'write', async (request, { actor }) => {
    const { url } = z.strictObject({ url: urlInput }).parse(request.body);
    const target = checkedUrl(url);
    await options.limit('growth-browse', actor, 20, 60);
    const result = await readPage(
      target,
      new Set(),
      AbortSignal.timeout(6_000),
    );
    if (!result)
      throw new GrowthError(
        422,
        'This page could not be read. Open it directly or try another URL.',
      );
    return {
      url: result.url,
      title: result.title,
      paragraphs: result.paragraphs,
    };
  });
  route('POST', '/sources', 'write', async (request, { actor }) => {
    const { query } = z
      .strictObject({ query: z.string().trim().min(3).max(500) })
      .parse(request.body);
    if (!search)
      throw new GrowthError(503, 'Configure SearXNG to find source links.');
    await options.limit('growth-leads', actor, 8, 60);
    const urls = await remote(() =>
      search(query, AbortSignal.timeout(5_000), publicUrl),
    );
    const signal = AbortSignal.timeout(6_000);
    const terms = searchTerms(query);
    const hits = await Promise.all(
      urls.slice(0, 5).map(async (url) => {
        const page = await readPage(url, terms, signal);
        return {
          url: page?.url ?? url.href,
          title: page?.title ?? url.hostname,
          excerpt:
            page?.paragraphs.find((line) => line.length >= 60)?.slice(0, 280) ??
            null,
        };
      }),
    );
    return { hits: [...new Map(hits.map((hit) => [hit.url, hit])).values()] };
  });
  route('GET', '/leads', 'read', async (_request, { id }) => ({
    leads: await db
      .select({
        id: artifacts.id,
        title: artifacts.title,
        body: artifacts.body,
      })
      .from(artifacts)
      .where(
        and(
          eq(artifacts.businessId, id),
          eq(artifacts.kind, 'document'),
          like(artifacts.title, 'Lead: %'),
        ),
      )
      .orderBy(desc(artifacts.createdAt))
      .limit(100),
  }));
  route('POST', '/leads', 'write', async (request, { id, actor }) => {
    const { url, title } = z
      .strictObject({ url: urlInput, title: z.string().trim().min(1).max(150) })
      .parse(request.body);
    await options.limit('growth-lead-save', actor, 20, 60);
    return {
      lead: await store.saveArtifact({
        businessId: id,
        kind: 'document',
        title: `Lead: ${title}`,
        body: checkedUrl(url).href,
      }),
    };
  });
  route('GET', '/posts', 'read', async (_request, { id }) => ({
    posts: await db
      .select({
        id: artifacts.id,
        title: artifacts.title,
        body: artifacts.body,
        state: artifacts.state,
        revision: artifacts.revision,
        publication: socialPublications.state,
        pageId: socialPublications.pageId,
        remoteId: socialPublications.remoteId,
      })
      .from(artifacts)
      .leftJoin(
        socialPublications,
        eq(artifacts.id, socialPublications.artifactId),
      )
      .where(and(eq(artifacts.businessId, id), eq(artifacts.kind, 'post')))
      .orderBy(desc(artifacts.createdAt))
      .limit(100),
  }));
  route('POST', '/posts', 'write', async (request, { id, actor }) => {
    const { title, body } = z
      .strictObject({
        title: z.string().trim().min(1).max(160),
        body: z.string().trim().min(1).max(4_000),
      })
      .parse(request.body);
    await options.limit('growth-post-draft', actor, 20, 60);
    return {
      post: await store.saveArtifact({
        businessId: id,
        kind: 'post',
        title,
        body,
        state: 'pending',
      }),
    };
  });
  route('POST', '/posts/:post/publish', 'admin', async (request, access) => {
    const provider = requireProvider(access, page);
    const { post } = z.object({ post: uuid }).parse(request.params);
    const { revision, pageId } = z
      .strictObject({ revision: z.int().positive(), pageId: z.string() })
      .parse(request.body);
    if (pageId !== provider.id)
      throw new GrowthError(
        409,
        'The connected Page changed. Refresh and review the destination.',
      );
    await options.limit('growth-post-publish', access.actor, 8, 60);
    const body = await db.transaction(async (tx) => {
      const [draft] = await tx
        .select()
        .from(artifacts)
        .where(
          and(
            eq(artifacts.id, post),
            eq(artifacts.businessId, access.id),
            eq(artifacts.kind, 'post'),
          ),
        )
        .for('update');
      if (!draft || draft.revision !== revision || draft.state !== 'approved')
        throw new GrowthError(
          409,
          'Review and approve the current draft before publishing.',
        );
      const [claim] = await tx
        .insert(socialPublications)
        .values({
          artifactId: draft.id,
          revision,
          pageId,
          actorId: access.actor,
          state: 'publishing',
        })
        .onConflictDoNothing()
        .returning();
      if (!claim)
        throw new GrowthError(
          409,
          'This draft already has a publish attempt. Check the connected Page before taking further action.',
        );
      return draft.body;
    });
    try {
      const remoteId = await provider.publish(body);
      await db
        .update(socialPublications)
        .set({ state: 'published', remoteId })
        .where(eq(socialPublications.artifactId, post));
      return { remoteId };
    } catch {
      await db
        .update(socialPublications)
        .set({ state: 'unknown' })
        .where(eq(socialPublications.artifactId, post));
      throw new GrowthError(
        502,
        'The Page did not confirm publication. Check Facebook before posting again.',
      );
    }
  });
  route('GET', '/listing', 'admin', async (_request, access) => {
    const provider = requireProvider(access, google);
    await options.limit('growth-google-read', access.actor, 20, 60);
    return {
      ...(await remote(() => provider.read())),
      locationId: provider.id,
    };
  });
  route('POST', '/listing', 'admin', async (request, access) => {
    const provider = requireProvider(access, google);
    const { description, locationId } = z
      .strictObject({
        description: z.string().trim().max(750),
        locationId: z.string(),
      })
      .parse(request.body);
    if (provider.id !== locationId)
      throw new GrowthError(
        409,
        'The connected Google location changed. Refresh and review the destination.',
      );
    await options.limit('growth-google', access.actor, 8, 60);
    return {
      ...(await remote(() => provider.update(description))),
      locationId: provider.id,
    };
  });
  route('GET', '/ads', 'admin', async (request, access) => {
    const provider = requireProvider(access, ads);
    const { after } = z
      .object({ after: z.string().max(300).optional() })
      .parse(request.query);
    await options.limit('growth-ads-read', access.actor, 20, 60);
    const result = await remote(() => provider.read(after));
    const [budget] = await db
      .select()
      .from(adWalletBudgets)
      .where(
        and(
          eq(adWalletBudgets.businessId, access.id),
          eq(adWalletBudgets.accountId, provider.id),
          eq(adWalletBudgets.currency, result.currency),
        ),
      );
    return {
      ...result,
      accountId: provider.id,
      monthlyTarget: budget?.monthlyTarget ?? null,
    };
  });
  route('POST', '/ads/:campaign/status', 'admin', async (request, access) => {
    const provider = requireProvider(access, ads);
    const { campaign } = z
      .object({ campaign: z.string().regex(/^\d+$/u) })
      .parse(request.params);
    const { status, accountId } = z
      .strictObject({
        status: z.enum(['ACTIVE', 'PAUSED']),
        accountId: z.string(),
      })
      .parse(request.body);
    if (accountId !== provider.id)
      throw new GrowthError(
        409,
        'The connected ad account changed. Refresh before continuing.',
      );
    if (status === 'ACTIVE')
      throw new GrowthError(
        409,
        'Campaign activation is disabled until budget enforcement is verified.',
      );
    await options.limit('growth-ads-write', access.actor, 10, 60);
    if (!(await remote(() => provider.pause(campaign))))
      throw new GrowthError(
        404,
        'Editable campaign not found in the connected account.',
      );
    return { status };
  });
  route('POST', '/wallet', 'admin', async (request, access) => {
    const provider = requireProvider(access, ads);
    const { monthlyTarget, currency, accountId } = z
      .strictObject({
        monthlyTarget: money,
        currency: z.string().regex(/^[A-Z]{3}$/u),
        accountId: z.string(),
      })
      .parse(request.body);
    if (provider.id !== accountId)
      throw new GrowthError(
        409,
        'The connected account changed. Refresh before continuing.',
      );
    await options.limit('growth-wallet', access.actor, 10, 60);
    const values = {
      businessId: access.id,
      accountId,
      currency,
      monthlyTarget,
    };
    await db
      .insert(adWalletBudgets)
      .values(values)
      .onConflictDoUpdate({
        target: [
          adWalletBudgets.businessId,
          adWalletBudgets.accountId,
          adWalletBudgets.currency,
        ],
        set: { monthlyTarget },
      });
    return { monthlyTarget };
  });
}
