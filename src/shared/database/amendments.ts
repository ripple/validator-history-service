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

const AMENDMENT_VERSION_REGEX =
  /\| \[(?<amendmentName>[a-zA-Z0-9_]+)\][^\n]+\| (?<version>v[0-9]*\.[0-9]*\.[0-9]*|TBD) *\|/u

export const NETWORKS_HOSTS = new Map([
  ['main', 'ws://s2.ripple.com:51233'],
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
    const featureResponse: FeatureAllResponse = await client.request({
      command: 'feature',
    })

    const features = featureResponse.result.features

    for (const id of Object.keys(features)) {
      amendmentIDs.set(id, {
        name: features[id].name,
        deprecated: RETIRED_AMENDMENTS.includes(features[id].name),
      })
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
 * Find an amendment info from a network and add to current map.
 *
 * @param amendment_id - The id of the amendment to fetch.
 * @param url - The Faucet URL of the network.
 *
 * @returns True if the amendment is found, false otherwise.
 */
async function findSingleAmendment(
  amendment_id: string,
  url: string,
): Promise<boolean> {
  try {
    log.info(`Updating amendment info for ${amendment_id}...`)
    const client = new Client(url)
    await client.connect()
    const featureResponse: FeatureOneResponse | ErrorResponse =
      await client.request({
        command: 'feature',
        feature: amendment_id,
      })

    if ('result' in featureResponse) {
      const feature = featureResponse.result[amendment_id]
      amendmentIDs.set(amendment_id, {
        name: feature.name,
        deprecated: RETIRED_AMENDMENTS.includes(feature.name),
      })
      return true
    }

    await client.disconnect()
    return false
  } catch (_error) {
    return false
  }
}

/**
 * Fetch for a single amendment across networks. Returns when the first one is found.
 *
 * @param amendment_id - The id of the amendment to search.
 *
 * @returns Void.
 */
async function fetchSingleAmendmentFromNetworks(
  amendment_id: string,
): Promise<void> {
  for (const url of Object.values(NETWORKS_HOSTS)) {
    const found = await findSingleAmendment(amendment_id, url)
    if (found) {
      break
    }
  }
}

/**
 * Fetch amendments in voting that are not available in feature-all RPC.
 *
 * @returns Void.
 */
async function fetchMissingAmendments(): Promise<void> {
  const voting = new Set<string>()
  const votingDb = await query('ballot')
    .select('amendments')
    .then(async (res) =>
      res.map((vote: { amendments: string | null }) => vote.amendments),
    )
  for (const amendmentsDb of votingDb) {
    if (!amendmentsDb) {
      continue
    }
    const amendments = amendmentsDb.split(',')
    for (const amendment of amendments) {
      voting.add(amendment)
    }
  }
  for (const amendment of voting) {
    if (!amendmentIDs.has(amendment)) {
      await fetchSingleAmendmentFromNetworks(amendment)
    }
  }
}

/**
 * Fetches the versions when amendments are first enabled.
 *
 * @returns Void.
 */
async function fetchMinRippledVersions(): Promise<void> {
  try {
    const response = await axios.get(
      'https://raw.githubusercontent.com/XRPLF/xrpl-dev-portal/master/resources/known-amendments.md',
    )
    const text = response.data

    text.split('\n').forEach((line: string) => {
      const found = AMENDMENT_VERSION_REGEX.exec(line)
      if (found) {
        rippledVersions.set(
          found[1],
          found[2].startsWith('v') ? found[2].slice(1) : found[2],
        )
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
  await fetchAmendmentsList()
  await fetchMissingAmendments()
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
