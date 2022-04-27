/* eslint-disable max-lines -- This file creates many tables so it requires many lines. */
import knex, { QueryBuilder } from 'knex'

import {
  Node,
  DatabaseManifest,
  HourlyAgreement,
  DatabaseValidator,
  Validator,
  DailyAgreement,
  AgreementScore,
  Location,
  Chain,
} from '../types'
import { getLists, overlaps } from '../utils'
import config from '../utils/config'
import logger from '../utils/logger'

const log = logger({ name: 'database' })

let lists: Record<string, Set<string>> | undefined

getLists()
  .then((ret) => {
    lists = ret
  })
  .catch((err) => log.error('Error getting validator lists', err))
let knexDb: knex | undefined

/**
 * Gets an instance of knex connection.
 *
 * @returns Knex instance.
 */
export function db(): knex {
  if (knexDb) {
    return knexDb
  }

  knexDb = knex(config.db)

  return knexDb
}

const IP_REGEX = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/u
/**
 * Setup tables in database.
 *
 * @returns Promise that creates tables in database.
 */
export async function setupTables(): Promise<void> {
  await setupCrawlsTable()
  await setupLocationTable()
  await setupManifestTable()
  await setupLedgersTable()
  await setupValidatorsTable()
  await setupHourlyAgreementTable()
  await setupDailyAgreementTable()
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
      table.string('master_key')
      table.dateTime('start')
      table.json('agreement')
      table.primary(['master_key', 'start'])
    })
  }
}

async function setupDailyAgreementTable(): Promise<void> {
  const hasDailyAgreement = await db().schema.hasTable('daily_agreement')
  if (!hasDailyAgreement) {
    await db().schema.createTable('daily_agreement', (table) => {
      table.string('master_key')
      table.dateTime('day')
      table.json('agreement')
      table.primary(['master_key', 'day'])
    })
  }
}

/**
 * Deletes tables in Database.
 *
 * @returns Promise that resolves to void.
 */
export async function tearDown(): Promise<void> {
  await db()
    .schema.dropTableIfExists('location')
    .dropTableIfExists('crawls')
    .dropTableIfExists('manifests')
}

/**
 * Query the database.
 *
 * @param tbName - Name of table to query.
 * @returns Knex query builder.
 */
export function query(tbName: string): QueryBuilder {
  return db()(tbName)
}

/**
 * Destroy database connection.
 *
 * @returns Promise that destroys database connection.
 */
export async function destroy(): Promise<void> {
  return db().destroy()
}

/**
 * Saves a Node to database.
 *
 * @param node - Node to write to database.
 * @returns Void.
 */
export async function saveNode(node: Node): Promise<void> {
  if (node.complete_ledgers && node.complete_ledgers.length > 255) {
    const ledgersSplit = node.complete_ledgers.split(',')
    node.complete_ledgers = ledgersSplit[ledgersSplit.length - 1]
  }
  query('crawls')
    .insert(node)
    .onConflict('public_key')
    .merge()
    .catch((err: Error) => log.error(err.message))
}

/**
 * Saves the Websocket URL of a rippled node.
 *
 * @param url - Websocket URL of a rippled node.
 * @param connected - Boolean value representing whether we are currently connected to this node.
 * @returns Void.
 */
export async function saveNodeWsUrl(
  url: string,
  connected: boolean,
): Promise<void> {
  const ip_match = IP_REGEX.exec(url)
  if (ip_match) {
    query('crawls')
      .where({
        ip: ip_match[0],
      })
      .update({
        ws_url: url,
        connected,
      })
      .catch((err: Error) => log.error(err.message))
  } else {
    log.warn('Invalid websocket url')
  }
}

/**
 * Sets connected column to false.
 *
 * @returns Promise that resolves to void.
 *
 */
export async function clearConnectionsDb(): Promise<void> {
  try {
    await query('crawls').update({
      connected: false,
    })
  } catch (err) {
    log.error('Error clearing connections', err)
  }
}

/**
 * Updates revoked column on older manifests.
 *
 * @param manifest -- Incoming manifest.
 * @returns The original manifest with the revoked column updated.
 *
 */
