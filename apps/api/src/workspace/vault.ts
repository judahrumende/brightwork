import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import type { Database } from '../db/database';
import { workspaceCredentials } from '../db/schema';

export function vaultCipher(hexKey: string) {
  const key = Buffer.from(hexKey, 'hex');
  if (key.length !== 32) throw new Error('VAULT_KEY must encode 32 bytes');
  return {
    seal(value: string, context: Buffer) {
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      cipher.setAAD(context);
      const body = Buffer.concat([
        cipher.update(value, 'utf8'),
        cipher.final(),
      ]);
      return Buffer.concat([nonce, cipher.getAuthTag(), body]).toString(
        'base64',
      );
    },
    open(value: string, context: Buffer) {
      const sealed = Buffer.from(value, 'base64');
      if (sealed.length < 29) throw new Error('Invalid secret record');
      const decipher = createDecipheriv(
        'aes-256-gcm',
        key,
        sealed.subarray(0, 12),
      );
      decipher.setAAD(context);
      decipher.setAuthTag(sealed.subarray(12, 28));
      return Buffer.concat([
        decipher.update(sealed.subarray(28)),
        decipher.final(),
      ]).toString('utf8');
    },
  };
}

export function vaultStore(db: Database, hexKey: string) {
  const cipher = vaultCipher(hexKey);
  const rows = workspaceCredentials;
  const scope = (businessId: string, id: string) =>
    and(eq(rows.id, id), eq(rows.businessId, businessId));
  const associatedData = (businessId: string, name: string) =>
    Buffer.from(businessId + '\0' + name);
  return {
    list: (businessId: string) =>
      db
        .select({ id: rows.id, name: rows.name, updatedAt: rows.updatedAt })
        .from(rows)
        .where(eq(rows.businessId, businessId))
        .orderBy(asc(rows.name))
        .limit(100),
    async save(businessId: string, name: string, value: string) {
      const sealed = cipher.seal(value, associatedData(businessId, name));
      await db
        .insert(rows)
        .values({ businessId, name, sealed })
        .onConflictDoUpdate({
          target: [rows.businessId, rows.name],
          set: { sealed, updatedAt: new Date() },
        });
    },
    async reveal(businessId: string, id: string) {
      const [credential] = await db
        .select({ name: rows.name, sealed: rows.sealed })
        .from(rows)
        .where(scope(businessId, id));
      if (!credential) return null;
      return cipher.open(
        credential.sealed,
        associatedData(businessId, credential.name),
      );
    },
    async remove(businessId: string, id: string) {
      const [record] = await db
        .delete(rows)
        .where(scope(businessId, id))
        .returning({ id: rows.id });
      return Boolean(record);
    },
  };
}
