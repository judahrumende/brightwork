import { createHash, randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { z } from 'zod';
import { generatedAppFunctionBatchOperation } from './generated-app-records';

const capabilityClaims = z.object({
  businessId: z.uuid(),
  siteId: z.uuid(),
  revision: z.number().int().positive(),
  environment: z.enum(['live', 'preview']),
  user: z
    .object({
      id: z.string().min(1).max(256),
      email: z.email().max(254),
      role: z.enum(['user', 'admin']),
    })
    .nullable(),
});
const verifiedCapabilityClaims = capabilityClaims.extend({ jti: z.uuid() });

export type GeneratedAppFunctionCapability = z.infer<typeof capabilityClaims>;

const collection = z.string().regex(/^[a-z][a-z0-9_-]{0,62}$/u);
const recordCursor = z.object({ before: z.iso.datetime(), id: z.uuid() });
export const generatedAppFunctionOperation = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('list'),
    collection,
    limit: z.number().int().min(1).max(20).default(20),
  }),
  z.object({
    operation: z.literal('page'),
    collection,
    limit: z.number().int().min(1).max(20).default(20),
    cursor: recordCursor.optional(),
  }),
  z.object({
    operation: z.literal('create'),
    collection,
    data: z.record(z.string(), z.unknown()),
  }),
  z.object({
    operation: z.literal('update'),
    collection,
    recordId: z.uuid(),
    data: z.record(z.string(), z.unknown()),
  }),
  z.object({ operation: z.literal('delete'), collection, recordId: z.uuid() }),
  z.object({
    operation: z.literal('action'),
    collection,
    recordId: z.uuid(),
    action: z.string().regex(/^[a-z][a-z0-9_-]{0,62}$/u),
  }),
  z.object({
    operation: z.literal('batch'),
    operations: z.array(generatedAppFunctionBatchOperation).min(1).max(20),
  }),
]);

const keyFor = (secret: string) =>
  createHash('sha256').update(secret, 'utf8').digest();

export async function signGeneratedAppFunctionCapability(
  secret: string,
  claims: GeneratedAppFunctionCapability,
) {
  return new SignJWT(capabilityClaims.parse(claims))
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('foundable')
    .setAudience('foundable-app-function-capabilities')
    .setIssuedAt()
    .setJti(randomUUID())
    .setExpirationTime('60s')
    .sign(keyFor(secret));
}

export async function verifyGeneratedAppFunctionCapability(
  secret: string,
  token: string,
) {
  try {
    const { payload } = await jwtVerify(token, keyFor(secret), {
      issuer: 'foundable',
      audience: 'foundable-app-function-capabilities',
      algorithms: ['HS256'],
    });
    return verifiedCapabilityClaims.parse(payload);
  } catch {
    return null;
  }
}
