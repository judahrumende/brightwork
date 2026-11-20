import { sql } from 'drizzle-orm';
import type { Database } from '../db/database';
import { z } from 'zod';

const recordData = z
  .record(z.string(), z.unknown())
  .refine(
    (value) => Buffer.byteLength(JSON.stringify(value), 'utf8') <= 16_384,
    'Record data exceeds 16 KiB.',
  );
export const generatedAppFunctionBatchOperation = z.discriminatedUnion(
  'operation',
  [
    z.object({
      operation: z.literal('create'),
      collection: z.string(),
      data: recordData,
    }),
    z.object({
      operation: z.literal('update'),
      collection: z.string(),
      recordId: z.uuid(),
      data: recordData,
    }),
    z.object({
      operation: z.literal('delete'),
      collection: z.string(),
      recordId: z.uuid(),
    }),
  ],
);
const maxRecordsPerNamespace = 10_000;
type RecordExecutor = Pick<Database, 'execute'>;

export class GeneratedAppRecordQuotaExceeded extends Error {
  constructor() {
    super(
      'This app has reached its 10,000-record limit. Remove a record before creating another.',
    );
    this.name = 'GeneratedAppRecordQuotaExceeded';
  }
}

export class GeneratedAppSchemaMigrationError extends Error {
  constructor(
    message = 'This collection change conflicts with existing app data. Add compatible defaults or correct the affected records first.',
  ) {
    super(message);
    this.name = 'GeneratedAppSchemaMigrationError';
  }
}

export class GeneratedAppUniqueFieldError extends Error {
  constructor(field: string) {
    super(`The value for ${field} is already in use.`);
    this.name = 'GeneratedAppUniqueFieldError';
  }
}

class GeneratedAppBatchRejected extends Error {}

