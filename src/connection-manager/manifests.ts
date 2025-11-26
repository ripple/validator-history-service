import {
  normalizeManifest,
  verifyValidatorDomain,
} from 'xrpl-validator-domains'

import {
  saveManifest,
  getValidatorKeys,
  query,
  db,
  getNetworks,
} from '../shared/database'
import {
  StreamManifest,
  Manifest,
  UNLBlob,
  UNLValidator,
  DatabaseManifest,
} from '../shared/types'
import { fetchValidatorList, fetchRpcManifest, getLists } from '../shared/utils'
import logger from '../shared/utils/logger'

import hard_dunl from './fixtures/unl-hard.json'

const log = logger({ name: 'manifests' })
const MANIFESTS_JOB_INTERVAL = 60 * 60 * 1000
let jobsStarted = false
let unlSigningKeys: Set<string> = new Set()

/**
 * Resets the UNL signing keys set.
 */
function resetUNLSigningKeys(): void {
  unlSigningKeys = new Set()
}

/**
 * Get the first UNL in the list of UNLs for the network with name `networkName`.
 *
 * @param networkName - The name of the network.
 * @returns The first UNL in the list of UNLs for the network.
 */
async function getFirstUNL(networkName: string): Promise<string> {
  const networks = await getNetworks()
  const network = networks.filter((ntwk) => ntwk.id === networkName)[0]
  return network.unls[0]
}

/**
 * Performs Domain verification and saves the Manifest.
 *
 * @param manifest - Manifest to be handled. Can be a Manifest, StreamManifest or hex string.
 * @returns A promise that resolves to void whether or not the manifest was saved.
 */
export async function handleManifest(
  manifest: Manifest | StreamManifest | string,
): Promise<void> {
  let verification
  try {
    verification = await verifyValidatorDomain(manifest)
  } catch {
    let normalized
    try {
      normalized = normalizeManifest(manifest)
    } catch (err: unknown) {
      log.error('Manifest could not be normalized', err)
      return
    }
    log.warn(
      `Domain verification failed for manifest (master key): ${normalized.master_key}`,
    )
    const dBManifest: DatabaseManifest = {
      domain_verified: false,
      ...normalized,
    }
    await saveManifest(dBManifest)
    return
  }
  if (verification.verified_manifest_signature && verification.manifest) {
    const dBManifest: DatabaseManifest = {
      domain_verified: verification.verified,
      ...verification.manifest,
    }
    await saveManifest(dBManifest)
  }
}

/**
 * Saves manifests from the UNL.
 *
 * @returns A promise that resolves to void once all UNL validators are saved.
 */
export async function updateUNLManifests(): Promise<void> {
  const networks = (await getNetworks()).map((network) => network.id)
  const promises = networks.map(async (network) =>
    updateUNLManifestNetwork(network),
  )
  await Promise.all(promises)
}

/**
 * Saves manifests from the UNL.
 *
 * @param network - The network to update.
 * @returns A promise that resolves to void once all UNL validators are saved.
 */
async function updateUNLManifestNetwork(network: string): Promise<void> {
  try {
    log.info('Fetching UNL...')
    const unl: UNLBlob = await fetchValidatorList(await getFirstUNL(network))
    const promises: Array<Promise<void>> = []
    resetUNLSigningKeys()

    unl.validators.forEach((validator: UNLValidator) => {
      const manifestHex = Buffer.from(validator.manifest, 'base64')
        .toString('hex')
        .toUpperCase()
      const manifest = normalizeManifest(manifestHex)
      if (manifest.signing_key) {
        unlSigningKeys.add(manifest.signing_key)
      }
      promises.push(handleManifest(manifestHex))
    })
    await Promise.all(promises)
  } catch (err) {
    log.error('Error updating UNL manifests', err)
  }
}

/**
 * This function loops through all signing keys in the validators table and queries rippled
 * to find the most recent manifest available.
 *
 * @returns A promise that resolves to void once all of the latest manifests have been saved.
 */
export async function updateManifestsFromRippled(): Promise<void> {
  try {
    log.info('Getting latest Manifests...')
    const keys = await getValidatorKeys()

    const manifestPromises: Array<Promise<string | undefined>> = []

    keys.forEach((key) => {
      manifestPromises.push(fetchRpcManifest(key))
    })

    const manifests = await Promise.all(manifestPromises)

    const handleManifestPromises: Array<Promise<void>> = []
    for (const manifestHex of manifests) {
      // eslint-disable-next-line max-depth -- necessary depth
      if (manifestHex) {
        handleManifestPromises.push(handleManifest(manifestHex))
      }
    }
    await Promise.all(handleManifestPromises)
    log.info('Manifests updated')
  } catch (err) {
    log.error(`Error updating manifests from rippled`, err)
  }
}

/**
 * This function updates the domains and verification status of each validator in the validators table
 * from the corresponding manifest in the manifests table.
 *
 * @returns A promise that resolves to void once all of the latest manifests have been saved.
 */
