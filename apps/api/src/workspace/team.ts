import { and, asc, eq, gt, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/database';
import {
  accounts,
  businesses,
  members,
  workspaceInvitations,
} from '../db/schema';

export const teamRole = z.enum(['admin', 'member', 'viewer']);
type Role = z.infer<typeof teamRole>;

function canManage(actor: string, target: string | null, role: Role | null) {
  if (target === 'owner') return false;
  return (
    actor === 'owner' ||
    (actor === 'admin' && target !== 'admin' && role !== 'admin')
  );
}

export function teamStore(db: Database) {
  const invites = workspaceInvitations;
  return {
    async members(businessId: string) {
      return db
        .select({
          id: accounts.id,
          name: accounts.name,
          email: accounts.email,
          role: members.role,
        })
        .from(members)
        .innerJoin(accounts, eq(members.accountId, accounts.id))
        .where(eq(members.businessId, businessId))
        .orderBy(asc(accounts.email));
    },
    async invite(
      businessId: string,
      actorId: string,
      email: string,
      role: Role,
    ) {
      return db.transaction(async (tx) => {
        const [actor] = await tx
          .select({ role: members.role })
          .from(members)
          .where(
            and(
              eq(members.businessId, businessId),
              eq(members.accountId, actorId),
            ),
          )
          .for('share');
        if (!actor || !canManage(actor.role, null, role)) return null;
        const [existing] = await tx
          .select({ id: accounts.id })
          .from(accounts)
          .innerJoin(members, eq(members.accountId, accounts.id))
          .where(
            and(eq(accounts.email, email), eq(members.businessId, businessId)),
          );
        if (existing) return null;
        const expiresAt = new Date(Date.now() + 7 * 86_400_000);
        const [invite] = await tx
          .insert(invites)
          .values({ businessId, email, role, expiresAt })
          .onConflictDoUpdate({
            target: [invites.businessId, invites.email],
            set: { role, expiresAt, acceptedAt: null },
            ...(actor.role === 'admin'
              ? { setWhere: inArray(invites.role, ['member', 'viewer']) }
              : {}),
          })
          .returning({
            id: invites.id,
            email: invites.email,
            role: invites.role,
            expiresAt: invites.expiresAt,
          });
        return invite ?? null;
      });
    },
    async setRole(
      businessId: string,
      actorId: string,
      targetId: string,
      role: Role | null,
    ) {
      return db.transaction(async (tx) => {
        const squads = await tx
          .select({ id: members.accountId, role: members.role })
          .from(members)
          .where(
            and(
              eq(members.businessId, businessId),
              inArray(members.accountId, [actorId, targetId]),
            ),
          )
          .orderBy(asc(members.accountId))
          .for('update');
        const actor = squads.find((row) => row.id === actorId);
        const target = squads.find((row) => row.id === targetId);
        if (
          actorId === targetId ||
          !actor ||
          !target ||
          !canManage(actor.role, target.role, role)
        )
          return false;
        const scope = and(
          eq(members.businessId, businessId),
          eq(members.accountId, targetId),
        );
        if (role) await tx.update(members).set({ role }).where(scope);
        else await tx.delete(members).where(scope);
        return true;
      });
    },
    async inbox(email: string) {
      return db
        .select({
          id: invites.id,
          name: businesses.name,
          role: invites.role,
          expiresAt: invites.expiresAt,
        })
        .from(invites)
        .innerJoin(businesses, eq(invites.businessId, businesses.id))
        .where(
          and(
            eq(invites.email, email),
            isNull(invites.acceptedAt),
            gt(invites.expiresAt, new Date()),
          ),
        )
        .limit(50);
    },
    async pending(businessId: string) {
      return db
        .select({
          id: invites.id,
          email: invites.email,
          role: invites.role,
          expiresAt: invites.expiresAt,
        })
        .from(invites)
        .where(
          and(
            eq(invites.businessId, businessId),
            isNull(invites.acceptedAt),
            gt(invites.expiresAt, new Date()),
          ),
        )
        .limit(50);
    },
    async revoke(businessId: string, actorId: string, invitationId: string) {
      return db.transaction(async (tx) => {
        const [actor] = await tx
          .select({ role: members.role })
          .from(members)
          .where(
            and(
              eq(members.businessId, businessId),
              eq(members.accountId, actorId),
            ),
          )
          .for('share');
        if (actor?.role !== 'owner' && actor?.role !== 'admin') return false;
        const [removed] = await tx
          .delete(invites)
          .where(
            and(
              eq(invites.businessId, businessId),
              eq(invites.id, invitationId),
              isNull(invites.acceptedAt),
              actor.role === 'admin'
                ? inArray(invites.role, ['member', 'viewer'])
                : undefined,
            ),
          )
          .returning({ id: invites.id });
        return Boolean(removed);
      });
    },
    async accept(inviteId: string, accountId: string, email: string) {
      return db.transaction(async (tx) => {
        const now = new Date();
        const [invite] = await tx
          .update(invites)
          .set({ acceptedAt: now })
          .where(
            and(
              eq(invites.id, inviteId),
              eq(invites.email, email),
              isNull(invites.acceptedAt),
              gt(invites.expiresAt, now),
            ),
          )
          .returning({ businessId: invites.businessId, role: invites.role });
        if (!invite) return null;
        await tx
          .insert(members)
          .values({ ...invite, accountId, openedAt: now })
          .onConflictDoNothing();
        return invite.businessId;
      });
    },
  };
}
