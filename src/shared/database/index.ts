import {
  Node,
  DatabaseManifest,
  DatabaseValidator,
  Validator,
  Location,
  DatabaseNetwork,
  AmendmentStatus,
  Ballot,
  WsNode,
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
 * @param shouldOverwriteNull - If IP/port are not provided, will force update to null in DB.
 * @returns Void.
 */
export async function saveNode(
  node: Node,
  shouldOverwriteNull: boolean,
): Promise<void> {
  if (node.complete_ledgers && node.complete_ledgers.length > 255) {
    const ledgersSplit = node.complete_ledgers.split(',')
    node.complete_ledgers = ledgersSplit[ledgersSplit.length - 1]
  }

  const sanitizedMergeNode = shouldOverwriteNull
    ? { ip: null, port: null, ...node }
    : node
  query('crawls')
    .insert(node)
    .onConflict('public_key')
    .merge(sanitizedMergeNode)
    .catch((err: Error) => log.error(err.message))
}

/**
 * Get the list of nodes to establish WebSocket connection.
 *
 * @param sinceStartDate -- Date instance from which to retrieve data.
 * @returns The list of nodes.
 */
export async function getNodes(sinceStartDate: Date): Promise<WsNode[]> {
  return query('crawls as c')
    .leftJoin('connection_health as ch', 'c.public_key', 'ch.public_key')
    .select('c.ip', 'ch.ws_url', 'c.networks', 'c.public_key')
    .whereNotNull('c.ip')
    .andWhere('c.start', '>', sinceStartDate) as Promise<WsNode[]>
}

/* eslint-disable max-lines-per-function -- this method updates manifests and validators tables */
/**
 * Updates revoked column on older manifests.
 *
 * @param manifest -- Incoming manifest.
 * @returns The original manifest with the revoked column updated.
 */
export async function handleRevocations(
  manifest: DatabaseManifest,
): Promise<DatabaseManifest> {
  // Mark all older manifests as revoked
  let revokedSigningKeys
  for (let numberOfAttempts = 1; numberOfAttempts <= 3; numberOfAttempts++) {
    try {
      revokedSigningKeys = (await query('manifests')
        .where({ master_key: manifest.master_key })
        .andWhere('seq', '<', manifest.seq)
        .update({ revoked: true }, [
          'manifests.signing_key',
        ])) as DatabaseManifest[]
      break
    } catch (err: unknown) {
      // eslint-disable-next-line max-depth -- DB deadlock needs special retry logic
      if (err instanceof Error && 'code' in err && err.code === '40P01') {
        log.error(
          `Error revoking older manifests: Deadlock detected, retrying with Exponential Backoff. Current attempt: ${numberOfAttempts} of a maximum of 3 attempts.`,
          err,
        )
        // Exponential backoff
        await new Promise(function executor(resolve, _reject) {
          setTimeout(resolve, 2 ** (numberOfAttempts - 1) * 1000)
        })
        continue
      } else {
        log.error('Error revoking older manifests', err)
        break
      }
    }
  }

  const revokedSigningKeysArray =
    revokedSigningKeys && revokedSigningKeys.length > 0
      ? await Promise.all(
          revokedSigningKeys.map(async (obj) => {
            return obj.signing_key
          }),
        )
      : []

  // If there exists a newer manifest, mark this manifest as revoked
  const newer = (await query('manifests')
    .where({ master_key: manifest.master_key })
    .andWhere('seq', '>', manifest.seq)
    .catch((err) =>
      log.error(
        `Error finding newer manifests (whose sequence numbers are greater than the incoming manifest sequence number: ${manifest.seq})`,
        err,
      ),
    )) as DatabaseManifest[]

  const updated = { revoked: false, ...manifest }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- DB errors may return undefined responses
  if (newer && newer.length !== 0) {
    updated.revoked = true
    revokedSigningKeysArray.push(manifest.signing_key)
  }

  const revokedSigningKeysCleaned = revokedSigningKeysArray.filter(
    (key): key is string => key !== undefined,
  )

  // updates revocations in validators table
  await query('validators')
    .whereIn('signing_key', revokedSigningKeysCleaned)
    .update({ revoked: true })
    .catch((err) =>
      log.error('Error updating revoked manifest in validators table', err),
    )

  return updated
}
/* eslint-enable max-lines-per-function */

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
      return (
        keys as Array<{ master_key: string | null; signing_key: string }>
      ).map((key) => {
        return key.master_key ?? key.signing_key
      })
    })
    .catch((err) => {
      log.error('Error getting validator signing keys', err)
      return []
    })
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
    .then((nodes) => nodes as Node[])
    .catch((err) => {
      log.error(`Error querying nodes to locate`, err)
      return []
    })
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
    .catch((err) => log.error('Error Updating Validator', err))
}

/**
 * Saves list of amendments status on a network to the database.
 *
 * @param amendments - The list of amendments to be saved.
 * @param networks - The networks to be saved.
 */
export async function saveAmendmentsStatus(
  amendments: string[],
  networks: string | undefined,
): Promise<void> {
  amendments.forEach(async (amendment) => {
    await query('amendments_status')
      .insert({ amendment_id: amendment, networks })
      .onConflict(['amendment_id', 'networks'])
      .merge()
      .catch((err) => log.error('Error Saving Status Amendment', err))
  })
}

/**
 * Saves an amendment status on a network to the database.
 *
 * @param amendment - The amendment to be saved.
 */
export async function saveAmendmentStatus(
  amendment: AmendmentStatus,
): Promise<void> {
  await query('amendments_status')
    .insert(amendment)
    .onConflict(['amendment_id', 'networks'])
    .merge()
    .catch((err) => log.error('Error Saving Amendment Status', err))
}

/**
 * Saves a ballot to the database.
 *
 * @param ballot - The ballot to be saved.
 */
export async function saveBallot(ballot: Ballot): Promise<void> {
  await query('ballot')
    .insert(ballot)
    .onConflict('signing_key')
    .merge()
    .catch((err) => log.error('Error Saving Ballot', err))
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
