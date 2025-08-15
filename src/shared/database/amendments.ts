import axios from 'axios'
import { Client, ErrorResponse } from 'xrpl'
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

export const NETWORKS_HOSTS = new Map([
  ['main', 'wss://xrplcluster.com'],
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

    for (const id of Object.keys(featuresAll)) {
      addAmendmentToCache(id, featuresAll[id].name)
    }

    // Some amendments in voting are not available in feature all request.
    // This loop tries to fetch them in feature one.
    for (const amendment_id of votingAmendmentsToTrack) {
      const featureOneResponse: FeatureOneResponse | ErrorResponse =
        await client.request({
          command: 'feature',
          feature: amendment_id,
        })

      // eslint-disable-next-line max-depth -- The depth is only 2, try catch should not count.
      if ('result' in featureOneResponse) {
        const feature = featureOneResponse.result[amendment_id]
        addAmendmentToCache(amendment_id, feature.name)
      }
    }

    await client.disconnect()

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
 * Add an amendment to amendmentIds cache and remove it from the votingAmendmentToTrack cache.
 *
 * @param id - The id of the amendment to add.
 * @param name - The name of the amendment to add.
 */
function addAmendmentToCache(id: string, name: string): void {
  amendmentIDs.set(id, {
    name,
    deprecated: RETIRED_AMENDMENTS.includes(name),
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
