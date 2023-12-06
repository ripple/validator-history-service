import { getNetworkId } from '../utils'
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
  await setupBallotTable()
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
      table.integer('networks')
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

  await query('crawls')
    .columnInfo('networks')
    .then(async (columnInfo) => {
      if (columnInfo.type.includes('character')) {
        await db().schema.alterTable('crawls', (table) => {
          table.dropColumn('networks')
        })
        await db().schema.alterTable('crawls', (table) => {
          table.integer('networks').after('connected')
        })
      }
    })
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
      table.integer('networks')
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

  await query('validators')
    .columnInfo('networks')
    .then(async (columnInfo) => {
      if (columnInfo.type.includes('character')) {
        await db().schema.alterTable('validators', (table) => {
          table.dropColumn('networks')
        })
        await db().schema.alterTable('validators', (table) => {
          table.integer('networks').after('connected')
        })
      }
    })
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
      table.integer('id')
      table.string('entry')
      table.integer('port')
      table.string('unls')
      table.primary(['id'])
    })
  }
  const networkIds = await query('networks').pluck('id')
  if (networkIds.includes('main')) {
    await db().schema.dropTableIfExists('networks')
    await db().schema.createTable('networks', (table) => {
      table.integer('id')
      table.string('entry')
      table.integer('port')
      table.string('unls')
      table.primary(['id'])
    })
  }
  const networkEntries = await query('networks').pluck('entry')
  networks.forEach(async (network) => {
    if (!networkEntries.includes(network.entry)) {
      const id = await getNetworkId(`http://${network.entry}:${network.json}`)
      if (id == null) {
        throw new Error(
          `Network entry ${network.entry} doesn't have a network ID`,
        )
      }
      query('networks')
        .insert({
          id,
          entry: network.entry,
          port: network.port,
          unls: network.unls.join(','),
        })
        .catch((err: Error) => log.error(err.message))
    }
  })
}

async function setupBallotTable(): Promise<void> {
  const hasBallot = await db().schema.hasTable('ballot')
  if (!hasBallot) {
    await db().schema.createTable('ballot', (table) => {
      table.string('signing_key').unique()
      table.string('ledger_index')
      table.string('amendments', 10000)
      table.integer('base_fee')
      table.integer('reserve_base')
      table.integer('reserve_inc')
    })
  }
}
