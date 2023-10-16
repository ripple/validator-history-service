import axios, { AxiosRequestConfig } from 'axios'
import { normalizeManifest } from 'xrpl-validator-domains'

import { getNetworks, query } from '../database'
import { UNL, UNLBlob, UNLValidator } from '../types'

import logger from './logger'

const log = logger({ name: 'utils' })
const HTTPS_PORT = 51234
const RIPPLE_EPOCH_DIFF = 946684800

/**
 * Fetches the UNL.
 *
 * @param url - The url of the validator list being fetched.
 * @returns A promise that resolves to a parsed UNLBlob.
 */
export async function fetchValidatorList(url: string): Promise<UNLBlob> {
  try {
    const resp = await axios.get(`http://${url}`)
    const unl: UNL = resp.data
    const buf = Buffer.from(unl.blob, 'base64')
    const blobParsed: UNLBlob = JSON.parse(buf.toString('ascii'))
    return blobParsed
  } catch (err: unknown) {
    log.error(`Error fetching validator List for ${url}`, err)
    return Promise.reject()
  }
}

/**
 * Get the network entry node's url for a validator.
 *
 * @param key - The public key of the validator.
 * @returns A promise that resolves to the network entry url string.
 */
async function getNetworksEntryUrl(key: string): Promise<string | null> {
  const networkDb = await query('validators')
    .select('networks')
    .where('master_key', key)
    .orWhere('signing_key', key)
  const network = networkDb[0]?.networks
  if (network !== null) {
    const entry = await query('networks').select('entry').where('id', network)
    return `https://${entry[0]?.entry as string}:${HTTPS_PORT}`
  }
  return null
}

/**
 * Fetches the manifest for the public key (master or signing) from rippled.
 *
 * @param key - The public key being queried.
 * @returns A promise that resolves the a hex string representation of the manifest.
 * @throws When http request fails.
 */
export async function fetchRpcManifest(
  key: string,
): Promise<string | undefined> {
  const url = await getNetworksEntryUrl(key)
  if (url === null) {
    return undefined
  }
  const data = JSON.stringify({
    method: 'manifest',
    params: [{ public_key: `${key}` }],
  })
  const params: AxiosRequestConfig = {
    method: 'post',
    url,
    headers: {
      'Content-Type': 'application/json',
    },
    data,
  }

  try {
    const response = await axios(params)
    const manifestB64 = response.data.result?.manifest
    if (manifestB64) {
      const manifestHex = Buffer.from(manifestB64, 'base64')
        .toString('hex')
        .toUpperCase()
      return manifestHex
    }
    return undefined
  } catch {
    return Promise.resolve(undefined)
  }
}

/**
 * Helper to convert UNLblob to set of validator signing keys.
 *
 * @param blob - The UNL blob to be converted.
 * @returns The set of validator signing keys.
 */
function blobToValidators(blob: UNLBlob): Set<string> {
  const ret: Set<string> = new Set()
  blob.validators.forEach((val: UNLValidator) => {
    const manifestHex = Buffer.from(val.manifest, 'base64')
      .toString('hex')
      .toUpperCase()
    const manifest = normalizeManifest(manifestHex)
    if (manifest.signing_key) {
      ret.add(manifest.signing_key)
    }
  })
  return ret
}

/**
 * Returns core validator lists (mainnet, testnet, devnet).
 *
 * @returns An array of sets containing the signing keys of validators on each list.
 */
export async function getLists(): Promise<Record<string, Set<string>>> {
  const lists = {}
  const promises: Array<Promise<void>> = []
  const networks = await getNetworks()
  networks.forEach(async (network) => {
    if (!network.unls[0]) {
      return
    }
    promises.push(
      fetchValidatorList(network.unls[0]).then((blob) => {
        Object.assign(lists, {
          [network.id]: blobToValidators(blob),
        })
      }),
    )
  })
  await Promise.all(
    // The error has already been logged in fetchValidatorList
    promises.map(async (promise) => promise.catch(async (err) => err)),
  )
  return lists
}

/**
 * Helper function that returns true there exists at least 1 overlap in two sets of strings. Undefined is ignored.
 *
 * @param set1 - Set of signing keys of validators in the first chain.
 * @param set2 - Set of signing keys of validators in the second chain.
 * @returns A boolean indicating whether there is overlap.
 */
export function overlaps(
  set1: Set<string | undefined>,
  set2: Set<string | undefined>,
): boolean {
  for (const str of set1) {
    if (str && set2.has(str)) {
      return true
    }
  }
  return false
}

/**
 * Convert a ripple timestamp to a unix timestamp.
 *
 * @param rpepoch - (seconds since 1/1/2000 GMT).
 * @returns Milliseconds since unix epoch.
 */
export function rippleTimeToUnixTime(rpepoch: number): number {
  return (rpepoch + RIPPLE_EPOCH_DIFF) * 1000
}

/**
 * Determines whether the source rippled version is not later than the target rippled version.
 * Example usage: isNotLaterRippledVersion('1.10.0', '1.11.0') returns true.
 *                IsNotLaterRippledVersion('1.10.0', '1.10.0-b1') returns false.
 *
 * @param source -- The source rippled version.
 * @param target -- The target rippled version.
 * @returns True if source is earlier than target, false otherwise.
 */
// eslint-disable-next-line max-statements, max-lines-per-function, complexity -- Disabled for this util function.
export function isEarlierVersion(
  source: string | null | undefined,
  target: string | null | undefined,
): boolean {
  if (source === target) {
    return false
  }
  if (source === 'TBD' || !source) {
    return false
  }
  if (target === 'TBD' || !target) {
    return true
  }
  const sourceDecomp = source.split('.')
  const targetDecomp = target.split('.')
  const sourceMajor = parseInt(sourceDecomp[0], 10)
  const sourceMinor = parseInt(sourceDecomp[1], 10)
  const targetMajor = parseInt(targetDecomp[0], 10)
  const targetMinor = parseInt(targetDecomp[1], 10)
  // Compare major version
  if (sourceMajor !== targetMajor) {
    return sourceMajor < targetMajor
  }
  // Compare minor version
  if (sourceMinor !== targetMinor) {
    return sourceMinor < targetMinor
  }
  const sourcePatch = sourceDecomp[2].split('-')
  const targetPatch = targetDecomp[2].split('-')

  const sourcePatchVersion = parseInt(sourcePatch[0], 10)
  const targetPatchVersion = parseInt(targetPatch[0], 10)

  // Compare patch version
  if (sourcePatchVersion !== targetPatchVersion) {
    return sourcePatchVersion < targetPatchVersion
  }

  // Compare release version
  if (sourcePatch.length !== targetPatch.length) {
    return sourcePatch.length > targetPatch.length
  }

  if (sourcePatch.length === 2) {
    // Compare different release types
    if (!sourcePatch[1][0].startsWith(targetPatch[1][0])) {
      return sourcePatch[1] < targetPatch[1]
    }
    // Compare beta version
    if (sourcePatch[1].startsWith('b')) {
      return (
        parseInt(sourcePatch[1].slice(1), 10) <
        parseInt(targetPatch[1].slice(1), 10)
      )
    }
    // Compare rc version
    return (
      parseInt(sourcePatch[1].slice(2), 10) <
      parseInt(targetPatch[1].slice(2), 10)
    )
  }

  return false
}
