import axios from 'axios'
import createHash from 'create-hash'

import { AmendmentInfo } from '../types'
import logger from '../utils/logger'

import { query } from './utils'

const log = logger({ name: 'amendments' })

const amendmentIDs = new Map<string, { name: string; deprecated: boolean }>()
const rippledVersions = new Map<string, string>()

const ACTIVE_AMENDMENT_REGEX =
  /^\s*REGISTER_F[A-Z]+\s*\((?<amendmentName>\S+),\s*.*$/u
const RETIRED_AMENDMENT_REGEX =
  /^ .*retireFeature\("(?<amendmentName>\S+)"\)[,;].*$/u

const AMENDMENT_VERSION_REGEX =
  /\| \[(?<amendmentName>[a-zA-Z0-9_]+)\][^\n]+\| (?<version>v[0-9]*\.[0-9]*\.[0-9]*|TBD) *\|/u

// TODO: Clean this up when this PR is merged:
// https://github.com/XRPLF/rippled/pull/4781
/**
 * Fetch a list of amendments names from rippled file.
 *
 * @returns The list of amendment names.
 */
async function fetchAmendmentNames(): Promise<Map<string, boolean> | null> {
  try {
    const response = await axios.get(
      'https://raw.githubusercontent.com/ripple/rippled/develop/src/ripple/protocol/impl/Feature.cpp',
    )
    const text = response.data
    const amendmentNames: Map<string, boolean> = new Map()
    text.split('\n').forEach((line: string) => {
      const name = ACTIVE_AMENDMENT_REGEX.exec(line)
      if (name) {
        amendmentNames.set(name[1], name[0].includes('VoteBehavior::Obsolete'))
      } else {
        const name2 = RETIRED_AMENDMENT_REGEX.exec(line)
        if (name2) {
          amendmentNames.set(name2[1], true)
        }
      }
    })
    return amendmentNames
  } catch (err) {
    log.error('Error getting amendment names', err)
    return null
  }
}

/**
 * Extracts Amendment ID from Amendment name inside a buffer.
 *
 * @param buffer -- The buffer containing the amendment name.
 *
 * @returns The amendment ID string.
 */
function sha512Half(buffer: Buffer): string {
  return createHash('sha512')
    .update(buffer)
    .digest('hex')
    .toUpperCase()
    .slice(0, 64)
}

/**
 * Maps the id of Amendments to its corresponding names.
 *
 * @returns Void.
 */
async function nameOfAmendmentID(): Promise<void> {
  // The Amendment ID is the hash of the Amendment name
  const amendmentNames = await fetchAmendmentNames()
  if (amendmentNames !== null) {
    amendmentNames.forEach((deprecated, name) => {
      amendmentIDs.set(sha512Half(Buffer.from(name, 'ascii')), {
        name,
        deprecated,
      })
    })
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
      'https://raw.githubusercontent.com/XRPLF/xrpl-dev-portal/b3cb2c667a03f0b043989958706497bf54c74cc2/resources/known-amendments.md',
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
  await nameOfAmendmentID()
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
