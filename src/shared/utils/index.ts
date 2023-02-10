import axios, { AxiosRequestConfig } from 'axios'
import { normalizeManifest } from 'xrpl-validator-domains'

import { getNetworks, query } from '../database'
import { UNL, UNLBlob, UNLValidator } from '../types'

import logger from './logger'

const log = logger({ name: 'utils' })
const HTTPS_PORT = 51234

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
