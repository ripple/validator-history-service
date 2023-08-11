import {
  Node,
  DatabaseManifest,
  DatabaseValidator,
  Validator,
  Location,
  DatabaseNetwork,
} from '../types'
import logger from '../utils/logger'

import {
  saveHourlyAgreement,
  saveDailyAgreement,
  getAgreementScores,
  signingToMaster,
  update1HourValidatorAgreement,
  update24HourValidatorAgreement,
  update30DayValidatorAgreement,
  decodeServerVersion,
} from './agreement'
import { Network } from './networks'
import setupTables from './setup'
import { db, tearDown, query, destroy } from './utils'

const log = logger({ name: 'database' })
const IP_REGEX = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/u

/**
 * Get the list of networks.
 *
 * @returns The list of networks.
 */
export async function getNetworks(): Promise<Network[]> {
  return query('networks')
    .select('*')
    .then((resp: DatabaseNetwork[]) => {
      return resp.map((network) => {
        return {
          ...network,
          unls: network.unls.split(','),
        }
      })
    })
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
    log.warn(`Invalid websocket url: ${url}`)
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
 * Returns all validator master/signing keys.
 *
 * @returns An array of all master/signing keys.
 */
export async function getValidatorKeys(): Promise<string[]> {
  return query('validators')
    .select('master_key', 'signing_key')
    .then(async (keys) => {
      return keys.map(
        (key: { master_key: string | null; signing_key: string }) => {
          return key.master_key ?? key.signing_key
        },
      )
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

  // set revoked to false only if revoked doesn't exist
  // (this prevents someone from messing with data by submitting
  // bad validations with an old signing key)
  await query('validators')
    .where({ signing_key: validator.signing_key, revoked: null })
    .update({ revoked: false })
}

/**
 * Saves list of amendments enabled on a network to the database.
 *
 * @param amendments - The list of amendments to be saved.
 * @param networks - The networks to be saved.
 */
export async function saveAmendmentsEnabled(
  amendments: string[],
  networks: string | undefined,
): Promise<void> {
  amendments.forEach(async (amendment) => {
    await query('amendments_enabled')
      .insert({ amendment_id: amendment, networks })
      .onConflict(['amendment_id', 'networks'])
      .merge()
      .catch((err) => log.error('Error Saving Enabled Amendment', err))
  })
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

export {
  db,
  setupTables,
  tearDown,
  query,
  destroy,
  saveHourlyAgreement,
  saveDailyAgreement,
  getAgreementScores,
  signingToMaster,
  update1HourValidatorAgreement,
  update24HourValidatorAgreement,
  update30DayValidatorAgreement,
  decodeServerVersion,
}
