import { sql } from 'drizzle-orm';
import type { WebsitePage } from '@brightwork/shared';
import {
  boolean,
  check,
  date as pgDate,
  index,
  uniqueIndex,
  integer,
  numeric,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

const date = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'date' });

export const accounts = pgTable('accounts', {
  id: uuid().primaryKey().defaultRandom(),
  email: text().notNull().unique(),
  name: text(),
  language: text(),
  timezone: text(),
  browserLanguage: text('browser_language').notNull().default('en-US'),
  browserTimezone: text('browser_timezone').notNull().default('UTC'),
  appearance: text({ enum: ['light', 'dark', 'system'] })
    .notNull()
    .default('system'),
  background: text({ enum: ['plain', 'clouds'] })
    .notNull()
    .default('clouds'),
  reduceEffects: boolean('reduce_effects').notNull().default(false),
  showPredictions: boolean('show_predictions').notNull().default(true),
  showNotificationBadges: boolean('show_notification_badges')
    .notNull()
    .default(true),
});

export const identities = pgTable(
  'auth_identities',
  {
    provider: text().notNull(),
    subject: text().notNull(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.provider, t.subject] })],
);

export const attempts = pgTable('auth_attempts', {
  id: uuid().primaryKey().defaultRandom(),
  email: text().notNull(),
  codeHash: text('code_hash').notNull(),
  linkHash: text('link_hash').notNull().unique(),
  tries: integer().notNull().default(0),
  expiresAt: date('expires_at').notNull(),
});

export const sessions = pgTable('auth_sessions', {
  id: uuid().primaryKey().defaultRandom(),
  digest: text().notNull().unique(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  provider: text().notNull(),
  subject: text().notNull(),
  expiresAt: date('expires_at').notNull(),
});

export const businesses = pgTable('businesses', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  idea: text().notNull().default(''),
  createdAt: date('created_at').defaultNow().notNull(),
});

export const members = pgTable(
  'business_members',
  {
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    role: text({ enum: ['owner', 'admin', 'member', 'viewer'] }).notNull(),
    openedAt: date('opened_at').defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.businessId, t.accountId] })],
);

export const workspaceInvitations = pgTable(
  'workspace_invitations',
  {
    id: uuid().primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    email: text().notNull(),
    role: text({ enum: ['admin', 'member', 'viewer'] }).notNull(),
    expiresAt: date('expires_at').notNull(),
    acceptedAt: date('accepted_at'),
  },
  (table) => [
    uniqueIndex('workspace_invitation_email').on(table.businessId, table.email),
  ],
);

