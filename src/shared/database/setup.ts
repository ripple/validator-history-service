import logger from '../utils/logger'

import networks from './networks'
import { db, query } from './utils'

const log = logger({ name: 'database' })

/**
 * Setup tables in database.
 *
 * @returns Promise that creates tables in database.
 */
export default async function setupTables(): Promise<void> {
  await setupCrawlsTable()
  await setupLocationTable()
  await setupManifestTable()
  await setupLedgersTable()
  await setupValidatorsTable()
  await setupHourlyAgreementTable()
  await setupDailyAgreementTable()
  await setupNetworksTable()
}

async function setupCrawlsTable(): Promise<void> {
  const hasCrawls = await db().schema.hasTable('crawls')
  if (!hasCrawls) {
    await db().schema.createTable('crawls', (table) => {
      table.string('public_key').primary()
      table.dateTime('start')
      table.string('complete_ledgers')
      table.text('complete_shards')
      table.string('ip')
      table.integer('port')
      table.string('ws_url')
      table.boolean('connected')
      table.string('networks')
      table.string('type')
      table.integer('uptime')
      table.integer('inbound_count')
      table.integer('outbound_count')
      table.string('server_state')
      table.integer('io_latency_ms')
      table.string('load_factor_server')
      table.string('version')
    })
  }
}

async function setupLocationTable(): Promise<void> {
  const hasLocation = await db().schema.hasTable('location')
  if (!hasLocation) {
    await db().schema.createTable('location', (table) => {
      table.string('public_key').primary()
      table.foreign('public_key').references('crawls.public_key')
      table.string('ip')
      table.decimal('lat')
      table.decimal('long')
      table.string('continent')
      table.string('country')
      table.string('region')
      table.string('city')
      table.string('postal_code')
      table.string('region_code')
      table.string('country_code')
      table.string('timezone')
      table.string('isp')
      table.string('org')
      table.string('domain')
      table.string('location_source')
      table.dateTime('updated')
    })
  }
}

async function setupManifestTable(): Promise<void> {
  const hasManifests = await db().schema.hasTable('manifests')
  if (!hasManifests) {
    await db().schema.createTable('manifests', (table) => {
      table.string('master_key')
      table.string('signing_key')
      table.string('master_signature').unique()
      table.string('signature')
      table.string('domain')
      table.boolean('domain_verified')
      table.boolean('revoked')
      table.bigInteger('seq')
    })
  }
}

async function setupLedgersTable(): Promise<void> {
  const hasLedgers = await db().schema.hasTable('ledgers')
  if (!hasLedgers) {
    await db().schema.createTable('ledgers', (table) => {
      table.string('ledger_hash').primary()
      table.integer('ledger_index').index()
      table.integer('full')
      table.integer('main')
      table.integer('altnet')
      table.json('partial')
      table.json('missing')
      table.double('avg_load_fee')
      table.dateTime('avg_sign_time')
      table.dateTime('updated')
    })
  }
}

async function setupValidatorsTable(): Promise<void> {
  const hasValidators = await db().schema.hasTable('validators')
  if (!hasValidators) {
    await db().schema.createTable('validators', (table) => {
      table.string('master_key')
      table.string('signing_key').unique()
      table.boolean('revoked')
      table.string('ledger_hash')
      table.bigInteger('current_index')
      table.integer('load_fee')
      table.boolean('partial')
      table.string('chain')
      table.string('unl')
      table.string('domain')
      table.boolean('domain_verified')
      table.dateTime('last_ledger_time')
      table.json('agreement_1hour')
      table.json('agreement_24hour')
      table.json('agreement_30day')
    })
  }
}

async function setupHourlyAgreementTable(): Promise<void> {
  const hasHourlyAgreement = await db().schema.hasTable('hourly_agreement')
  if (!hasHourlyAgreement) {
    await db().schema.createTable('hourly_agreement', (table) => {
      table.string('main_key')
      table.dateTime('start')
      table.json('agreement')
      table.primary(['main_key', 'start'])
    })
  }
  if (await db().schema.hasColumn('hourly_agreement', 'master_key')) {
    await db().schema.alterTable('hourly_agreement', (table) => {
      table.renameColumn('master_key', 'main_key')
    })
  }
}

async function setupDailyAgreementTable(): Promise<void> {
  const hasDailyAgreement = await db().schema.hasTable('daily_agreement')
  if (!hasDailyAgreement) {
    await db().schema.createTable('daily_agreement', (table) => {
      table.string('main_key')
      table.dateTime('day')
      table.json('agreement')
      table.primary(['main_key', 'day'])
    })
  }
  if (await db().schema.hasColumn('daily_agreemenet', 'master_key')) {
    await db().schema.alterTable('daily_agreemenet', (table) => {
      table.renameColumn('master_key', 'main_key')
    })
  }
}

async function setupNetworksTable(): Promise<void> {
  const hasNetworks = await db().schema.hasTable('networks')
  if (!hasNetworks) {
    await db().schema.createTable('networks', (table) => {
      table.string('id')
      table.string('entry')
      table.integer('port')
      table.string('unls')
      table.primary(['entry'])
    })
    networks.forEach((network) => {
      query('networks')
        .insert({
          id: network.id,
          entry: network.entry,
          port: network.port,
          unls: network.unls.join(','),
        })
        .catch((err: Error) => log.error(err.message))
    })
  }
}
