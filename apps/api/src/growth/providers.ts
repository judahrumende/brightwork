import { z } from 'zod';

const metaId = z.string().regex(/^\d+$/u);
const metaObjectId = z.string().regex(/^\d{1,40}(?:_\d{1,40})?$/u);
const status = z.enum(['ACTIVE', 'PAUSED']);
const campaign = z.object({
  id: metaId,
  name: z.string(),
  status: z.string(),
  effective_status: z.string(),
});
export const money = z.string().regex(/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/u);
const listing = z.object({
  title: z.string(),
  profile: z.object({ description: z.string().optional() }).optional(),
});

async function providerJson(
  url: string,
  token: string,
  init: RequestInit,
  request: typeof fetch,
) {
  const response = await request(url, {
    ...init,
    redirect: 'error',
    signal: AbortSignal.timeout(12_000),
    headers: {
      Authorization: `Bearer ${token}`,
      ...(typeof init.body === 'string'
        ? { 'Content-Type': 'application/json' }
        : {}),
    },
  });
  if (!response.ok)
    throw new Error('The connected provider could not complete this request.');
  return response.json() as Promise<unknown>;
}

export function metaPage(id: string, token: string, request = fetch) {
  const page = metaId.parse(id);
  return {
    id: page,
    async verify() {
      const profile = z
        .object({ id: metaId, name: z.string().min(1).max(500) })
        .parse(
          await providerJson(
            'https://graph.facebook.com/v27.0/me?fields=id,name',
            token,
            {},
            request,
          ),
        );
      return profile.id === page ? profile : null;
    },
    async subscribeToFeed() {
      const response = await providerJson(
        `https://graph.facebook.com/v27.0/${page}/subscribed_apps`,
        token,
        {
          method: 'POST',
          body: new URLSearchParams({ subscribed_fields: 'feed' }),
        },
        request,
      );
      return z.object({ success: z.literal(true) }).parse(response).success;
    },
    async reply(comment: string, message: string) {
      const id = metaObjectId.parse(comment);
      return z
        .object({ id: metaObjectId })
        .parse(
          await providerJson(
            `https://graph.facebook.com/v27.0/${id}/comments`,
            token,
            { method: 'POST', body: new URLSearchParams({ message }) },
            request,
          ),
        ).id;
    },
    async publish(message: string) {
      return z
        .object({ id: z.string().regex(/^\d+(?:_\d+)?$/u) })
        .parse(
          await providerJson(
            `https://graph.facebook.com/v27.0/${page}/feed`,
            token,
            { method: 'POST', body: new URLSearchParams({ message }) },
            request,
          ),
        ).id;
    },
  };
}

export function metaAds(id: string, token: string, request = fetch) {
  const account = metaId.parse(id);
  const root = 'https://graph.facebook.com/v27.0/';
  return {
    id: account,
    async read(after?: string) {
      const query = new URLSearchParams({
        fields: 'id,name,status,effective_status',
        limit: '25',
        ...(after ? { after } : {}),
      });
      const [raw, billing, insights] = await Promise.all([
        providerJson(
          `${root}act_${account}/campaigns?${query}`,
          token,
          {},
          request,
        ),
        providerJson(
          `${root}act_${account}?fields=currency`,
          token,
          {},
          request,
        ),
        providerJson(
          `${root}act_${account}/insights?fields=spend&date_preset=this_month`,
          token,
          {},
          request,
        ),
      ]);
      const { data, paging } = z
        .object({
          data: z.array(campaign),
          paging: z
            .object({
              next: z.string().optional(),
              cursors: z.object({ after: z.string().optional() }).optional(),
            })
            .optional(),
        })
        .parse(raw);
      const { currency } = z
        .object({ currency: z.string().regex(/^[A-Z]{3}$/u) })
        .parse(billing);
      const spend =
        z.object({ data: z.array(z.object({ spend: money })) }).parse(insights)
          .data[0]?.spend ?? '0';
      return {
        campaigns: data,
        after: paging?.next ? (paging.cursors?.after ?? null) : null,
        currency,
        spend,
      };
    },
    async pause(campaignId: string) {
      const id = metaId.parse(campaignId);
      const current = z
        .object({ account_id: metaId, status: z.string() })
        .parse(
          await providerJson(
            `${root}${id}?fields=account_id,status`,
            token,
            {},
            request,
          ),
        );
      if (
        current.account_id !== account ||
        !status.safeParse(current.status).success
      )
        return false;
      z.object({ success: z.literal(true) }).parse(
        await providerJson(
          `${root}${id}`,
          token,
          {
            method: 'POST',
            body: new URLSearchParams({ status: 'PAUSED' }),
          },
          request,
        ),
      );
      return true;
    },
  };
}

export function googleListing(id: string, token: string, request = fetch) {
  const url = `https://mybusinessbusinessinformation.googleapis.com/v1/locations/${metaId.parse(id)}`;
  return {
    id,
    async read() {
      return listing.parse(
        await providerJson(`${url}?readMask=title,profile`, token, {}, request),
      );
    },
    async update(description: string) {
      return listing.parse(
        await providerJson(
          `${url}?updateMask=profile.description`,
          token,
          {
            method: 'PATCH',
            body: JSON.stringify({ profile: { description } }),
          },
          request,
        ),
      );
    },
  };
}
