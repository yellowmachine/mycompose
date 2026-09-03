import { sql } from 'drizzle-orm';
import {
	boolean,
	check,
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';

export const APP_STATUSES = ['draft', 'deploying', 'running', 'stopped', 'failed'] as const;
export const DEPLOY_STATUSES = ['pending', 'deploying', 'succeeded', 'failed'] as const;
export const CAUSE_CLASSES = [
	'git',
	'compose',
	'build',
	'image',
	'port',
	'runtime',
	'config',
	'unknown'
] as const;
export const CONFIDENCE_LEVELS = ['low', 'medium', 'high'] as const;

export type AppStatus = (typeof APP_STATUSES)[number];
export type DeployStatus = (typeof DEPLOY_STATUSES)[number];
export type CauseClass = (typeof CAUSE_CLASSES)[number];
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export const apps = pgTable(
	'apps',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		name: text('name').notNull(),
		slug: text('slug').notNull().unique(),
		gitUrl: text('git_url').notNull(),
		branch: text('branch').notNull().default('main'),
		composePath: text('compose_path').notNull().default('docker-compose.yml'),
		status: text('status').notNull().default('draft').$type<AppStatus>(),
		liveSha: text('live_sha'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		check(
			'apps_status_check',
			sql`${t.status} in ('draft','deploying','running','stopped','failed')`
		),
		check('apps_slug_check', sql`${t.slug} ~ '^[a-z]([a-z0-9-]{0,46}[a-z0-9])?$'`)
	]
);

export const appEnvVars = pgTable(
	'app_env_vars',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		appId: uuid('app_id')
			.notNull()
			.references(() => apps.id, { onDelete: 'cascade' }),
		key: text('key').notNull(),
		value: text('value').notNull()
	},
	(t) => [uniqueIndex('app_env_vars_app_key_uidx').on(t.appId, t.key)]
);

export const deploys = pgTable(
	'deploys',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		appId: uuid('app_id')
			.notNull()
			.references(() => apps.id, { onDelete: 'cascade' }),
		gitUrl: text('git_url').notNull(),
		branch: text('branch').notNull(),
		sha: text('sha'),
		composePath: text('compose_path').notNull(),
		envSnapshot: jsonb('env_snapshot').notNull().$type<Record<string, string>>().default({}),
		status: text('status').notNull().default('pending').$type<DeployStatus>(),
		logText: text('log_text').notNull().default(''),
		logTruncated: boolean('log_truncated').notNull().default(false),
		errorSummary: text('error_summary'),
		startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
		finishedAt: timestamp('finished_at', { withTimezone: true })
	},
	(t) => [
		check('deploys_status_check', sql`${t.status} in ('pending','deploying','succeeded','failed')`),
		index('deploys_app_started_idx').on(t.appId, t.startedAt.desc()),
		uniqueIndex('deploys_inflight_uidx')
			.on(t.appId)
			.where(sql`${t.status} in ('pending','deploying')`)
	]
);

export const deployExplanations = pgTable(
	'deploy_explanations',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		deployId: uuid('deploy_id')
			.notNull()
			.references(() => deploys.id, { onDelete: 'cascade' }),
		causeClass: text('cause_class').notNull().$type<CauseClass>(),
		summary: text('summary').notNull(),
		evidence: jsonb('evidence').notNull().$type<string[]>().default([]),
		nextChecks: jsonb('next_checks').notNull().$type<string[]>().default([]),
		confidence: text('confidence').notNull().$type<ConfidenceLevel>(),
		model: text('model').notNull(),
		raw: text('raw'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		check(
			'deploy_explanations_cause_check',
			sql`${t.causeClass} in ('git','compose','build','image','port','runtime','config','unknown')`
		),
		check('deploy_explanations_confidence_check', sql`${t.confidence} in ('low','medium','high')`),
		index('deploy_explanations_deploy_created_idx').on(t.deployId, t.createdAt.desc())
	]
);