async function handleRevocations(
  manifest: DatabaseManifest,
): Promise<DatabaseManifest> {
  // Mark all older manifests as revoked
  const revokedSigningKeys = await query('manifests')
    .where({ master_key: manifest.master_key })
    .andWhere('seq', '<', manifest.seq)
    .update({ revoked: true }, ['manifests.signing_key'])
    .catch((err: Error) => log.error('Error revoking older manifests', err))

  const revokedSigningKeysArray = revokedSigningKeys
    ? await Promise.all(
        revokedSigningKeys.map(async (obj) => {
          return obj.signing_key
        }),
      )
    : []

  // If there exists a newer manifest, mark this manifest as revoked
  const newer = await query('manifests')
    .where({ master_key: manifest.master_key })
    .andWhere('seq', '>', manifest.seq)
    .catch((err) => log.error('Error revoking current manifest', err))

  const updated = { revoked: false, ...manifest }

  if (newer.length !== 0) {
    updated.revoked = true
    revokedSigningKeysArray.push(manifest.signing_key)
  }

  // updates revocations in validators table
  await query('validators')
    .whereIn(['signing_key'], revokedSigningKeysArray)
    .update({ revoked: true })

  return updated
}

/**
 * Saves a Manifest to database.
 *
 * @param manifest - Manifest to write to database.
 * @returns Void.
 */
export async function saveManifest(manifest: DatabaseManifest): Promise<void> {
  const updated = await handleRevocations(manifest)
  await query('manifests')
    .insert(updated)
    .onConflict(['master_signature'])
    .merge()
    .catch((err) => log.error('Error Saving Manifest', err))
}

/**
 * Returns all validator signing keys.
 *
 * @returns An array of all master keys.
 */
export async function getValidatorSigningKeys(): Promise<string[]> {
  return query('validators')
    .select('signing_key')
    .then(async (keys) => {
      return keys.map((key: { signing_key: string }) => {
        return key.signing_key
      })
    })
    .catch((err) => log.error('Error getting validator signing keys', err))
}
/**
 * Saves a Location to database.
 *
 * @param location - Location to write to database.
 * @returns Void.
 */
export async function saveLocation(location: Location): Promise<void> {
  query('location')
    .insert(location)
    .onConflict('public_key')
    .merge()
    .catch((err) => log.error('Error saving location', err))
}

/**
 * Saves an hourly agreement score to agreement table.
 *
 * @param agreement - Agreement score.
 * @returns Void.
 */
export async function saveHourlyAgreement(
  agreement: HourlyAgreement,
): Promise<void> {
  query('hourly_agreement')
    .insert(agreement)
    .onConflict(['master_key', 'start'])
    .merge()
    .catch((err: Error) => log.error('Error saving Hourly Agreement', err))
}

/**
 * Saves an daily agreement score to daily agreement table.
 *
 * @param agreement - Agreement score.
 * @returns Void.
 */
export async function saveDailyAgreement(
  agreement: DailyAgreement,
): Promise<void> {
  query('daily_agreement')
    .insert(agreement)
    .onConflict(['master_key', 'day'])
    .merge()
    .catch((err) => log.error('Error saving Daily Agreement', err))
}

/**
 * Calculate agreement scores for a validator.
 *
 * @param validator - Validator to get agreement score.
 * @param start - Start time for agreement score.
 * @param end - End time for agreement score.
 * @returns Agreement Score for validator between start and end.
 */
export async function getAgreementScores(
  validator: string,
  start: Date,
  end: Date,
): Promise<AgreementScore> {
  const agreement = await getHourlyAgreementScores(validator, start, end)

  return calculateAgreementScore(agreement)
}

/**
 * Maps a signing key to a master key.
 *
 * @param signing_key - Signing key to look up.
 * @returns String or undefined if not found.
 */
export async function signingToMaster(
  signing_key: string,
): Promise<string | undefined> {
  return query('manifests')
    .select('master_key')
    .where({ signing_key })
    .then(async (resp) => resp[0]?.master_key)
    .catch((err) => log.error('Error finding master key from signing key', err))
}

/**
 * Get all hourly agreement scores for a validator.
 *
 * @param validator - Validator to get agreement score.
 * @param start - Start time for agreement score.
 * @param end - End time for agreement score.
 * @returns Hourly Agreement for validator between start and end.
 */
async function getHourlyAgreementScores(
  validator: string,
  start: Date,
  end: Date,
): Promise<AgreementScore[]> {
  return query('hourly_agreement')
    .select(['agreement'])
    .where({ master_key: validator })
    .where('start', '>', start)
    .where('start', '<', end)
    .then(async (scores) =>
      scores.map((score: { agreement: AgreementScore }) => score.agreement),
    )
}

