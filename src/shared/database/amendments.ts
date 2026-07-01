import axios from 'axios'
import { Client } from 'xrpl'
import {
  FeatureAllResponse,
  FeatureOneResponse,
} from 'xrpl/dist/npm/models/methods/feature'

import { AmendmentInfo } from '../types'
import logger from '../utils/logger'

import {
  AmendmentClassification,
  ParsedFeaturesMacro,
  fetchAmendmentClassification,
} from './amendment-classification'
import { query } from './utils'

const log = logger({ name: 'amendments' })

const amendmentIDs = new Map<
  string,
  { name: string; retired: boolean; obsolete: boolean }
>()
const votingAmendmentsToTrack = new Set<string>()
const rippledVersions = new Map<string, string>()
/**
 * An empty parsed features.macro (used as the initial classification value).
 *
 * @returns Empty retired/obsolete/all sets.
 */
function emptyParsedMacro(): ParsedFeaturesMacro {
  return { retired: new Set(), obsolete: new Set(), all: new Set() }
}

// Retired / obsolete classification is sourced from rippled's features.macro
// (see ./amendment-classification). This is refreshed at the start of every
// fetchAmendmentInfo run.
let classification: AmendmentClassification = {
  release: emptyParsedMacro(),
  develop: emptyParsedMacro(),
}

// Note: s2 seems to be outdated. Use p2p instead.
export const NETWORKS_HOSTS = new Map([
  ['main', 'ws://p2p.livenet.ripple.com:51233'],
  ['test', 'wss://s.altnet.rippletest.net:51233'],
  ['dev', 'wss://s.devnet.rippletest.net:51233'],
])

/**
 * Fetch amendments information including id, name, and retired/obsolete status.
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
 * If the RPC returns a badFeature error, the amendment is recorded by name only
 * (its retired/obsolete flags come from the features.macro classification).
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
    addAmendmentToCache(amendmentId, feature.name)
    // If supported and not yet enabled, add to amendments_status
    if (feature.supported && !feature.enabled) {
      await ensureAmendmentStatusExists(amendmentId, network)
    }
  } catch {
    // A badFeature error means this node's rippled binary doesn't recognize the
    // amendment (usually a newer amendment than the node's version). This is a
    // node-version artifact, not a retirement/obsolescence signal, so we only
    // record the amendment by name and let the features.macro classification
    // decide its retired/obsolete flags.
    const existingInfo = (await query('amendments_info')
      .select('name')
      .where('id', amendmentId)
      .first()) as { name: string } | undefined
    const name = existingInfo?.name ?? 'Unknown'
    addAmendmentToCache(amendmentId, name)
    log.info(
      `Amendment ${amendmentId} (${name}) not recognized on ${network} (badFeature error)`,
    )
  }
}

/**
 * Fetch amendments information including id, name, and retired/obsolete status of a network.
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
    // Track supported (non-enabled) amendments for this network
    const supportedAmendments: string[] = []

    for (const id of Object.keys(featuresAll)) {
      const feature = featuresAll[id]
      addAmendmentToCache(id, feature.name)
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
 * The retired / obsolete flags are sourced from rippled's features.macro.
 *
 * @param id - The id of the amendment to add.
 * @param name - The name of the amendment to add.
 */
function addAmendmentToCache(id: string, name: string): void {
  amendmentIDs.set(id, { name, ...classify(name) })
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

/**
 * Whether an amendment is "not votable" per a single features.macro revision:
 * either rippled explicitly marks it `VoteBehavior::Obsolete`, or it is not
 * registered in that revision at all (superseded or removed).
 *
 * @param macro - A parsed features.macro revision.
 * @param name - The amendment name.
 * @returns True if the amendment is not votable in that revision.
 */
function isNotVotable(macro: ParsedFeaturesMacro, name: string): boolean {
  return macro.obsolete.has(name) || !macro.all.has(name)
}

/**
 * Compute the retired/obsolete flags for an amendment name from the current
 * classification. `retired` comes from the latest release only (so amendments
 * are not marked retired before they ship). `obsolete` requires the amendment to
 * be not-votable in BOTH the latest release AND develop, so beta amendments
 * (only in develop) and amendments still in the release are not mislabeled.
 *
 * @param name - The amendment name.
 * @returns The retired and obsolete flags.
 */
function classify(name: string): { retired: boolean; obsolete: boolean } {
  const retired = classification.release.retired.has(name)
  return {
    retired,
    obsolete:
      !retired &&
      isNotVotable(classification.release, name) &&
      isNotVotable(classification.develop, name),
  }
}

/**
 * Reclassify the retired/obsolete flags of every amendment already stored in
 * `amendments_info`. The feature RPC only returns amendments the connected node
 * still registers, so historical or seed amendments (such as removed obsolete
 * ones) would otherwise never be reclassified and keep null flags.
 *
 * @returns Void.
 */
async function reclassifyExistingAmendments(): Promise<void> {
  const rows = (await query('amendments_info').select('id', 'name')) as Array<{
    id: string
    name: string
  }>
  for (const row of rows) {
    const { retired, obsolete } = classify(row.name)
    await query('amendments_info')
      .where('id', row.id)
      .update({ retired, obsolete })
      .catch((err) => log.error('Error reclassifying amendment', err))
  }
}

export async function fetchAmendmentInfo(): Promise<void> {
  log.info('Fetch amendments info from data sources...')
  const fetchedClassification = await fetchAmendmentClassification()
  if (fetchedClassification === null) {
    log.error(
      'Could not determine retired/obsolete classification from features.macro; skipping amendment info update to avoid overwriting existing data.',
    )
    return
  }
  classification = fetchedClassification
  await fetchVotingAmendments()
  await fetchAmendmentsList()
  await fetchMinRippledVersions()
  for (const [id, value] of amendmentIDs) {
    const amendment: AmendmentInfo = {
      id,
      name: value.name,
      rippled_version: rippledVersions.get(value.name),
      retired: value.retired,
      obsolete: value.obsolete,
    }
    await saveAmendmentInfo(amendment)
  }
  // Reclassify every stored amendment (including historical/seed rows the
  // feature RPC no longer returns) so their flags stay correct.
  await reclassifyExistingAmendments()
  log.info('Finish fetching amendments info from data sources...')
}

/**
 * Clear all in-memory caches. For testing purposes only.
 */
export function clearAmendmentCaches(): void {
  amendmentIDs.clear()
  votingAmendmentsToTrack.clear()
  rippledVersions.clear()
  classification = { release: emptyParsedMacro(), develop: emptyParsedMacro() }
}