async function updateValidatorDomainsFromManifests(): Promise<void> {
  log.info('Updating validator domains...')
  try {
    await db().raw(
      'UPDATE validators SET domain = manifests.domain, domain_verified = manifests.domain_verified FROM manifests WHERE validators.signing_key = manifests.signing_key AND manifests.domain IS NOT NULL',
    )
  } catch (err) {
    log.error('Error updating validator domains', err)
  }
  log.info('Finished updating validator domains')
}

/**
 * Update the unl column if the validator is included in a validator list for a network.
 * The unl column contains the domain where the validator list is served.
 *
 * @returns A promise that resolves to void once unl column is updated for all applicable validators.
 */
export async function updateUnls(): Promise<void> {
  try {
    const lists = await getLists()
    log.info('Updating validator unls...')
    for (const [name, list] of Object.entries(lists)) {
      // Get latest signing keys from manifests table

      const subquery = query('manifests')
        .select('master_key')
        .whereIn('signing_key', Array.from(list))

      const keys: string[] = await query('manifests')
        .distinctOn('master_key')
        .select('signing_key')
        .whereIn('master_key', subquery)
        .orderBy(['master_key', { column: 'seq', order: 'desc' }])
        .then(async (res) => {
          return (res as Array<{ signing_key: string }>).map(
            (idx: { signing_key: string }) => idx.signing_key,
          )
        })

      const networkUNL = await getFirstUNL(name)
      await query('validators')
        .whereIn('signing_key', keys)
        .update({ unl: networkUNL })
      await query('validators')
        .whereNotIn('signing_key', keys)
        .where('unl', '=', networkUNL)
        .update({ unl: null })
    }
    log.info('Finished updating validator unls')
  } catch (err) {
    log.error(`Error updating validator unls`, err)
  }
}

/**
 * Updates the master keys in the validators table from the manifests in the manifests table.
 *
 * @returns A promise that resolves to void once all master keys are updated.
 */
async function updateValidatorMasterKeys(): Promise<void> {
  log.info('Updating validator master keys...')
  try {
    await db().raw(
      'UPDATE validators SET master_key = manifests.master_key FROM manifests WHERE validators.signing_key = manifests.signing_key',
    )
  } catch (err) {
    log.error(`Error updating validator master keys`, err)
  }
  log.info('Finished updating validator master keys')
}

/**
 * Updates the revoked column of the validators table
 * Signing keys have been revoked when a manifest with a greater seq has been seen.
 *
 * @returns Void.
 */
async function updateRevocations(): Promise<void> {
  log.info('Updating revocations...')
  try {
    await db().raw(
      'UPDATE validators SET revoked = manifests.revoked FROM manifests WHERE validators.signing_key = manifests.signing_key',
    )
  } catch (err) {
    log.error(`Error updating revocations`, err)
  }
  log.info('Finished updating revocations')
}

/**
 * Deletes validators that are older than 30 days.
 * UNL validators are not deleted even if they are older than 30 days.
 *
 * @returns Void.
 */
export async function purgeOldValidators(): Promise<void> {
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  log.info('Deleting old validators')
  try {
    if (unlSigningKeys.size === 0) {
      log.info('No UNL signing keys, skipping purge')
      return
    }
    await query('validators')
      .where('last_ledger_time', '<', thirtyDaysAgo)
      .whereNotIn('signing_key', Array.from(unlSigningKeys))
      .del()
  } catch (err) {
    log.error(`Error purging old validators`, err)
  }
  log.info('Finished deleting old validators')
}

/**
 * Hard codes dUNL validators.
 *
 * @returns Void.
 */
async function updateHardCodedUnls(): Promise<void> {
  log.info('Hard coding validators from dUNL (ddv pending)...')

  interface HardCoded {
    [key: string]: string
  }
  const obj = hard_dunl as HardCoded
  for (const master_key of Object.keys(obj)) {
    try {
      void query('validators')
        .where('master_key', '=', master_key)
        .whereNull('domain')
        .update({ domain: obj[master_key] }, ['master_key'])
        .catch((err) => log.error(`Hard coding error - query error`, err))
    } catch (err) {
      log.error(`Error updating hard coded UNL validators`, err)
    }
  }
  log.info('Finished hard coding dUNL validators')
}

async function jobs(): Promise<void> {
  await updateUNLManifests()
  await updateManifestsFromRippled()
  await updateValidatorDomainsFromManifests()
  await updateUnls()
  await updateValidatorMasterKeys()
  await updateRevocations()
  await purgeOldValidators()
  await updateHardCodedUnls()
}

export async function doManifestJobs(): Promise<void> {
  if (!jobsStarted) {
    jobs().catch((err) => log.error(`Error starting manifest jobs`, err))
    setInterval(() => {
      jobsStarted = true
      jobs().catch((err) => log.error(`Error starting manifest jobs`, err))
    }, MANIFESTS_JOB_INTERVAL)
  }
}