async function withRecordQuota<T>(
  tx: RecordExecutor,
  siteId: string,
  environment: 'live' | 'preview',
  dataRevision: number,
  id: string | undefined,
  write: () => Promise<T | null>,
) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(
    'foundable-app-records:' || ${siteId}::text || ':' || ${environment} || ':' || ${dataRevision}, 0))`);
  const [quota] = await tx.execute<{ count: number }>(sql`
    select count(*)::int as count from generated_app_records
    where site_id = ${siteId}::uuid and environment = ${environment}
      and data_revision = ${dataRevision}`);
  const [existing] = id
    ? await tx.execute(sql`select id from generated_app_records
        where site_id = ${siteId}::uuid and environment = ${environment}
          and data_revision = ${dataRevision} and id = ${id}::uuid`)
    : [];
  if (
    !existing &&
    (quota?.count ?? maxRecordsPerNamespace) >= maxRecordsPerNamespace
  )
    throw new GeneratedAppRecordQuotaExceeded();
  return write();
}

async function assertUniqueValues(
  tx: RecordExecutor,
  siteId: string,
  environment: 'live' | 'preview',
  dataRevision: number,
  collection: string,
  fields: AppCollectionField[],
  data: Record<string, unknown>,
  excludeId?: string,
) {
  for (const field of fields) {
    const value = data[field.name];
    if (!field.unique || value === undefined) continue;
    const [duplicate] =
      await tx.execute(sql`select id from generated_app_records
      where site_id = ${siteId}::uuid and environment = ${environment}
        and data_revision = ${dataRevision} and collection = ${collection}
        and (${excludeId ?? null}::uuid is null or id <> ${excludeId ?? null}::uuid)
        and data -> ${field.name} = ${JSON.stringify(value)}::jsonb limit 1`);
    if (duplicate) throw new GeneratedAppUniqueFieldError(field.name);
  }
}

const collectionName = (value?: string) =>
  z
    .string()
    .regex(/^[a-z][a-z0-9_-]{0,62}$/u, 'Invalid app collection name.')
    .parse(value ?? 'records');
const accessLevel = z.enum(['public', 'authenticated', 'admin']);
export const generatedAppRecordsPageQuery = z
  .object({
    collection: z.string().optional(),
    before: z.iso.datetime({ offset: true }).optional(),
    id: z.uuid().optional(),
  })
  .refine(({ before, id }) => Boolean(before) === Boolean(id));
const workflowAction = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_-]{0,62}$/u),
  label: z.string().min(1).max(60),
  field: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u),
  value: z.union([z.string(), z.number().finite(), z.boolean()]),
});
const fieldDefinition = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u),
    type: z.enum(['text', 'number', 'boolean', 'date']),
    required: z.boolean(),
    unique: z.boolean().optional(),
    defaultValue: z
      .union([z.string(), z.number().finite(), z.boolean()])
      .optional(),
  })
  .superRefine((field, context) => {
    if (field.defaultValue === undefined) return;
    const valid =
      field.type === 'text'
        ? typeof field.defaultValue === 'string'
        : field.type === 'number'
          ? typeof field.defaultValue === 'number'
          : field.type === 'boolean'
            ? typeof field.defaultValue === 'boolean'
            : typeof field.defaultValue === 'string' &&
              !Number.isNaN(Date.parse(field.defaultValue));
    if (!valid)
      context.addIssue({
        code: 'custom',
        path: ['defaultValue'],
        message: 'Default must match the field type.',
      });
  });
const fieldDefinitions = z
  .array(fieldDefinition)
  .max(32)
  .refine(
    (fields) => new Set(fields.map(({ name }) => name)).size === fields.length,
    'Field names must be unique.',
  );
export const appCollectionDefinition = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9_-]{0,62}$/u),
    readAccess: accessLevel.default('authenticated'),
    writeAccess: accessLevel.default('authenticated'),
    ownerScoped: z.boolean().default(true),
    fields: fieldDefinitions,
    actions: z
      .array(workflowAction)
      .max(20)
      .superRefine((actions, ctx) => {
        if (
          new Set(actions.map((action) => action.name)).size !== actions.length
        )
          ctx.addIssue({
            code: 'custom',
            message: 'Action names must be unique.',
          });
      })
      .default([]),
  })
  .superRefine((collection, ctx) => {
    if (
      collection.ownerScoped &&
      (collection.readAccess === 'public' ||
        collection.writeAccess === 'public')
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Owner-scoped collections require authenticated access.',
      });
    if (
      new Set(collection.actions.map(({ name }) => name)).size !==
      collection.actions.length
    )
      ctx.addIssue({
        code: 'custom',
        path: ['actions'],
        message: 'Action names must be unique.',
      });
    for (const action of collection.actions) {
      const field = collection.fields.find(({ name }) => name === action.field);
      const valid =
        field &&
        ((field.type === 'text' && typeof action.value === 'string') ||
          (field.type === 'date' &&
            typeof action.value === 'string' &&
            !Number.isNaN(Date.parse(action.value))) ||
          (field.type === 'number' && typeof action.value === 'number') ||
          (field.type === 'boolean' && typeof action.value === 'boolean'));
      if (!valid)
        ctx.addIssue({
          code: 'custom',
          path: ['actions'],
          message: 'Actions must target a defined field with a matching value.',
        });
    }
  });
export const appCollectionDefinitions = z
  .array(appCollectionDefinition)
  .max(12)
  .refine(
    (collections) =>
      new Set(collections.map(({ name }) => name)).size === collections.length,
    'Collection names must be unique.',
  );
const collectionPolicyInput = z.object({
  readAccess: accessLevel,
  writeAccess: accessLevel,
  ownerScoped: z.boolean(),
  fields: fieldDefinitions.optional(),
  actions: z.array(workflowAction).max(20).optional(),
});
const collectionDataMigrations = z
  .array(
    z.discriminatedUnion('operation', [
      z.object({
        operation: z.literal('renameField'),
        from: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u),
        to: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u),
      }),
      z.object({
        operation: z.literal('copyField'),
        from: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u),
        to: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u),
      }),
      z.object({
        operation: z.literal('removeField'),
        field: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u),
      }),
      z.object({
        operation: z.literal('setField'),
        field: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u),
        value: z.union([z.string(), z.number().finite(), z.boolean()]),
      }),
    ]),
  )
  .max(20);
export type AppUser = { id: string; email: string; role: 'user' | 'admin' };
type AppCollectionField = z.infer<typeof fieldDefinition>;
type Policy = Omit<
  z.infer<typeof collectionPolicyInput>,
  'fields' | 'actions'
> & {
  fields: AppCollectionField[];
  actions: z.infer<typeof workflowAction>[];
};
type PreparedBatchOperation =
  | {
      operation: 'create';
      collection: string;
      data: Record<string, unknown>;
      current: Policy;
    }
  | {
      operation: 'update';
      collection: string;
      recordId: string;
      data: Record<string, unknown>;
      current: Policy;
    }
  | {
      operation: 'delete';
      collection: string;
      recordId: string;
      current: Policy;
    };
export type AppCollectionDefinition = z.infer<typeof appCollectionDefinition>;
export type AppRuntimeScope = {
  businessId: string;
  revision: number;
  environment?: 'live' | 'preview';
};

export async function prepareGeneratedAppRecordsForRevision(
  tx: Pick<Database, 'execute'>,
  siteId: string,
  revision: number,
) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(
    'foundable-app-records:' || ${siteId}::text || ':live:0', 0))`);
  const collections = await tx.execute<{ name: string; fields: unknown }>(sql`
    select name, fields from generated_app_collections
    where site_id = ${siteId}::uuid and revision = ${revision}`);
  const migrations: { id: string; data: Record<string, unknown> }[] = [];
  for (const collection of collections) {
    const fields = fieldDefinitions.parse(collection.fields);
    if (!fields.length) continue;
    const records = await tx.execute<{
      id: string;
      data: Record<string, unknown>;
    }>(sql`select id, data from generated_app_records
      where site_id = ${siteId}::uuid and environment = 'live' and data_revision = 0
        and collection = ${collection.name}
      for update`);
    const uniqueValues = new Map<string, Set<string>>();
    for (const record of records) {
      const data = { ...record.data };
      for (const field of fields) {
        const value = data[field.name];
        if (value === undefined && field.defaultValue !== undefined) {
          data[field.name] = field.defaultValue;
          continue;
        }
        if (value === undefined) {
          if (field.required) return false;
          continue;
        }
        const valid =
          field.type === 'text'
            ? typeof value === 'string' && (!field.required || value.length > 0)
            : field.type === 'number'
              ? typeof value === 'number' && Number.isFinite(value)
              : field.type === 'boolean'
                ? typeof value === 'boolean'
                : typeof value === 'string' && !Number.isNaN(Date.parse(value));
        if (!valid) return false;
      }
      for (const field of fields.filter(({ unique }) => unique)) {
        const value = data[field.name];
        if (value === undefined) continue;
        const key = JSON.stringify(value);
        const values = uniqueValues.get(field.name) ?? new Set<string>();
        if (values.has(key)) return false;
        values.add(key);
        uniqueValues.set(field.name, values);
      }
      if (Buffer.byteLength(JSON.stringify(data), 'utf8') > 16_384)
        return false;
      if (JSON.stringify(data) !== JSON.stringify(record.data))
        migrations.push({ id: record.id, data });
    }
  }
  for (const migration of migrations)
    await tx.execute(sql`with changed as (
      update generated_app_records set data = ${JSON.stringify(migration.data)}::jsonb,
        updated_at = now() where site_id = ${siteId}::uuid and environment = 'live'
          and data_revision = 0 and id = ${migration.id}::uuid
      returning id
    ) insert into generated_app_activity
      (site_id, environment, data_revision, actor_id, action, target_id)
      select ${siteId}::uuid, 'live', 0, 'system', 'record.schema_migrated', id::text from changed`);
  return true;
}
type RuntimeContext = {
  environment: 'live' | 'preview';
  dataRevision: number;
  schemaRevision: number;
};

