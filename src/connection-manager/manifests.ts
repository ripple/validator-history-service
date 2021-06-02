import {
  normalizeManifest,
  verifyValidatorDomain,
} from 'xrpl-validator-domains'

import {
  saveManifest,
  getValidatorSigningKeys,
  query,
  db,
} from '../shared/database'
import {
  StreamManifest,
  Manifest,
  UNLBlob,
  UNLValidator,
  DatabaseManifest,
} from '../shared/types'
import { fetchValidatorList, fetchRpcManifest, getLists } from '../shared/utils'
import config from '../shared/utils/config'

import hard_dunl from './fixtures/unl-hard.json'

const MANIFESTS_JOB_INTERVAL = 60 * 60 * 1000
let jobsStarted = false
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
  } catch (err) {
    console.log(err.message)
    let normalized
    try {
      normalized = normalizeManifest(manifest)
    } catch {
      return
    }
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
  try {
    console.log('Fetching UNL...')
    const unl: UNLBlob = await fetchValidatorList(config.vl_main)
    const promises: Array<Promise<void>> = []

    unl.validators.forEach((validator: UNLValidator) => {
      const manifestHex = Buffer.from(validator.manifest, 'base64')
        .toString('hex')
        .toUpperCase()
      promises.push(handleManifest(manifestHex))
    })
    await Promise.all(promises)
  } catch (err) {
    console.log('Error updating UNL manifests')
    console.log(err)
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
    console.log('Getting latest Manifests...')
    const keys = await getValidatorSigningKeys()

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
    console.log('Manifests updated')
  } catch (err) {
    console.log('Error updating manifests from rippled')
    console.log(err)
  }
}

/**
 * This function updates the domains and verification status of each validator in the validators table
 * from the corresponding manifest in the manifests table.
 *
 * @returns A promise that resolves to void once all of the latest manifests have been saved.
 */
async function updateValidatorDomainsFromManifests(): Promise<void> {
  console.log('Updating validator domains...')
  try {
    await db().raw(
      'UPDATE validators SET domain = manifests.domain, domain_verified = manifests.domain_verified FROM manifests WHERE validators.signing_key = manifests.signing_key AND manifests.domain IS NOT NULL',
    )
  } catch (err) {
    console.log('Error updating validator domains')
    console.log(err)
  }
  console.log('Finished updating validator domains')
}

/**
 * Update the unl column if the validator is included in a validator list (main, testnet, or devnet).
 * The unl column contains the domain where the validator list is served.
 *
 * @returns A promise that resolves to void once unl column is updated for all applicable validators.
 */
export async function updateUnls(): Promise<void> {
  try {
    const lists = await getLists()
    console.log('Updating validator unls...')
    for (const [name, list] of Object.entries(lists)) {
      // Get latest signing keys from manifests table

      const subquery = query('manifests')
        .select('master_key')
        .whereIn('signing_key', Array.from(list))

      // eslint-disable-next-line no-await-in-loop -- necessary await
      const keys: string[] = await query('manifests')
        .distinctOn('master_key')
        .select('signing_key')
        .whereIn('master_key', subquery)
        .orderBy(['master_key', { column: 'seq', order: 'desc' }])
        .then(async (res) => {
          return res.map((idx: { signing_key: string }) => {
            return idx.signing_key
          })
        })
      
      // eslint-disable-next-line max-depth -- necessary depth
      if (name === 'vl_main') {
        // eslint-disable-next-line no-await-in-loop -- necessary await
        await query('validators')
          .whereIn('signing_key', keys)
          .update({ unl: config.vl_main })
        // eslint-disable-next-line no-await-in-loop -- necessary await
        await query('validators')
          .whereNotIn('signing_key',keys)
          .where('unl','=',config.vl_main)
          .update({unl: null})
      }
      // eslint-disable-next-line max-depth -- necessary depth
      if (name === 'vl_test') {
        // eslint-disable-next-line no-await-in-loop -- necessary await
        await query('validators')
          .whereIn('signing_key', keys)
          .update({ unl: config.vl_test })
        await query('validators')
          .whereNotIn('signing_key',keys)
          .where('unl','=',config.vl_test)
          .update({unl: null})
      }
      // eslint-disable-next-line max-depth -- necessary depth
      if (name === 'vl_dev') {
        // eslint-disable-next-line no-await-in-loop -- necessary await
        await query('validators')
          .whereIn('signing_key', keys)
          .update({ unl: config.vl_dev })
        await query('validators')
          .whereNotIn('signing_key',keys)
          .where('unl','=',config.vl_dev)
          .update({unl: null})
      }
    }
    console.log('Finished updating validator unls')
  } catch (err) {
    console.log('Error updating validator unls')
    console.log(err)
  }
}

/**
 * Updates the master keys in the validators table from the manifests in the manifests table.
 *
 * @returns A promise that resolves to void once all master keys are updated.
 */
async function updateValidatorMasterKeys(): Promise<void> {
  console.log('Updating validator master keys...')
  try {
    await db().raw(
      'UPDATE validators SET master_key = manifests.master_key FROM manifests WHERE validators.signing_key = manifests.signing_key',
    )
  } catch (err) {
    console.log(err)
  }
  console.log('Finished updating validator master keys')
}

/**
 * Updates the revoked column of the validators table
 * Signing keys have been revoked when a manifest with a greater seq has been seen.
 *
 * @returns Void.
 */
async function updateRevocations(): Promise<void> {
  console.log('Updating revocations...')
  try {
    await db().raw(
      'UPDATE validators SET revoked = manifests.revoked FROM manifests WHERE validators.signing_key = manifests.signing_key',
    )
  } catch (err) {
    console.log(err)
  }
  console.log('Finished updating revocations')
}

/**
 * Deletes validators that are older than an hour.
 *
 * @returns Void.
 */
async function purgeOldValidators(): Promise<void> {
  const oneWeekAgo = new Date()
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7)
  console.log('Deleting old validators')
  try {
    await query('validators').where('last_ledger_time', '<', oneWeekAgo).del()
  } catch (err) {
    console.log(err)
  }
  console.log('Finished deleting old validators')
}

/**
 * Hard codes dUNL validators.
 *
 * @returns Void.
 */
async function updateHardCodedUnls(): Promise<void> {
  console.log('Hard coding validators from dUNL (ddv pending)...')

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
        .catch((err) => console.log(err))
    } catch (err) {
      console.log(err)
    }
  }
  console.log('Finished hard coding dUNL validators')
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
    jobs().catch((err) => console.log(err))
    setInterval(() => {
      jobsStarted = true
      jobs().catch((err) => console.log(err))
    }, MANIFESTS_JOB_INTERVAL)
  }
}