export const workspaceCredentials = pgTable(
  'workspace_credentials',
  {
    id: uuid().primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    sealed: text().notNull(),
    updatedAt: date('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('workspace_credential_name').on(table.businessId, table.name),
  ],
);

export const workspaceDomains = pgTable(
  'workspace_domains',
  {
    id: uuid().primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    hostname: text().notNull(),
    challenge: text().notNull(),
    verifiedAt: date('verified_at'),
  },
  (table) => [
    uniqueIndex('workspace_domain_hostname').on(
      table.businessId,
      table.hostname,
    ),
  ],
);

export type TurnPart =
  | { type: 'text'; text: string }
  | {
      type: 'tool';
      name: string;
      toolCallId: string;
      status: 'preparing' | 'running' | 'completed';
      input?: unknown;
      output?: unknown;
    };

export const businessRuns = pgTable(
  'business_runs',
  {
    id: uuid().primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    creatorId: uuid('creator_id').references(() => accounts.id, {
      onDelete: 'set null',
    }),
    goal: text().notNull(),
    state: text({ enum: ['active', 'paused', 'completed', 'failed'] })
      .notNull()
      .default('active'),
    creditLimit: numeric('credit_limit', {
      precision: 24,
      scale: 10,
    }).notNull(),
    publishWebsites: boolean('publish_websites').notNull().default(false),
    creditsUsed: numeric('credits_used', { precision: 24, scale: 10 })
      .notNull()
      .default('0'),
    nextCheckAt: date('next_check_at').defaultNow().notNull(),
    waitingFor: text('waiting_for', { enum: ['answer', 'approval'] }),
    createdAt: date('created_at').defaultNow().notNull(),
    endedAt: date('ended_at'),
    failure: text(),
  },
  (t) => [
    uniqueIndex('one_open_run_per_business')
      .on(t.businessId)
      .where(sql`${t.state} in ('active', 'paused')`),
    index('active_runs_due')
      .on(t.nextCheckAt)
      .where(sql`${t.state} = 'active'`),
  ],
);

export const agentTurns = pgTable('agent_turns', {
  purpose: text({ enum: ['work', 'plan'] })
    .notNull()
    .default('work'),
  plan: jsonb().$type<string[]>(),
  id: uuid().primaryKey().defaultRandom(),
  businessId: uuid('business_id')
    .notNull()
    .references(() => businesses.id, { onDelete: 'cascade' }),
  creatorId: uuid('creator_id').references(() => accounts.id, {
    onDelete: 'set null',
  }),
  runId: uuid('run_id').references(() => businessRuns.id, {
    onDelete: 'set null',
  }),
  prompt: text().notNull(),
  answer: text().notNull().default(''),
  state: text({ enum: ['queued', 'running', 'completed', 'failed'] })
    .notNull()
    .default('queued'),
  parts: jsonb().$type<TurnPart[]>().notNull().default([]),
  usage: jsonb()
    .$type<{ inputTokens: number; outputTokens: number }>()
    .notNull()
    .default({ inputTokens: 0, outputTokens: 0 }),
  revision: integer().notNull().default(0),
  createdAt: date('created_at').defaultNow().notNull(),
  updatedAt: date('updated_at').defaultNow().notNull(),
});

export const chatAttachments = pgTable('chat_attachments', {
  id: uuid().primaryKey().defaultRandom(),
  turnId: uuid('turn_id')
    .notNull()
    .references(() => agentTurns.id, { onDelete: 'cascade' }),
  name: text().notNull(),
  content: text().notNull(),
});

export const runSteps = pgTable(
  'run_steps',
  {
    runId: uuid('run_id')
      .notNull()
      .references(() => businessRuns.id, { onDelete: 'cascade' }),
    position: integer().notNull(),
    instruction: text().notNull(),
    attempt: integer().notNull().default(0),
    turnId: uuid('turn_id')
      .unique()
      .references(() => agentTurns.id, {
        onDelete: 'set null',
      }),
    completedAt: date('completed_at'),
  },
  (t) => [primaryKey({ columns: [t.runId, t.position] })],
);

export const runEvents = pgTable('run_events', {
  id: serial().primaryKey(),
  runId: uuid('run_id')
    .notNull()
    .references(() => businessRuns.id, { onDelete: 'cascade' }),
  kind: text().notNull(),
  detail: text().notNull(),
  createdAt: date('created_at').notNull().defaultNow(),
});

export const calendarEvents = pgTable(
  'calendar_events',
  {
    id: uuid().primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    startsAt: date('starts_at').notNull(),
    endsAt: date('ends_at').notNull(),
    timezone: text().notNull(),
    location: text().notNull().default(''),
    attendees: text().notNull().default(''),
    notes: text().notNull().default(''),
  },
  (table) => [
    check(
      'calendar_event_positive_duration',
      sql`${table.endsAt} > ${table.startsAt}`,
    ),
    index('calendar_events_business_starts_idx').on(
      table.businessId,
      table.startsAt,
    ),
  ],
);

export const artifacts = pgTable('workspace_artifacts', {
  id: uuid().primaryKey().defaultRandom(),
  businessId: uuid('business_id')
    .notNull()
    .references(() => businesses.id, { onDelete: 'cascade' }),
  turnId: uuid('turn_id').references(() => agentTurns.id, {
    onDelete: 'set null',
  }),
  kind: text({
    enum: [
      'document',
      'email',
      'post',
      'question',
      'task',
      'memory',
      'website',
    ],
  }).notNull(),
  title: text().notNull(),
  body: text().notNull(),
  pages: jsonb().$type<WebsitePage[]>().notNull().default([]),
  state: text({ enum: ['draft', 'pending', 'approved', 'rejected'] })
    .notNull()
    .default('draft'),
  revision: integer().notNull().default(1),
  answer: text(),
  replyRecipient: text('reply_recipient'),
  replyMessageId: text('reply_message_id'),
  answeredAt: date('answered_at'),
  dueAt: date('due_at'),
  recurrence: text({ enum: ['once', 'daily', 'weekly', 'monthly'] })
    .notNull()
    .default('once'),
  scheduleTimezone: text('schedule_timezone').notNull().default('UTC'),
  createdAt: date('created_at').defaultNow().notNull(),
});

export const websiteVersions = pgTable(
  'website_versions',
  {
    id: uuid().primaryKey().defaultRandom(),
    artifactId: uuid('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    revision: integer().notNull(),
    title: text().notNull(),
    document: text().notNull(),
    pages: jsonb().$type<WebsitePage[]>().notNull().default([]),
    savedAt: date('saved_at').defaultNow().notNull(),
    bookmarked: boolean().default(false).notNull(),
  },
  (t) => [
    uniqueIndex('website_artifact_revision').on(t.artifactId, t.revision),
  ],
);

export const taskAutomations = pgTable(
  'task_automations',
  {
    taskId: uuid('task_id')
      .primaryKey()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    creatorId: uuid('creator_id').references(() => accounts.id, {
      onDelete: 'set null',
    }),
    enabled: boolean().notNull().default(true),
    nextAt: date('next_at'),
    emailAfter: date('email_after'),
    checkAt: date('check_at').defaultNow().notNull(),
    turnId: uuid('turn_id')
      .unique()
      .references(() => agentTurns.id, { onDelete: 'set null' }),
    lastScheduledAt: date('last_scheduled_at'),
  },
  (t) => [
    index('task_automation_check')
      .on(t.checkAt)
      .where(sql`${t.enabled}`),
  ],
);

export const inboundEmails = pgTable(
  'inbound_emails',
  {
    id: uuid().primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    providerId: uuid('provider_id').notNull(),
    attachments: jsonb()
      .$type<{ id: string; filename: string }[]>()
      .notNull()
      .default([]),
    messageId: text('message_id'),
    threadId: uuid('thread_id').defaultRandom().notNull(),
    sender: text().notNull(),
    subject: text().notNull(),
    body: text(),
    html: text(),
    recordedAt: date('recorded_at')
      .default(sql`clock_timestamp()`)
      .notNull(),
    receivedAt: date('received_at').notNull(),
  },
  (table) => [
    uniqueIndex('inbound_email_delivery_idx').on(
      table.providerId,
      table.businessId,
    ),
    index('inbound_email_inbox_idx').on(table.businessId, table.receivedAt),
    index('inbound_email_recorded_idx').on(
      table.businessId,
      table.recordedAt,
      table.id,
    ),
  ],
);

export const taskEmailOccurrences = pgTable(
  'task_email_occurrences',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => taskAutomations.taskId, { onDelete: 'cascade' }),
    emailId: uuid('email_id')
      .notNull()
      .references(() => inboundEmails.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.taskId, table.emailId] })],
);

