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
  await setupAmendmentsEnabledTable()
}

async function setupCrawlsTable(): Promise<void> {
  const hasCrawls = await db().schema.hasTable('crawls')
  if (!hasCrawls) {
    await db().schema.createTable('crawls', (table) => {
      table.string('public_key').primary()
      table.dateTime('start')
      table.string('complete_ledgers')
      table.text('complete_shards')
      table.text('incomplete_shards')
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
  if (!(await db().schema.hasColumn('crawls', 'incomplete_shards'))) {
    await db().schema.alterTable('crawls', (table) => {
      table.string('incomplete_shards').after('complete_shards')
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
  await db().schema.dropTableIfExists('ledgers')
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
      table.string('networks')
      table.string('unl')
      table.string('domain')
      table.boolean('domain_verified')
      table.string('server_version')
      table.dateTime('last_ledger_time')
      table.json('agreement_1hour')
      table.json('agreement_24hour')
      table.json('agreement_30day')
    })
  }
  if (!(await db().schema.hasColumn('validators', 'server_version'))) {
    await db().schema.alterTable('validators', (table) => {
      table.string('server_version').after('domain_verified')
    })
  }
  if (!(await db().schema.hasColumn('validators', 'networks'))) {
    await db().schema.alterTable('validators', (table) => {
      table.string('networks').after('chain')
    })
  }
  // Modifies nft-dev validators once, since they have been decomissioned.
  await db().schema.raw(
    "UPDATE validators SET chain = 'nft-dev', networks = 'nft-dev' WHERE unl LIKE '%nftvalidators.s3.us-west-2.amazonaws.com%'",
  )
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
  if (await db().schema.hasColumn('daily_agreement', 'master_key')) {
    await db().schema.alterTable('daily_agreement', (table) => {
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
  }
  const networksIds = await query('networks').pluck('id')
  networks.forEach((network) => {
    if (!networksIds.includes(network.id)) {
      query('networks')
        .insert({
          id: network.id,
          entry: network.entry,
          port: network.port,
          unls: network.unls.join(','),
        })
        .catch((err: Error) => log.error(err.message))
    }
  })
  if (networksIds.includes('nft-dev')) {
    query('networks')
      .del()
      .where('id', '=', 'nft-dev')
      .catch((err: Error) => log.error(err.message))
  }
}

async function setupAmendmentsEnabledTable(): Promise<void> {
  const hasAmendmentsEnabled = await db().schema.hasTable('amendments_enabled')
  if (!hasAmendmentsEnabled) {
    await db().schema.createTable('amendments_enabled', (table) => {
      table.string('amendment_id')
      table.string('networks')
      table.string('tx_hash')
      table.dateTime('date')
      table.primary(['amendment_id', 'networks'])
    })
  }
  if (!(await db().schema.hasColumn('amendments_enabled', 'tx_hash'))) {
    await db().schema.alterTable('amendments_enabled', (table) => {
      table.string('tx_hash').after('networks')
    })
  }
  if (!(await db().schema.hasColumn('amendments_enabled', 'date'))) {
    await db().schema.alterTable('amendments_enabled', (table) => {
      table.datetime('date').after('tx_hash')
    })
  }
}
