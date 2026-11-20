import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Database } from '../db/database';
import {
  challengeAttempts,
  challengeLifetimeSeconds,
  digest,
  randomCode,
  randomToken,
  sameToken,
  sessionLifetimeSeconds,
} from '../auth/tokens';
import { z } from 'zod';

const tokenInput = z.string().regex(/^[a-zA-Z0-9_-]{43}$/u);
const emailInput = z
  .email()
  .trim()
  .max(254)
  .transform((email) => email.toLowerCase());
const roleInput = z.enum(['user', 'admin']);

export function generatedAppUsers(db: Database, secret: string) {
  const codeDigest = (siteId: string, challenge: string, code: string) =>
    digest(
      secret,
      'generated-app-signin-code',
      siteId + '\0' + challenge + '\0' + code,
    );
  const sessionDigest = (siteId: string, token: string) =>
    digest(secret, 'generated-app-session', siteId + '\0' + token);
  const appEnabled = (siteId: string) => sql`exists (
    select 1 from website_publications where artifact_id = ${siteId}::uuid
      and unpublished_at is null and runtime_mode = 'app'
  )`;
  const discardChallenge = async (siteId: string, id: string) => {
    await db.execute(sql`delete from generated_app_signins
      where site_id = ${siteId}::uuid and id = ${id}::uuid`);
  };

  return {
    async challenge(siteId: string, inputEmail: string) {
      const email = emailInput.parse(inputEmail);
      const id = randomUUID();
      const code = randomCode();
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`delete from generated_app_signins where site_id = ${siteId}::uuid and expires_at <= now()`,
        );
        await tx.execute(
          sql`delete from generated_app_sessions where site_id = ${siteId}::uuid and expires_at <= now()`,
        );
        await tx.execute(sql`insert into generated_app_signins (site_id, id, email, code_digest, expires_at)
          select ${siteId}::uuid, ${id}::uuid, ${email}, ${codeDigest(siteId, id, code)},
            now() + ${challengeLifetimeSeconds} * interval '1 second'
          where ${appEnabled(siteId)}`);
      });
      return { id, code };
    },
    discardChallenge,
    async deliverInvitation(
      siteId: string,
      challengeId: string,
      deliver: () => Promise<void>,
    ) {
      try {
        await deliver();
      } catch (error) {
        await discardChallenge(siteId, challengeId);
        throw error;
      }
    },
    async verify(
      siteId: string,
      id: string,
      code: string,
      previousToken?: string,
    ) {
      return db.transaction(async (tx) => {
        const [challenge] = await tx.execute<{
          email: string;
          code_digest: string;
        }>(sql`select email, code_digest from generated_app_signins
          where site_id = ${siteId}::uuid and id = ${id}::uuid and expires_at > now()
            and attempts < ${challengeAttempts}
          for update`);
        if (!challenge) return null;
        if (!sameToken(challenge.code_digest, codeDigest(siteId, id, code))) {
          await tx.execute(sql`update generated_app_signins set attempts = attempts + 1
            where site_id = ${siteId}::uuid and id = ${id}::uuid`);
          return null;
        }
        await tx.execute(sql`delete from generated_app_signins
          where site_id = ${siteId}::uuid and id = ${id}::uuid`);
        const [invite] = await tx.execute<{ role: 'user' | 'admin' }>(sql`
          select role from generated_app_invites where site_id = ${siteId}::uuid
            and email = ${challenge.email} and expires_at > now() for update`);
        const [user] = await tx.execute<{ id: string }>(sql`
          insert into generated_app_users (site_id, email, role)
          select ${siteId}::uuid, ${challenge.email}, ${invite?.role ?? 'user'} where ${appEnabled(siteId)}
          on conflict (site_id, email) do update set
            role = case when ${Boolean(invite)} then excluded.role else generated_app_users.role end,
            updated_at = now()
          returning id`);
        if (!user) return null;
        await tx.execute(sql`delete from generated_app_invites
          where site_id = ${siteId}::uuid and email = ${challenge.email}`);
        if (previousToken && tokenInput.safeParse(previousToken).success)
          await tx.execute(sql`delete from generated_app_sessions
            where site_id = ${siteId}::uuid and token_digest = ${sessionDigest(siteId, previousToken)}`);
        const token = randomToken();
        await tx.execute(sql`insert into generated_app_sessions (site_id, email, token_digest, expires_at)
          values (${siteId}::uuid, ${challenge.email}, ${sessionDigest(siteId, token)},
            now() + ${sessionLifetimeSeconds} * interval '1 second')`);
        return token;
      });
    },
    async user(siteId: string, token: string | undefined) {
      if (!token || !tokenInput.safeParse(token).success) return null;
      const [user] = await db.execute<{
        id: string;
        email: string;
        role: 'user' | 'admin';
      }>(sql`select app_user.id, app_user.email, app_user.role
        from generated_app_sessions session
        join generated_app_users app_user
          on app_user.site_id = session.site_id and app_user.email = session.email
        where session.site_id = ${siteId}::uuid
          and session.token_digest = ${sessionDigest(siteId, token)}
          and session.expires_at > now()`);
      return user ?? null;
    },
    async byEmail(siteId: string, email: string) {
      const normalized = emailInput.safeParse(email);
      if (!normalized.success) return null;
      const [user] = await db.execute<{
        id: string;
        email: string;
        role: 'user' | 'admin';
      }>(sql`select id, email, role from generated_app_users
        where site_id = ${siteId}::uuid and email = ${normalized.data}`);
      return user ?? null;
    },
    async signOut(siteId: string, token: string | undefined) {
      if (token && tokenInput.safeParse(token).success)
        await db.execute(sql`delete from generated_app_sessions
          where site_id = ${siteId}::uuid and token_digest = ${sessionDigest(siteId, token)}`);
    },
    async list(
      businessId: string,
      siteId: string,
      cursor?: { createdAt: string; id: string },
      limit = 100,
      includeCursor = false,
    ) {
      return db.execute(sql`select id, email, role, created_at as "createdAt", updated_at as "updatedAt"
        ${includeCursor ? sql`, to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "cursorCreatedAt"` : sql.empty()}
        from generated_app_users where site_id = ${siteId}::uuid and exists (
          select 1 from workspace_artifacts site where site.id = ${siteId}::uuid
            and site.business_id = ${businessId}::uuid and site.kind = 'website'
        ) and (${cursor?.createdAt ?? null}::timestamptz is null or
          (created_at, id) < (${cursor?.createdAt ?? null}::timestamptz, ${cursor?.id ?? null}::uuid))
        order by created_at desc, id desc limit ${Math.min(Math.max(limit, 1), 101)}`);
    },
    async invitations(
      businessId: string,
      siteId: string,
      cursor?: { createdAt: string; id: string },
      limit = 100,
      includeCursor = false,
    ) {
      return db.execute(sql`select id, email, role, invited_by as "invitedBy",
          expires_at as "expiresAt", created_at as "createdAt"
          ${includeCursor ? sql`, to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "cursorCreatedAt"` : sql.empty()}
        from generated_app_invites invite where invite.site_id = ${siteId}::uuid
          and invite.expires_at > now() and exists (
            select 1 from workspace_artifacts site where site.id = invite.site_id
              and site.business_id = ${businessId}::uuid and site.kind = 'website'
          ) and (${cursor?.createdAt ?? null}::timestamptz is null or
            (created_at, id) < (${cursor?.createdAt ?? null}::timestamptz, ${cursor?.id ?? null}::uuid))
        order by created_at desc, id desc limit ${Math.min(Math.max(limit, 1), 101)}`);
    },
    async invite(
      businessId: string,
      siteId: string,
      inputEmail: string,
      inputRole: string,
      invitedBy: string,
    ) {
      const email = emailInput.parse(inputEmail);
      const role = roleInput.parse(inputRole);
      const [invite] = await db.execute<{
        id: string;
        email: string;
        role: 'user' | 'admin';
        expiresAt: Date;
      }>(sql`insert into generated_app_invites
        (site_id, email, role, invited_by, expires_at)
        select ${siteId}::uuid, ${email}, ${role}, ${invitedBy}, now() + interval '7 days'
        where exists (select 1 from workspace_artifacts site
          where site.id = ${siteId}::uuid and site.business_id = ${businessId}::uuid
            and site.kind = 'website' and (
              exists (select 1 from website_versions draft
                where draft.artifact_id = site.id and draft.revision = site.revision
                  and draft.runtime_mode = 'app')
              or exists (select 1 from website_publications publication
                join website_versions live on live.artifact_id = publication.artifact_id
                  and live.revision = publication.draft_revision and live.runtime_mode = 'app'
                where publication.artifact_id = site.id and publication.unpublished_at is null)
            ))
        on conflict (site_id, email) do update set role = excluded.role,
          invited_by = excluded.invited_by, expires_at = excluded.expires_at, created_at = now()
        returning id, email, role, expires_at as "expiresAt"`);
      return invite ?? null;
    },
    async setRole(
      businessId: string,
      siteId: string,
      userId: string,
      requestedRole: string,
    ) {
      const role = roleInput.parse(requestedRole);
      return db.transaction(async (tx) => {
        await tx.execute(sql`select id from generated_app_users
          where site_id = ${siteId}::uuid for update`);
        const [target] = await tx.execute<{ role: 'user' | 'admin' }>(sql`
          select app_user.role from generated_app_users app_user
          where app_user.site_id = ${siteId}::uuid and app_user.id = ${userId}::uuid
            and exists (select 1 from workspace_artifacts site where site.id = app_user.site_id
              and site.business_id = ${businessId}::uuid and site.kind = 'website')`);
        if (!target) return null;
        if (target.role === 'admin' && role === 'user') {
          const [count] = await tx.execute<{
            count: number;
          }>(sql`select count(*)::int as count
            from generated_app_users where site_id = ${siteId}::uuid and role = 'admin'`);
          if ((count?.count ?? 0) <= 1) return null;
        }
        const [user] = await tx.execute(sql`update generated_app_users app_user
          set role = ${role}, updated_at = now()
          where app_user.site_id = ${siteId}::uuid and app_user.id = ${userId}::uuid
          returning id, email, role, created_at as "createdAt", updated_at as "updatedAt"`);
        return user ?? null;
      });
    },
    async remove(businessId: string, siteId: string, userId: string) {
      return db.transaction(async (tx) => {
        await tx.execute(sql`select id from generated_app_users
          where site_id = ${siteId}::uuid for update`);
        const [target] = await tx.execute<{ role: 'user' | 'admin' }>(sql`
          select app_user.role from generated_app_users app_user
          join workspace_artifacts site on site.id = app_user.site_id
          where app_user.site_id = ${siteId}::uuid and app_user.id = ${userId}::uuid
            and site.business_id = ${businessId}::uuid and site.kind = 'website'`);
        if (!target) return false;
        if (target.role === 'admin') {
          const [count] = await tx.execute<{
            count: number;
          }>(sql`select count(*)::int as count
            from generated_app_users where site_id = ${siteId}::uuid and role = 'admin'`);
          if ((count?.count ?? 0) <= 1) return false;
        }
        const rows =
          await tx.execute(sql`delete from generated_app_users app_user
          where app_user.site_id = ${siteId}::uuid and app_user.id = ${userId}::uuid
          returning app_user.id`);
        return rows.length > 0;
      });
    },
  };
}

export function generatedAppUserDirectory(db: Database) {
  return {
    async byEmail(siteId: string, email: string) {
      const normalized = emailInput.safeParse(email);
      if (!normalized.success) return null;
      const [user] = await db.execute<{
        id: string;
        email: string;
        role: 'user' | 'admin';
      }>(sql`select id, email, role from generated_app_users
        where site_id = ${siteId}::uuid and email = ${normalized.data}`);
      return user ?? null;
    },
  };
}