/**
 * Calculates an agreement score from a list of AgreementScores.
 *
 * @param scores - List of AgreementScores.
 * @returns Agreement Score for all scores.
 */
function calculateAgreementScore(scores: AgreementScore[]): AgreementScore {
  const result: AgreementScore = {
    validated: 0,
    missed: 0,
    incomplete: false,
  }

  scores.forEach((score) => {
    result.validated += score.validated
    result.missed += score.missed
    result.incomplete = result.incomplete || score.incomplete
  })

  return result
}

/**
 *  Updates a validator's 1 hour agreement score.
 *
 * @param master_key - Signing key of the the validator to be updated.
 * @param agreement - An agreement object.
 * @returns A promise that resolves to void once the agreement has been stored.
 */
export async function update1HourValidatorAgreement(
  master_key: string,
  agreement: AgreementScore,
): Promise<void> {
  await query('validators')
    .where({ master_key })
    .update({ agreement_1hour: agreement })
    .catch((err) => log.error('Error Updating 1 Hour Validator Agreement', err))
}
/**
 *  Updates the validator's 24 hour agreement score.
 *
 * @param master_key - Signing key of the the validator to be updated.
 * @param agreement - An agreement object.
 * @returns A promise that resolves to void once the agreement has been stored.
 */
export async function update24HourValidatorAgreement(
  master_key: string,
  agreement: AgreementScore,
): Promise<void> {
  await query('validators')
    .where({ master_key })
    .update({ agreement_24hour: agreement })
    .catch((err) =>
      log.error('Error updating 24 Hour Validator Agreement', err),
    )
}

/**
 *  Updates the validator's 30 day agreement score.
 *
 * @param master_key - Signing key of the the validator to be updated.
 * @param agreement - An agreement object.
 * @returns A promise that resolves to void once the agreement has been stored.
 */
export async function update30DayValidatorAgreement(
  master_key: string,
  agreement: AgreementScore,
): Promise<void> {
  await query('validators')
    .where({ master_key })
    .update({ agreement_30day: agreement })
    .catch((err) => log.error('Error updating 30 Day Validator Agreement', err))
}

/**
 * Reads nodes from database.
 *
 * @returns Nodes that haven't been queried in the last six days.
 */
export async function getNodesToLocate(): Promise<Node[]> {
  const sixDaysAgo = new Date()
  sixDaysAgo.setDate(sixDaysAgo.getDate() - 6)

  return query('crawls')
    .select(['crawls.public_key', 'crawls.ip'])
    .fullOuterJoin('location', 'crawls.public_key', 'location.public_key')
    .whereNotNull('crawls.ip')
    .andWhere((knexQuery) => {
      void knexQuery
        .whereNull('location.updated')
        .orWhere('location.updated', '<', sixDaysAgo)
    })
    .catch((err) => log.error(`Error querying nodes to locate`, err))
}

/**
 * Saves a validator to the database.
 *
 * @param validator - The validator to be saved.
 */
export async function saveValidator(
  validator: DatabaseValidator | Validator,
): Promise<void> {
  await query('validators')
    .insert(validator)
    .onConflict('signing_key')
    .merge()
    .catch((err) => log.error('Error Saving Validator', err))
}

/**
 * Deletes old hourly scores.
 *
 * @returns Deletes hourly scores older that 30 days.
 */
export async function purgeHourlyAgreementScores(): Promise<void> {
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  await query('hourly_agreement')
    .delete('*')
    .where('start', '<', thirtyDaysAgo)
    .catch((err) => log.error('Error Purging Hourly Agreement Scores', err))
}

/**
 * Saves the chain id for each validator known to be in a given chain.
 *
 * @param chain - A chain object.
 * @returns Void.
 */
export async function saveValidatorChains(chain: Chain): Promise<void> {
  let id = chain.id
  if (lists != null) {
    Object.entries(lists).forEach(([network, set]) => {
      if (overlaps(chain.validators, set)) {
        id = network
      }
    })
  }

  const promises: QueryBuilder[] = []
  chain.validators.forEach((signing_key) => {
    promises.push(
      query('validators').where({ signing_key }).update({ chain: id }),
    )
  })
  try {
    await Promise.all(promises)
  } catch (err: unknown) {
    log.error('Error saving validator chains', err)
  }
}