export const outboundEmails = pgTable(
  'outbound_emails',
  {
    id: uuid().primaryKey().defaultRandom(),
    artifactId: uuid('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').references(() => accounts.id, {
      onDelete: 'set null',
    }),
    revision: integer().notNull(),
    recipient: text().notNull(),
    replyTo: text('reply_to'),
    inReplyTo: text('in_reply_to'),
    sender: text().notNull(),
    subject: text().notNull(),
    body: text().notNull(),
    state: text({
      enum: ['queued', 'sending', 'accepted', 'failed', 'needs_review'],
    })
      .notNull()
      .default('queued'),
    attempts: integer().notNull().default(0),
    nextCheckAt: date('next_check_at').defaultNow().notNull(),
    firstAttemptAt: date('first_attempt_at'),
    providerId: text('provider_id'),
    note: text(),
    createdAt: date('created_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('outbound_email_revision').on(t.artifactId, t.revision),
    index('outbound_email_due')
      .on(t.nextCheckAt)
      .where(sql`${t.state} in ('queued', 'sending')`),
  ],
);

export const emailDeliveryEvents = pgTable(
  'email_delivery_events',
  {
    id: text().primaryKey(),
    providerId: text('provider_id').notNull(),
    status: text().notNull(),
    occurredAt: date('occurred_at').notNull(),
  },
  (table) => [
    index('email_delivery_provider').on(
      table.providerId,
      table.occurredAt.desc(),
    ),
  ],
);

export const publicationRequests = pgTable(
  'publication_requests',
  {
    id: uuid().primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => businessRuns.id, { onDelete: 'cascade' }),
    artifactId: uuid('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').references(() => accounts.id, {
      onDelete: 'set null',
    }),
    revision: integer().notNull(),
    state: text({ enum: ['queued', 'published', 'failed'] })
      .notNull()
      .default('queued'),
    createdAt: date('created_at').defaultNow().notNull(),
    finishedAt: date('finished_at'),
    failure: text(),
  },
  (t) => [
    uniqueIndex('publication_request_revision').on(t.artifactId, t.revision),
    index('run_publication_queue')
      .on(t.runId, t.createdAt)
      .where(sql`${t.state} = 'queued'`),
  ],
);

