import axios, { AxiosRequestConfig } from 'axios'
import { normalizeManifest } from 'xrpl-validator-domains'

import { UNL, UNLBlob, UNLValidator } from '../types'

import config from './config'
import logger from '../utils/logger'

const log = logger({name:'utils'})

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
  } catch (err) {
    log.error(err.message)
    return Promise.reject()
  }
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
  const data = JSON.stringify({
    method: 'manifest',
    params: [{ public_key: `${key}` }],
  })
  const params: AxiosRequestConfig = {
    method: 'post',
    url: `${config.rippled_rpc_admin_server}`,
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
export async function getLists(): Promise<{
  vl_main: Set<string>
  vl_test: Set<string>
  vl_dev: Set<string>
}> {
  const main_blob = await fetchValidatorList(config.vl_main)
  const test_blob = await fetchValidatorList(config.vl_test)
  const dev_blob = await fetchValidatorList(config.vl_dev)
  return {
    vl_main: blobToValidators(main_blob),
    vl_test: blobToValidators(test_blob),
    vl_dev: blobToValidators(dev_blob),
  }
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
