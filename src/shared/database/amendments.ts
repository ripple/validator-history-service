import axios from 'axios'
import { Client } from 'xrpl'
import {
  FeatureAllResponse,
  FeatureOneResponse,
} from 'xrpl/dist/npm/models/methods/feature'

import { AmendmentInfo } from '../types'
import logger from '../utils/logger'

import { query } from './utils'

const log = logger({ name: 'amendments' })

const amendmentIDs = new Map<string, { name: string; deprecated: boolean }>()
const votingAmendmentsToTrack = new Set<string>()
const rippledVersions = new Map<string, string>()
// TODO: Use feature RPC instead when this issue is fixed and released:
// https://github.com/XRPLF/rippled/issues/4730
const RETIRED_AMENDMENTS = [
  'MultiSign',
  'TrustSetAuth',
  'FeeEscalation',
  'PayChan',
  'CryptoConditions',
  'TickSize',
  'fix1368',
  'Escrow',
  'fix1373',
  'EnforceInvariants',
  'SortedDirectories',
  'fix1201',
  'fix1512',
  'fix1523',
  'fix1528',
]

// Note: s2 seems to be outdated. Use p2p instead.
export const NETWORKS_HOSTS = new Map([
  ['main', 'ws://p2p.livenet.ripple.com:51233'],
  ['test', 'wss://s.altnet.rippletest.net:51233'],
  ['dev', 'wss://s.devnet.rippletest.net:51233'],
])

/**
 * Fetch amendments information including id, name, and deprecated status.
 *
 * @returns Void.
 */
async function fetchAmendmentsList(): Promise<void> {
  for (const [network, url] of NETWORKS_HOSTS) {
    await fetchNetworkAmendments(network, url)
  }
}

/**
 * Fetch a single voting amendment info from the feature RPC.
 * If the RPC returns a badFeature error, mark the amendment as deprecated.
 * If the amendment is supported but not enabled, add it to amendments_status.
 *
 * @param client - The xrpl Client instance.
 * @param amendmentId - The amendment ID to fetch.
 * @param network - The network name.
 */
async function fetchSingleVotingAmendment(
  client: Client,
  amendmentId: string,
  network: string,
): Promise<void> {
  try {
    const featureOneResponse: FeatureOneResponse = await client.request({
      command: 'feature',
      feature: amendmentId,
    })
    const feature = featureOneResponse.result[amendmentId]
    addAmendmentToCache(amendmentId, feature.name, feature.supported)
    // If supported and not yet enabled, add to amendments_status
    if (feature.supported && !feature.enabled) {
      await ensureAmendmentStatusExists(amendmentId, network)
    }
  } catch {
    // badFeature error means the amendment is not supported/unknown - mark as deprecated.
    const existingInfo = (await query('amendments_info')
      .select('name')
      .where('id', amendmentId)
      .first()) as { name: string } | undefined
    const name = existingInfo?.name ?? 'Unknown'
    addAmendmentToCache(amendmentId, name, false)
    log.info(
      `Amendment ${amendmentId} (${name}) marked as deprecated on ${network} due to badFeature error`,
    )
  }
}

/**
 * Fetch amendments information including id, name, and deprecated status of a network.
 *
 * @param network - The network being retrieved.
 * @param url - The Faucet URL of the network.
 *
 * @returns Void.
 */
async function fetchNetworkAmendments(
  network: string,
  url: string,
): Promise<void> {
  try {
    log.info(`Updating amendment info for ${network}...`)
    const client = new Client(url)
    await client.connect()
    const featureAllResponse: FeatureAllResponse = await client.request({
      command: 'feature',
    })

    const featuresAll = featureAllResponse.result.features
    // Track supported (non-enabled, non-deprecated) amendments for this network
    const supportedAmendments: string[] = []

    for (const id of Object.keys(featuresAll)) {
      const feature = featuresAll[id]
      addAmendmentToCache(id, feature.name, feature.supported)
    }

    // Collect supported but not enabled amendments for amendments_status
    const supportedNotEnabled = Object.entries(featuresAll).filter(
      ([, feature]) => feature.supported && !feature.enabled,
    )
    supportedNotEnabled.forEach(([id]) => supportedAmendments.push(id))

    // Some amendments in voting are not available in feature all request.
    // This loop tries to fetch them in feature one.
    for (const amendment_id of votingAmendmentsToTrack) {
      await fetchSingleVotingAmendment(client, amendment_id, network)
    }

    await client.disconnect()

    // Insert supported amendments into amendments_status for this network
    // (only if the record doesn't already exist, to preserve eta/date data)
    await insertSupportedAmendmentsStatus(supportedAmendments, network)

    log.info(`Finished updating amendment info for ${network}...`)
  } catch (error) {
    log.error(
      `Failed to update amendment info for ${network} due to error: ${String(
        error,
      )}`,
    )
  }
}