export function generatedAppRecords(
  db: Database,
  storageCreditsPerMib = '0.0000000000',
) {
  const scope = (businessId: string) => sql`
    exists (select 1 from workspace_artifacts site
      where site.id = generated_app_records.site_id
        and site.business_id = ${businessId}::uuid
        and site.kind = 'website')`;
  const currentRevision = async (siteId: string) => {
    const [site] = await db.execute<{ revision: number }>(sql`select revision
      from workspace_artifacts where id = ${siteId}::uuid and kind = 'website'`);
    return site?.revision ?? null;
  };
  const publishedRevision = async (siteId: string) => {
    const [publication] = await db.execute<{
      revision: number;
    }>(sql`select draft_revision as revision
      from website_publications where artifact_id = ${siteId}::uuid
        and unpublished_at is null and runtime_mode = 'app'`);
    return publication?.revision ?? null;
  };
  const activeRevision = async (siteId: string) =>
    (await publishedRevision(siteId)) ?? (await currentRevision(siteId));
  const runtimeContext = async (
    siteId: string,
    preview?: AppRuntimeScope,
  ): Promise<RuntimeContext | null> => {
    if (preview) {
      if (preview.environment === 'live') {
        const [publication] = await db.execute<{ revision: number }>(sql`
          select publication.draft_revision as revision
          from website_publications publication
          join workspace_artifacts site on site.id = publication.artifact_id
          where publication.artifact_id = ${siteId}::uuid
            and site.business_id = ${preview.businessId}::uuid
            and site.kind = 'website'
            and publication.unpublished_at is null
            and publication.runtime_mode = 'app'
            and publication.draft_revision = ${preview.revision}`);
        return publication
          ? {
              environment: 'live',
              dataRevision: 0,
              schemaRevision: publication.revision,
            }
          : null;
      }
      const [draft] = await db.execute<{ revision: number }>(sql`
        select site.revision from workspace_artifacts site
        join website_versions version on version.artifact_id = site.id
          and version.revision = site.revision and version.runtime_mode = 'app'
        where site.id = ${siteId}::uuid and site.business_id = ${preview.businessId}::uuid
          and site.kind = 'website' and site.revision = ${preview.revision}`);
      return draft
        ? {
            environment: 'preview',
            dataRevision: draft.revision,
            schemaRevision: draft.revision,
          }
        : null;
    }
    const revision = await publishedRevision(siteId);
    return revision === null
      ? null
      : { environment: 'live', dataRevision: 0, schemaRevision: revision };
  };
  const runtimeAvailable = (
    siteId: string,
    current: RuntimeContext,
    preview?: AppRuntimeScope,
  ) =>
    preview?.environment === 'live'
      ? sql`exists (select 1 from website_publications publication
          join workspace_artifacts site on site.id = publication.artifact_id
          where publication.artifact_id = ${siteId}::uuid
            and site.business_id = ${preview.businessId}::uuid
            and site.kind = 'website'
            and publication.unpublished_at is null and publication.runtime_mode = 'app'
            and publication.draft_revision = ${current.schemaRevision})`
      : preview
        ? sql`exists (select 1 from workspace_artifacts site
          join website_versions version on version.artifact_id = site.id
            and version.revision = site.revision and version.runtime_mode = 'app'
          where site.id = ${siteId}::uuid and site.business_id = ${preview.businessId}::uuid
            and site.revision = ${current.schemaRevision} and site.kind = 'website')`
        : sql`exists (select 1 from website_publications publication
          where publication.artifact_id = ${siteId}::uuid and publication.unpublished_at is null
            and publication.runtime_mode = 'app' and publication.draft_revision = ${current.schemaRevision})`;
  const policy = async (
    siteId: string,
    collection: string,
    requestedRevision?: number | null,
  ): Promise<Policy> => {
    const revision = requestedRevision ?? (await activeRevision(siteId));
    if (revision === null)
      return {
        readAccess: 'public',
        writeAccess: 'public',
        ownerScoped: false,
        fields: [],
        actions: [],
      };
    const [configured] = await db.execute<
      Omit<Policy, 'fields' | 'actions'> & { fields: unknown; actions: unknown }
    >(sql`select
        read_access as "readAccess", write_access as "writeAccess", owner_scoped as "ownerScoped", fields, actions
      from generated_app_collections where site_id = ${siteId}::uuid
        and revision = ${revision} and name = ${collection}`);
    if (configured)
      return {
        ...configured,
        fields: fieldDefinitions.parse(configured.fields),
        actions: z.array(workflowAction).max(20).parse(configured.actions),
      };
    const fallbackAccess = collection === 'records' ? 'public' : 'admin';
    return {
      readAccess: fallbackAccess,
      writeAccess: fallbackAccess,
      ownerScoped: false,
      fields: [],
      actions: [],
    };
  };
  const validateData = (
    input: unknown,
    current: Policy,
    applyDefaults = false,
  ) => {
    const data = recordData.parse(input);
    if (!current.fields.length) return data;
    const shape = Object.fromEntries(
      current.fields.map((field) => {
        const validator =
          field.type === 'text'
            ? z.string().min(field.required ? 1 : 0)
            : field.type === 'number'
              ? z.number().finite()
              : field.type === 'boolean'
                ? z.boolean()
                : z
                    .string()
                    .refine((value) => !Number.isNaN(Date.parse(value)));
        if (!field.required && data[field.name] === '') delete data[field.name];
        if (
          applyDefaults &&
          data[field.name] === undefined &&
          field.defaultValue !== undefined
        )
          data[field.name] = field.defaultValue;
        return [field.name, field.required ? validator : validator.optional()];
      }),
    ) as z.ZodRawShape;
    return z.object(shape).strict().parse(data);
  };
  const allowed = (access: Policy['readAccess'], user?: AppUser) =>
    access === 'public' ||
    (access === 'authenticated' && Boolean(user)) ||
    (access === 'admin' && user?.role === 'admin');
  const recordVisible = (current: Policy, user?: AppUser) =>
    !current.ownerScoped || user?.role === 'admin' || Boolean(user);
  const ownerFilter = (current: Policy, user?: AppUser) =>
    !current.ownerScoped || user?.role === 'admin'
      ? sql`true`
      : sql`owner_email = ${user?.email ?? null}`;
  return {
    async claimFunctionMutation(siteId: string, invocationId: string) {
      return db.transaction(async (tx) => {
        await tx.execute(sql`delete from generated_app_function_mutations
          where expires_at < now()`);
        const [claim] =
          await tx.execute(sql`insert into generated_app_function_mutations
            (invocation_id, site_id, expires_at)
          values (${invocationId}::uuid, ${siteId}::uuid, now() + interval '60 seconds')
          on conflict do nothing returning invocation_id`);
        return Boolean(claim);
      });
    },
    async publicBatch(
      siteId: string,
      operations: unknown,
      user?: AppUser,
      preview?: AppRuntimeScope,
    ) {
      const requested = z
        .array(generatedAppFunctionBatchOperation)
        .min(1)
        .max(20)
        .parse(operations);
      const runtime = await runtimeContext(siteId, preview);
      if (!runtime) return null;
      const prepared: PreparedBatchOperation[] = [];
      for (const operation of requested) {
        const collection = collectionName(operation.collection);
        const current = await policy(
          siteId,
          collection,
          runtime.schemaRevision,
        );
        if (
          !allowed(current.writeAccess, user) ||
          !recordVisible(current, user)
        )
          return null;
        if (operation.operation === 'create')
          prepared.push({
            ...operation,
            collection,
            current,
            data: validateData(operation.data, current, true),
          });
        else if (operation.operation === 'update')
          prepared.push({
            ...operation,
            collection,
            current,
            data: validateData(operation.data, current),
          });
        else prepared.push({ ...operation, collection, current });
      }
      try {
        return await db.transaction(async (tx) => {
          await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(
            'foundable-app-records:' || ${siteId}::text || ':' || ${runtime.environment} || ':' || ${runtime.dataRevision}, 0))`);
          const [count] = await tx.execute<{ count: number }>(sql`
            select count(*)::int as count from generated_app_records
            where site_id = ${siteId}::uuid and environment = ${runtime.environment}
              and data_revision = ${runtime.dataRevision}`);
          const creates = prepared.filter(
            ({ operation }) => operation === 'create',
          ).length;
          if (
            (count?.count ?? maxRecordsPerNamespace) + creates >
            maxRecordsPerNamespace
          )
            throw new GeneratedAppRecordQuotaExceeded();
          const results = [];
          for (const operation of prepared) {
            let row: Record<string, unknown> | undefined;
            const current = await policy(
              siteId,
              operation.collection,
              runtime.schemaRevision,
            );
            if (
              !allowed(current.writeAccess, user) ||
              !recordVisible(current, user)
            )
              throw new GeneratedAppBatchRejected();
            const data =
              operation.operation === 'delete'
                ? undefined
                : validateData(
                    operation.data,
                    current,
                    operation.operation === 'create',
                  );
            if (data)
              await assertUniqueValues(
                tx,
                siteId,
                runtime.environment,
                runtime.dataRevision,
                operation.collection,
                current.fields,
                data,
                operation.operation === 'update'
                  ? operation.recordId
                  : undefined,
              );
            if (operation.operation === 'create') {
              [row] = await tx.execute(sql`insert into generated_app_records
                (site_id, environment, data_revision, collection, data, owner_email)
                select ${siteId}::uuid, ${runtime.environment}, ${runtime.dataRevision},
                  ${operation.collection}, ${JSON.stringify(data)}::jsonb,
                  ${current.ownerScoped ? (user?.email ?? null) : null}
                where ${runtimeAvailable(siteId, runtime, preview)}
                returning id, collection, data, created_at as "createdAt", updated_at as "updatedAt"`);
            } else if (operation.operation === 'update') {
              [row] = await tx.execute(sql`update generated_app_records record
                set data = ${JSON.stringify(data)}::jsonb, updated_at = now()
                where record.site_id = ${siteId}::uuid and record.id = ${operation.recordId}::uuid
                  and record.collection = ${operation.collection} and record.environment = ${runtime.environment}
                  and record.data_revision = ${runtime.dataRevision}
                  and (${ownerFilter(current, user)})
                  and ${runtimeAvailable(siteId, runtime, preview)}
                returning id, collection, data, created_at as "createdAt", updated_at as "updatedAt"`);
            } else {
              [row] =
                await tx.execute(sql`delete from generated_app_records record
                where record.site_id = ${siteId}::uuid and record.id = ${operation.recordId}::uuid
                  and record.collection = ${operation.collection} and record.environment = ${runtime.environment}
                  and record.data_revision = ${runtime.dataRevision}
                  and (${ownerFilter(current, user)})
                  and ${runtimeAvailable(siteId, runtime, preview)}
                returning record.id`);
            }
            if (!row) throw new GeneratedAppBatchRejected();
            const action =
              operation.operation === 'create'
                ? 'record.created'
                : operation.operation === 'update'
                  ? 'record.updated'
                  : 'record.deleted';
            const id = String(row.id);
            await tx.execute(sql`insert into generated_app_activity
              (site_id, environment, data_revision, actor_id, action, target_id)
              values (${siteId}::uuid, ${runtime.environment}, ${runtime.dataRevision},
                ${user?.id ?? 'anonymous'}, ${action}, ${id})`);
            results.push(row);
          }
          return results;
        });
      } catch (error) {
        if (error instanceof GeneratedAppBatchRejected) return null;
        throw error;
      }
    },
    async publicList(
      siteId: string,
      requestedCollection?: string,
      user?: AppUser,
      preview?: AppRuntimeScope,
      limit = 100,
      cursor?: { updatedAt: string; id: string },
      includeCursor = false,
    ) {
      const collection = collectionName(requestedCollection);
      const runtime = await runtimeContext(siteId, preview);
      if (!runtime) return null;
      const current = await policy(siteId, collection, runtime.schemaRevision);
      if (!allowed(current.readAccess, user) || !recordVisible(current, user))
        return null;
      const rows =
        await db.execute(sql`select record.id, record.collection, record.data,
          record.created_at as "createdAt", record.updated_at as "updatedAt",
          ${includeCursor ? sql`to_char(record.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "cursorUpdatedAt",` : sql.empty()}
          coalesce((select actions from generated_app_collections configured
          where configured.site_id = record.site_id and configured.revision = ${runtime.schemaRevision}
            and configured.name = record.collection), '[]'::jsonb) as actions
        from generated_app_records record
        where record.site_id = ${siteId}::uuid and record.collection = ${collection}
          and record.environment = ${runtime.environment}
          and record.data_revision = ${runtime.dataRevision}
          and ${runtimeAvailable(siteId, runtime, preview)}
          and (${ownerFilter(current, user)})
          and (${cursor?.updatedAt ?? null}::timestamptz is null or
            (record.updated_at, record.id) < (${cursor?.updatedAt ?? null}::timestamptz, ${cursor?.id ?? null}::uuid))
        order by record.updated_at desc, record.id desc limit ${Math.min(Math.max(limit, 1), 101)}`);
      return rows;
    },
    async publicUpsert(
      siteId: string,
      id: string | undefined,
      input: unknown,
      requestedCollection?: string,
      user?: AppUser,
      preview?: AppRuntimeScope,
    ) {
      const collection = collectionName(requestedCollection);
      const runtime = await runtimeContext(siteId, preview);
      if (!runtime) return null;
      const current = await policy(siteId, collection, runtime.schemaRevision);
      if (!allowed(current.writeAccess, user) || !recordVisible(current, user))
        return null;
      validateData(input, current, id === undefined);
      return db.transaction((tx) =>
        withRecordQuota(
          tx,
          siteId,
          runtime.environment,
          runtime.dataRevision,
          id,
          async () => {
            const lockedPolicy = await policy(
              siteId,
              collection,
              runtime.schemaRevision,
            );
            if (
              !allowed(lockedPolicy.writeAccess, user) ||
              !recordVisible(lockedPolicy, user)
            )
              return null;
            const data = validateData(input, lockedPolicy, id === undefined);
            const ownerEmail = lockedPolicy.ownerScoped
              ? (user?.email ?? null)
              : null;
            await assertUniqueValues(
              tx,
              siteId,
              runtime.environment,
              runtime.dataRevision,
              collection,
              lockedPolicy.fields,
              data,
              id,
            );
            const [row] = await tx.execute(sql`insert into generated_app_records
                (site_id, environment, data_revision, id, collection, data, owner_email)
              select ${siteId}::uuid, ${runtime.environment}, ${runtime.dataRevision},
                coalesce(${id ?? null}::uuid, gen_random_uuid()), ${collection}, ${JSON.stringify(data)}::jsonb, ${ownerEmail}
              where ${runtimeAvailable(siteId, runtime, preview)}
              on conflict (site_id, environment, data_revision, id) do update set collection = excluded.collection,
                data = excluded.data,
                owner_email = case when ${lockedPolicy.ownerScoped}
                  then coalesce(generated_app_records.owner_email, excluded.owner_email)
                  else null end,
                updated_at = now()
                where generated_app_records.collection = ${collection}
                  and (${!lockedPolicy.ownerScoped} or ${user?.role === 'admin'} or generated_app_records.owner_email = ${user?.email ?? null})
              returning id, collection, data, created_at as "createdAt", updated_at as "updatedAt"`);
            return row ?? null;
          },
        ),
      );
    },
    async publicRemove(
      siteId: string,
      id: string,
      requestedCollection?: string,
      user?: AppUser,
      preview?: AppRuntimeScope,
    ) {
      const collection = collectionName(requestedCollection);
      const runtime = await runtimeContext(siteId, preview);
      if (!runtime) return false;
      const current = await policy(siteId, collection, runtime.schemaRevision);
      if (!allowed(current.writeAccess, user) || !recordVisible(current, user))
        return false;
      const rows = await db.execute(sql`delete from generated_app_records record
        where record.site_id = ${siteId}::uuid and record.id = ${id}::uuid and record.collection = ${collection}
          and record.environment = ${runtime.environment} and record.data_revision = ${runtime.dataRevision}
          and ${runtimeAvailable(siteId, runtime, preview)}
          and (${!current.ownerScoped} or ${user?.role === 'admin'} or record.owner_email = ${user?.email ?? null})
        returning record.id`);
      return rows.length > 0;
    },
    async canPublicAction(
      siteId: string,
      id: string,
      actionName: string,
      requestedCollection?: string,
      user?: AppUser,
      preview?: AppRuntimeScope,
    ) {
      const collection = collectionName(requestedCollection);
      const runtime = await runtimeContext(siteId, preview);
      if (!runtime) return false;
      const current = await policy(siteId, collection, runtime.schemaRevision);
      if (!allowed(current.writeAccess, user) || !recordVisible(current, user))
        return false;
      const action = current.actions.find(({ name }) => name === actionName);
      if (!action || !current.fields.some(({ name }) => name === action.field))
        return false;
      const [record] = await db.execute(sql`
        select id from generated_app_records record
        where record.site_id = ${siteId}::uuid and record.id = ${id}::uuid
          and record.collection = ${collection} and record.environment = ${runtime.environment}
          and record.data_revision = ${runtime.dataRevision}
          and ${runtimeAvailable(siteId, runtime, preview)} and (${ownerFilter(current, user)})`);
      return Boolean(record);
    },
    async publicAction(
      siteId: string,
      id: string,
      actionName: string,
      requestedCollection?: string,
      user?: AppUser,
      preview?: AppRuntimeScope,
    ) {
      const collection = collectionName(requestedCollection);
      const runtime = await runtimeContext(siteId, preview);
      if (!runtime) return null;
      const current = await policy(siteId, collection, runtime.schemaRevision);
      if (!allowed(current.writeAccess, user) || !recordVisible(current, user))
        return null;
      const action = current.actions.find(({ name }) => name === actionName);
      if (!action) return null;
      const field = current.fields.find(({ name }) => name === action.field);
      if (!field) return null;
      const valueMatches =
        ((field.type === 'text' || field.type === 'date') &&
          typeof action.value === 'string') ||
        (field.type === 'number' && typeof action.value === 'number') ||
        (field.type === 'boolean' && typeof action.value === 'boolean');
      if (!valueMatches) return null;
      return db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(
          'foundable-app-records:' || ${siteId}::text || ':' || ${runtime.environment} || ':' || ${runtime.dataRevision}, 0))`);
        const lockedPolicy = await policy(
          siteId,
          collection,
          runtime.schemaRevision,
        );
        const lockedAction = lockedPolicy.actions.find(
          ({ name }) => name === actionName,
        );
        if (
          !allowed(lockedPolicy.writeAccess, user) ||
          !recordVisible(lockedPolicy, user) ||
          !lockedAction
        )
          return null;
        const [existing] = await tx.execute<{
          data: Record<string, unknown>;
        }>(sql`
          select data from generated_app_records
          where site_id = ${siteId}::uuid and id = ${id}::uuid and collection = ${collection}
            and environment = ${runtime.environment} and data_revision = ${runtime.dataRevision}
            and (${ownerFilter(current, user)})`);
        if (!existing) return null;
        const data = validateData(
          { ...existing.data, [lockedAction.field]: lockedAction.value },
          lockedPolicy,
        );
        await assertUniqueValues(
          tx,
          siteId,
          runtime.environment,
          runtime.dataRevision,
          collection,
          lockedPolicy.fields,
          data,
          id,
        );
        const [row] = await tx.execute(sql`with updated as (
          update generated_app_records record
          set data = ${JSON.stringify(data)}::jsonb, updated_at = now()
          where record.site_id = ${siteId}::uuid and record.id = ${id}::uuid and record.collection = ${collection}
            and record.environment = ${runtime.environment} and record.data_revision = ${runtime.dataRevision}
            and (${ownerFilter(lockedPolicy, user)})
            and ${runtimeAvailable(siteId, runtime, preview)}
          returning id, collection, data, created_at as "createdAt", updated_at as "updatedAt"
        ), logged as (
          insert into generated_app_activity (site_id, environment, data_revision, actor_id, action, target_id)
          select ${siteId}::uuid, ${runtime.environment}, ${runtime.dataRevision},
            ${user?.id ?? 'anonymous'}, 'record.workflow_action', ${id} from updated
          returning id
        ) select updated.* from updated cross join logged`);
        return row ?? null;
      });
    },
    async list(
      businessId: string,
      siteId: string,
      requestedCollection?: string,
      cursor?: { updatedAt: string; id: string },
      limit = 100,
      includeCursor = false,
    ) {
      const collection = requestedCollection
        ? collectionName(requestedCollection)
        : null;
      return db.execute(sql`select id, collection, data, created_at as "createdAt", updated_at as "updatedAt"
          ${includeCursor ? sql`, to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "cursorUpdatedAt"` : sql.empty()}
        from generated_app_records where site_id = ${siteId}::uuid and ${scope(businessId)}
          and environment = 'live' and data_revision = 0
          and (${collection}::text is null or collection = ${collection})
          and (${cursor?.updatedAt ?? null}::timestamptz is null or
            (updated_at, id) < (${cursor?.updatedAt ?? null}::timestamptz, ${cursor?.id ?? null}::uuid))
        order by updated_at desc, id desc limit ${Math.min(Math.max(limit, 1), 101)}`);
    },
    async upsert(
      businessId: string,
      siteId: string,
      id: string | undefined,
      input: unknown,
      requestedCollection?: string,
    ) {
      const collection = collectionName(requestedCollection);
      validateData(input, await policy(siteId, collection), id === undefined);
      return db.transaction((tx) =>
        withRecordQuota(tx, siteId, 'live', 0, id, async () => {
          const current = await policy(siteId, collection);
          const data = validateData(input, current, id === undefined);
          await assertUniqueValues(
            tx,
            siteId,
            'live',
            0,
            collection,
            current.fields,
            data,
            id,
          );
          const [row] = await tx.execute(sql`insert into generated_app_records
              (site_id, environment, data_revision, id, collection, data)
            select ${siteId}::uuid, 'live', 0, coalesce(${id ?? null}::uuid, gen_random_uuid()), ${collection}, ${JSON.stringify(data)}::jsonb
            where exists (select 1 from workspace_artifacts where id = ${siteId}::uuid and business_id = ${businessId}::uuid and kind = 'website')
            on conflict (site_id, environment, data_revision, id) do update set collection = excluded.collection, data = excluded.data, updated_at = now()
            returning id, collection, data, created_at as "createdAt", updated_at as "updatedAt"`);
          return row ?? null;
        }),
      );
    },
    async remove(
      businessId: string,
      siteId: string,
      id: string,
      requestedCollection?: string,
    ) {
      const collection = requestedCollection
        ? collectionName(requestedCollection)
        : null;
      const rows =
        await db.execute(sql`delete from generated_app_records record using workspace_artifacts site
        where record.site_id = ${siteId}::uuid and record.id = ${id}::uuid
          and record.environment = 'live' and record.data_revision = 0
          and (${collection}::text is null or record.collection = ${collection})
          and site.id = record.site_id and site.business_id = ${businessId}::uuid and site.kind = 'website'
        returning record.id`);
      return rows.length > 0;
    },
    async audit(
      businessId: string,
      siteId: string,
      actorId: string,
      action:
        | 'record.created'
        | 'record.updated'
        | 'record.deleted'
        | 'collection.saved'
        | 'collection.reset'
        | 'user.role_changed'
        | 'user.removed'
        | 'user.invited'
        | 'file.deleted',
      targetId: string,
    ) {
      await db.execute(sql`insert into generated_app_activity
        (site_id, actor_id, action, target_id)
        select ${siteId}::uuid, ${actorId}, ${action}, ${targetId}
        where exists (select 1 from workspace_artifacts site
          join website_versions version on version.artifact_id = site.id
            and version.revision = site.revision
          where site.id = ${siteId}::uuid and site.business_id = ${businessId}::uuid
            and site.kind = 'website' and version.runtime_mode = 'app')`);
    },
    async activity(
      businessId: string,
      siteId: string,
      cursor?: { createdAt: string; id: string },
      limit = 100,
      includeCursor = false,
    ) {
      return db.execute(sql`select event.id, event.actor_id as "actorId",
          event.action, event.target_id as "targetId", event.created_at as "createdAt"
          ${includeCursor ? sql`, to_char(event.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "cursorCreatedAt"` : sql.empty()}
        from generated_app_activity event
        where event.site_id = ${siteId}::uuid
          and event.environment = 'live' and event.data_revision = 0
          and exists (select 1 from workspace_artifacts site
            where site.id = event.site_id and site.business_id = ${businessId}::uuid)
          and (${cursor?.createdAt ?? null}::timestamptz is null or
            (event.created_at, event.id) < (${cursor?.createdAt ?? null}::timestamptz, ${cursor?.id ?? null}::uuid))
        order by event.created_at desc, event.id desc limit ${Math.min(Math.max(limit, 1), 101)}`);
    },
    async analytics(businessId: string, siteId: string) {
      const revision = await activeRevision(siteId);
      const [metrics] = await db.execute(sql`with names as (
          select 'records'::text as name
          union
          select name from generated_app_collections where site_id = ${siteId}::uuid
            and revision = ${revision}
          union select collection as name from generated_app_records where site_id = ${siteId}::uuid
            and environment = 'live' and data_revision = 0
        ) select
          (select count(*)::int from generated_app_records where site_id = ${siteId}::uuid
            and environment = 'live' and data_revision = 0 and ${scope(businessId)}) as "recordCount",
          (select count(*)::int from generated_app_users where site_id = ${siteId}::uuid
            and exists (select 1 from workspace_artifacts site where site.id = ${siteId}::uuid and site.business_id = ${businessId}::uuid)) as "userCount",
          (select count(*)::int from generated_app_files where site_id = ${siteId}::uuid
            and environment = 'live' and data_revision = 0
            and exists (select 1 from workspace_artifacts site where site.id = ${siteId}::uuid and site.business_id = ${businessId}::uuid)) as "fileCount",
          coalesce((select sum(octet_length(bytes)) from generated_app_files where site_id = ${siteId}::uuid
            and environment = 'live' and data_revision = 0
            and exists (select 1 from workspace_artifacts site where site.id = ${siteId}::uuid and site.business_id = ${businessId}::uuid)), 0)::text as "storageBytes",
          coalesce((select sum(-entry.amount) from credit_entries entry
            join generated_app_files file on entry.operation_key = 'storage:' || file.id::text
            where entry.kind = 'storage' and file.site_id = ${siteId}::uuid
              and file.environment = 'live' and file.data_revision = 0
              and exists (select 1 from workspace_artifacts site
                where site.id = file.site_id and site.business_id = ${businessId}::uuid)), 0)::text as "storageCredits",
          greatest((select count(*)::int from names), 1) as "collectionCount",
          (select count(*)::int from generated_app_activity where site_id = ${siteId}::uuid
            and environment = 'live' and data_revision = 0
            and created_at >= now() - interval '7 days'
            and exists (select 1 from workspace_artifacts site where site.id = ${siteId}::uuid and site.business_id = ${businessId}::uuid)) as "activityLast7Days",
          coalesce((select sum(-entry.amount) from credit_entries entry
            where entry.kind = 'model' and entry.turn_id in (
              select distinct version.turn_id from website_versions version
              where version.artifact_id = ${siteId}::uuid and version.runtime_mode = 'app'
                and version.turn_id is not null
                and exists (select 1 from workspace_artifacts site
                  where site.id = version.artifact_id and site.business_id = ${businessId}::uuid)
            )), 0)::text as "modelCredits",
          coalesce((select sum(-entry.amount) from credit_entries entry
            where entry.kind = 'tool' and entry.turn_id in (
              select distinct version.turn_id from website_versions version
              where version.artifact_id = ${siteId}::uuid and version.runtime_mode = 'app'
                and version.turn_id is not null
                and exists (select 1 from workspace_artifacts site
                  where site.id = version.artifact_id and site.business_id = ${businessId}::uuid)
            )), 0)::text as "toolCredits",
          coalesce((select count(*)::int from media_jobs job
            where job.site_id = ${siteId}::uuid and job.state <> 'failed'
              and exists (select 1 from workspace_artifacts site
                where site.id = job.site_id and site.business_id = ${businessId}::uuid)), 0) as "mediaJobs",
          coalesce((select sum(job.credits) from media_jobs job
            where job.site_id = ${siteId}::uuid and job.state <> 'failed'
              and exists (select 1 from workspace_artifacts site
                where site.id = job.site_id and site.business_id = ${businessId}::uuid)), 0)::text as "mediaCredits"`);
      const modelCredits = Number(metrics?.modelCredits ?? 0);
      const toolCredits = Number(metrics?.toolCredits ?? 0);
      return {
        ...(metrics ?? {
          recordCount: 0,
          userCount: 0,
          fileCount: 0,
          storageBytes: '0',
          storageCredits: '0',
          storageCreditsPerMib,
          mediaJobs: 0,
          mediaCredits: '0',
          collectionCount: 1,
          activityLast7Days: 0,
        }),
        modelCredits,
        toolCredits,
        storageCreditsPerMib,
        totalCredits: modelCredits + toolCredits,
      };
    },
    async collections(businessId: string, siteId: string) {
      const revision = await activeRevision(siteId);
      if (revision === null) return [];
      const configured = await db.execute<
        Policy & { name: string }
      >(sql`with names as (
          select name from generated_app_collections where site_id = ${siteId}::uuid
            and revision = ${revision}
          union select collection as name from generated_app_records
            where site_id = ${siteId}::uuid and environment = 'live' and data_revision = 0
        ) select names.name, coalesce(policy.read_access,
            case when names.name = 'records' then 'public' else 'admin' end) as "readAccess",
            coalesce(policy.write_access,
            case when names.name = 'records' then 'public' else 'admin' end) as "writeAccess",
            coalesce(policy.owner_scoped, false) as "ownerScoped",
            coalesce(policy.fields, '[]'::jsonb) as fields
            , coalesce(policy.actions, '[]'::jsonb) as actions
          from names left join generated_app_collections policy
            on policy.site_id = ${siteId}::uuid and policy.revision = ${revision}
              and policy.name = names.name
          where exists (select 1 from workspace_artifacts site
            where site.id = ${siteId}::uuid and site.business_id = ${businessId}::uuid
              and site.kind = 'website')
          order by names.name limit 100`);
      if (configured.some((item) => item.name === 'records')) return configured;
      return [
        {
          name: 'records',
          readAccess: 'public' as const,
          writeAccess: 'public' as const,
          ownerScoped: false,
          fields: [],
        },
        ...configured,
      ];
    },
    async configureCollection(
      businessId: string,
      siteId: string,
      requestedName: string,
      input: unknown,
      actorId = 'system',
    ) {
      const name = collectionName(requestedName);
      const revision = await activeRevision(siteId);
      if (revision === null) return null;
      const { migrations = [], ...configured } = collectionPolicyInput
        .extend({ migrations: collectionDataMigrations.optional() })
        .parse(input);
      const fieldsProvided = configured.fields !== undefined;
      const fields = JSON.stringify(configured.fields ?? []);
      if (
        configured.ownerScoped &&
        (configured.readAccess === 'public' ||
          configured.writeAccess === 'public')
      )
        throw new Error(
          'Owner-scoped collections require authenticated access.',
        );
      const actions = JSON.stringify(configured.actions ?? []);
      return db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(
          'foundable-app-schema:' || ${siteId}::text || ':' || ${revision}, 0))`);
        const [site] = await tx.execute<{
          revision: number;
          liveRevision: number | null;
        }>(sql`select site.revision,
            publication.draft_revision as "liveRevision"
          from workspace_artifacts site left join website_publications publication
            on publication.artifact_id = site.id and publication.unpublished_at is null
              and publication.runtime_mode = 'app'
          where site.id = ${siteId}::uuid and site.business_id = ${businessId}::uuid
            and site.kind = 'website' for update of site`);
        if (!site || (site.liveRevision ?? site.revision) !== revision)
          return null;
        const [existing] = await tx.execute<{
          readAccess: Policy['readAccess'];
          writeAccess: Policy['writeAccess'];
          ownerScoped: boolean;
          fields: unknown;
          actions: unknown;
        }>(sql`select read_access as "readAccess", write_access as "writeAccess",
            owner_scoped as "ownerScoped", fields, actions
          from generated_app_collections where site_id = ${siteId}::uuid
            and revision = ${revision} and name = ${name}`);
        const previous: Policy = existing
          ? {
              readAccess: existing.readAccess,
              writeAccess: existing.writeAccess,
              ownerScoped: existing.ownerScoped,
              fields: fieldDefinitions.parse(existing.fields),
              actions: z.array(workflowAction).max(20).parse(existing.actions),
            }
          : {
              readAccess: name === 'records' ? 'public' : 'admin',
              writeAccess: name === 'records' ? 'public' : 'admin',
              ownerScoped: false,
              fields: [],
              actions: [],
            };
        const target: Policy = {
          ...previous,
          readAccess: configured.readAccess,
          writeAccess: configured.writeAccess,
          ownerScoped: configured.ownerScoped,
          fields: configured.fields ?? previous.fields,
          actions: configured.actions ?? previous.actions,
        };
        for (const action of target.actions) {
          const field = target.fields.find(({ name }) => name === action.field);
          const valid =
            field &&
            ((field.type === 'text' && typeof action.value === 'string') ||
              (field.type === 'date' &&
                typeof action.value === 'string' &&
                !Number.isNaN(Date.parse(action.value))) ||
              (field.type === 'number' && typeof action.value === 'number') ||
              (field.type === 'boolean' && typeof action.value === 'boolean'));
          if (!valid)
            throw new Error(
              'Workflow actions must set a defined field to a matching value.',
            );
        }
        const [publication] = await tx.execute<{ revision: number }>(sql`
          select draft_revision as revision from website_publications
          where artifact_id = ${siteId}::uuid and unpublished_at is null
            and runtime_mode = 'app'`);
        if (migrations.length || target.fields.some(({ unique }) => unique)) {
          if (migrations.length && publication?.revision !== revision)
            throw new GeneratedAppSchemaMigrationError(
              'One-time data migrations can only run against the active published app revision.',
            );
          await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(
            'foundable-app-records:' || ${siteId}::text || ':live:0', 0))`);
          const records = await tx.execute<{
            id: string;
            data: Record<string, unknown>;
          }>(sql`select id, data from generated_app_records
            where site_id = ${siteId}::uuid and environment = 'live'
              and data_revision = 0 and collection = ${name} for update`);
          const uniqueValues = new Map<string, Set<string>>();
          for (const record of records) {
            const data = { ...record.data };
            for (const migration of migrations) {
              if (migration.operation === 'renameField') {
                if (migration.from === migration.to) continue;
                if (data[migration.from] !== undefined) {
                  if (data[migration.to] !== undefined)
                    throw new GeneratedAppSchemaMigrationError();
                  data[migration.to] = data[migration.from];
                  delete data[migration.from];
                }
              } else if (migration.operation === 'copyField') {
                if (migration.from === migration.to) continue;
                if (data[migration.from] !== undefined) {
                  if (data[migration.to] !== undefined)
                    throw new GeneratedAppSchemaMigrationError();
                  data[migration.to] = data[migration.from];
                }
              } else if (migration.operation === 'removeField') {
                delete data[migration.field];
              } else {
                data[migration.field] = migration.value;
              }
            }
            let migrated = data;
            if (migrations.length) {
              try {
                migrated = validateData(data, target, true);
              } catch {
                throw new GeneratedAppSchemaMigrationError();
              }
            }
            for (const field of target.fields.filter(({ unique }) => unique)) {
              const value = migrated[field.name];
              if (value === undefined) continue;
              const key = JSON.stringify(value);
              const values = uniqueValues.get(field.name) ?? new Set<string>();
              if (values.has(key))
                throw new GeneratedAppSchemaMigrationError(
                  `Existing app records contain duplicate values for unique field ${field.name}.`,
                );
              values.add(key);
              uniqueValues.set(field.name, values);
            }
            if (JSON.stringify(migrated) === JSON.stringify(record.data))
              continue;
            await tx.execute(sql`with changed as (
              update generated_app_records set data = ${JSON.stringify(migrated)}::jsonb,
                updated_at = now() where site_id = ${siteId}::uuid and environment = 'live'
                  and data_revision = 0 and id = ${record.id}::uuid
              returning id
            ) insert into generated_app_activity
              (site_id, environment, data_revision, actor_id, action, target_id)
              select ${siteId}::uuid, 'live', 0, ${actorId}, 'record.schema_migrated', id::text
              from changed`);
          }
        }
        const [row] = await tx.execute(sql`insert into generated_app_collections
        (site_id, revision, name, read_access, write_access, owner_scoped, fields, actions)
        select ${siteId}::uuid, ${revision}, ${name}, ${configured.readAccess}, ${configured.writeAccess}, ${configured.ownerScoped}, ${fields}::jsonb, ${actions}::jsonb
        where exists (select 1 from workspace_artifacts site where site.id = ${siteId}::uuid
          and site.business_id = ${businessId}::uuid and site.kind = 'website')
        on conflict (site_id, revision, name) do update set read_access = excluded.read_access,
          write_access = excluded.write_access, owner_scoped = excluded.owner_scoped,
          fields = case when ${fieldsProvided} then excluded.fields else generated_app_collections.fields end,
          actions = case when ${configured.actions !== undefined} then excluded.actions else generated_app_collections.actions end,
          updated_at = now()
        returning name, read_access as "readAccess", write_access as "writeAccess", owner_scoped as "ownerScoped", fields`);
        if (!row) return null;
        if (
          publication?.revision === revision &&
          !(await prepareGeneratedAppRecordsForRevision(tx, siteId, revision))
        )
          throw new GeneratedAppSchemaMigrationError();
        return row;
      });
    },
    async resetCollection(
      businessId: string,
      siteId: string,
      requestedName: string,
    ) {
      const name = collectionName(requestedName);
      const revision = await activeRevision(siteId);
      if (revision === null) return false;
      const rows =
        await db.execute(sql`delete from generated_app_collections collection
        using workspace_artifacts site where collection.site_id = ${siteId}::uuid
          and collection.revision = ${revision}
          and collection.name = ${name} and site.id = collection.site_id
          and site.business_id = ${businessId}::uuid and site.kind = 'website'
        returning collection.name`);
      return rows.length > 0;
    },
  };
}
