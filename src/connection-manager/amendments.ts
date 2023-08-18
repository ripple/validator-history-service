import axios from 'axios'
import createHash from 'create-hash'

import { query } from '../shared/database/utils'
import { AmendmentsInfo } from '../shared/types'
import logger from '../shared/utils/logger'

const log = logger({ name: 'amendments' })

const cachedAmendmentIDs = new Map<string, string>()
const cachedRippledVersions = new Map<string, string>()

// TODO: fix these regex linting issues later.
// eslint-disable-next-line prefer-named-capture-group, require-unicode-regexp -- Bypass for now.
const ACTIVE_AMENDMENT_REGEX = /^\s*REGISTER_F[A-Z]+\s*\((\S+),\s*.*$/
// eslint-disable-next-line prefer-named-capture-group, require-unicode-regexp -- Bypass for now.
const RETIRED_AMENDMENT_REGEX = /^ .*retireFeature\("(\S+)"\)[,;].*$/

export const staleAmendmentsData = {
  staleName: false,
  staleVersion: false,
}

/**
 * Fetch a list of amendments names from rippled file.
 *
 * @returns The list of amendment names.
 */
async function fetchAmendmentNames(): Promise<string[] | undefined> {
  try {
    const response = await axios.get(
      'https://raw.githubusercontent.com/ripple/rippled/develop/src/ripple/protocol/impl/Feature.cpp',
    )
    const text = response.data
    staleAmendmentsData.staleName = false
    const amendmentNames: string[] = []
    text.split('\n').forEach((line: string) => {
      const name = ACTIVE_AMENDMENT_REGEX.exec(line)
      if (name) {
        amendmentNames.push(name[1])
      } else {
        const name2 = RETIRED_AMENDMENT_REGEX.exec(line)
        if (name2) {
          amendmentNames.push(name2[1])
        }
      }
    })
    return amendmentNames
  } catch (err) {
    staleAmendmentsData.staleName = true
    log.error('Error getting amendment names', err)
    return undefined
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
  if (amendmentNames !== undefined) {
    amendmentNames.forEach((name) => {
      cachedAmendmentIDs.set(sha512Half(Buffer.from(name, 'ascii')), name)
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
      'https://raw.githubusercontent.com/XRPLF/xrpl-dev-portal/master/content/concepts/consensus-network/amendments/known-amendments.md',
    )
    const text = response.data
    staleAmendmentsData.staleVersion = false
    const regex =
      // eslint-disable-next-line prefer-named-capture-group, require-unicode-regexp -- Bypass for now.
      /\| \[([a-zA-Z0-9_]+)\][^\n]+\| (v[0-9]*.[0-9]*.[0-9]*|TBD) *\|/

    text.split('\n').forEach((line: string) => {
      const found = regex.exec(line)
      if (found) {
        cachedRippledVersions.set(
          found[1],
          found[2].startsWith('v') ? found[2].slice(1) : found[2],
        )
      }
    })
  } catch (err) {
    staleAmendmentsData.staleVersion = true
    log.error('Error getting amendment rippled versions', err)
  }
}

/**
 * Saves a validator to the database.
 *
 * @param amendment - The amendment to be saved.
 * @returns Void.
 */
async function saveAmendmentInfo(amendment: AmendmentsInfo): Promise<void> {
  await query('amendments_info')
    .insert(amendment)
    .onConflict('id')
    .merge()
    .catch((err) => log.error('Error Saving AmendmentInfo', err))
}

export default async function fetchAmendmentInfo(): Promise<void> {
  await nameOfAmendmentID()
  await fetchMinRippledVersions()
  cachedAmendmentIDs.forEach(async (name: string, id: string) => {
    const amendment: AmendmentsInfo = {
      id,
      name,
      rippled_version: cachedRippledVersions.get(name),
    }
    await saveAmendmentInfo(amendment)
  })
}