/**
 * Insert supported amendments into amendments_status table for a network.
 * Only inserts if the record doesn't exist, to preserve existing eta/date data.
 *
 * @param amendmentIds - List of amendment IDs that are supported on the network.
 * @param network - The network name.
 */
async function insertSupportedAmendmentsStatus(
  amendmentIds: string[],
  network: string,
): Promise<void> {
  for (const amendmentId of amendmentIds) {
    await ensureAmendmentStatusExists(amendmentId, network)
  }
}

/**
 * Add an amendment to amendmentIds cache and remove it from the votingAmendmentToTrack cache.
 *
 * @param id - The id of the amendment to add.
 * @param name - The name of the amendment to add.
 * @param supported - Whether the amendment is supported by rippled (from feature RPC).
 */
function addAmendmentToCache(
  id: string,
  name: string,
  supported: boolean,
): void {
  amendmentIDs.set(id, {
    name,
    // Mark as deprecated if it's in RETIRED_AMENDMENTS list OR if not supported
    deprecated: RETIRED_AMENDMENTS.includes(name) || !supported,
  })
  votingAmendmentsToTrack.delete(id)
}

/**
 * Fetch amendments in voting.
 *
 * @returns Void.
 */
async function fetchVotingAmendments(): Promise<void> {
  const votingDb = await query('ballot')
    .select('amendments')
    .then(async (res) =>
      (res as Array<{ amendments: string | null }>).map(
        (vote: { amendments: string | null }) => vote.amendments,
      ),
    )
  for (const amendmentsDb of votingDb) {
    if (!amendmentsDb) {
      continue
    }
    const amendments = amendmentsDb.split(',')
    for (const amendment of amendments) {
      votingAmendmentsToTrack.add(amendment)
    }
  }
}

/**
 * Fetches the versions when amendments were first introduced using XRPScan API.
 *
 * @returns Void.
 */
async function fetchMinRippledVersions(): Promise<void> {
  try {
    const response = await axios.get(
      `https://api.xrpscan.com/api/v1/amendments`,
    )
    const amendments = response.data as Array<{
      name: string
      introduced?: string
    }>

    amendments.forEach((amendment) => {
      if (amendment.name && amendment.introduced) {
        rippledVersions.set(amendment.name, amendment.introduced)
      }
    })
  } catch (err) {
    log.error('Error getting amendment rippled versions', err)
  }
}

/**
 * Saves a validator to the database.
 *
 * @param amendment - The amendment to be saved.
 * @returns Void.
 */
export async function saveAmendmentInfo(
  amendment: AmendmentInfo,
): Promise<void> {
  await query('amendments_info')
    .insert(amendment)
    .onConflict('id')
    .merge()
    .catch((err) => log.error('Error Saving AmendmentInfo', err))
}

/**
 * Delete an amendment incoming when majority is lost or when the amendment is enabled.
 *
 * @param amendment_id -- The id of the amendment incoming to delete.
 * @param networks -- The networks of the amendment being voted.
 */
export async function deleteAmendmentStatus(
  amendment_id: string,
  networks: string,
): Promise<void> {
  await query('amendments_status')
    .del()
    .where('amendment_id', '=', amendment_id)
    .andWhere('networks', '=', networks)
    .catch((err) => log.error('Error Saving Amendment Status', err))
}

/**
 * Ensure an amendment status record exists for the given (amendment_id, network) combo.
 * This inserts a record with null eta/date if it doesn't exist yet,
 * but does NOT overwrite existing records to preserve eta/date data.
 *
 * @param amendment_id -- The id of the amendment.
 * @param network -- The network where the amendment is supported.
 */
async function ensureAmendmentStatusExists(
  amendment_id: string,
  network: string,
): Promise<void> {
  // Only insert if the record doesn't already exist (to preserve eta/date)
  await query('amendments_status')
    .insert({
      amendment_id,
      networks: network,
      ledger_index: null,
      tx_hash: null,
      eta: null,
      date: null,
    })
    .onConflict(['amendment_id', 'networks'])
    .ignore()
    .catch((err) => log.error('Error ensuring amendment status exists', err))
}

export async function fetchAmendmentInfo(): Promise<void> {
  log.info('Fetch amendments info from data sources...')
  await fetchVotingAmendments()
  await fetchAmendmentsList()
  await fetchMinRippledVersions()
  amendmentIDs.forEach(async (value, id) => {
    const amendment: AmendmentInfo = {
      id,
      name: value.name,
      rippled_version: rippledVersions.get(value.name),
      deprecated: value.deprecated,
    }
    await saveAmendmentInfo(amendment)
  })
  log.info('Finish fetching amendments info from data sources...')
}