export const workspaceNotifications = pgTable('workspace_notifications', {
  id: serial().primaryKey(),
  businessId: uuid('business_id')
    .notNull()
    .references(() => businesses.id, { onDelete: 'cascade' }),
  artifactId: uuid('artifact_id')
    .notNull()
    .references(() => artifacts.id, { onDelete: 'cascade' }),
  key: text().notNull(),
  title: text().notNull(),
  createdAt: date('created_at').defaultNow().notNull(),
  resolvedAt: date('resolved_at'),
});

export const notificationReads = pgTable(
  'notification_reads',
  {
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    key: text().notNull(),
    readAt: date('read_at').defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.businessId, t.key] })],
);

export const publications = pgTable(
  'website_publications',
  {
    id: uuid().primaryKey().defaultRandom(),
    artifactId: uuid('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    document: text().notNull(),
    pages: jsonb().$type<WebsitePage[]>().notNull().default([]),
    draftRevision: integer('draft_revision').notNull().default(1),
    rollbackSourceId: uuid('rollback_source_id'),
    publishedAt: date('published_at').defaultNow().notNull(),
    unpublishedAt: date('unpublished_at'),
  },
  (t) => [
    uniqueIndex('one_live_website_per_artifact')
      .on(t.artifactId)
      .where(sql`${t.unpublishedAt} is null`),
  ],
);

export const visitDays = pgTable(
  'website_visit_days',
  {
    artifactId: uuid('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    day: pgDate().notNull(),
    views: integer().notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.artifactId, t.day] })],
);

export const billingCustomers = pgTable('billing_customers', {
  accountId: uuid('account_id')
    .primaryKey()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  customerId: text('customer_id').notNull().unique(),
  subscriptionId: text('subscription_id'),
  state: text().notNull().default('free'),
  periodEnd: date('period_end'),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
});

export const billingEvents = pgTable('billing_events', {
  id: text().primaryKey(),
  receivedAt: date('received_at').notNull().defaultNow(),
});

export const creditEntries = pgTable(
  'credit_entries',
  {
    id: uuid().primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    turnId: uuid('turn_id').references(() => agentTurns.id, {
      onDelete: 'set null',
    }),
    operationKey: text('operation_key').notNull(),
    kind: text({
      enum: [
        'starter',
        'model',
        'tool',
        'subscription',
        'refund',
        'referral',
        'image',
        'video',
        'voice',
      ],
    }).notNull(),
    amount: numeric({ precision: 24, scale: 10 }).notNull(),
    createdAt: date('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('credit_entries_account_id_operation_key_key').on(
      table.accountId,
      table.operationKey,
    ),
  ],
);

export const socialPublications = pgTable('social_publications', {
  artifactId: uuid('artifact_id')
    .primaryKey()
    .references(() => artifacts.id, { onDelete: 'cascade' }),
  actorId: uuid('actor_id').references(() => accounts.id, {
    onDelete: 'set null',
  }),
  revision: integer().notNull(),
  pageId: text('page_id').notNull(),
  state: text({ enum: ['publishing', 'published', 'unknown'] }).notNull(),
  remoteId: text('remote_id'),
  createdAt: date('created_at').notNull().defaultNow(),
});

export const adWalletBudgets = pgTable(
  'ad_wallet_budgets',
  {
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull(),
    currency: text().notNull(),
    monthlyTarget: numeric('monthly_target', {
      precision: 11,
      scale: 2,
    }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.businessId, t.accountId, t.currency] })],
);
