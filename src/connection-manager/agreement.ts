/* eslint-disable max-lines -- Disabled for testing. */
/* eslint-disable max-depth -- Disabled for testing. */
import {
  getAgreementScores,
  saveHourlyAgreement,
  saveDailyAgreement,
  saveValidator,
  update1HourValidatorAgreement,
  update24HourValidatorAgreement,
  update30DayValidatorAgreement,
  purgeHourlyAgreementScores,
  signingToMaster,
  decodeServerVersion,
  saveBallot,
} from '../shared/database'
import { saveMissedValidation } from '../shared/database/agreement'
import {
  AgreementScore,
  Validator,
  ValidationRaw,
  ValidatorKeys,
  Ballot,
  Chain,
} from '../shared/types'
import { getLists, overlaps } from '../shared/utils'
import logger from '../shared/utils/logger'

import chains from './chains'

const log = logger({ name: 'agreement' })

const AGREEMENT_INTERVAL = 60 * 60 * 1000
const PURGE_INTERVAL = 10 * 60 * 1000

const UNL_MAINNET_SIGNING_KEYS = [
  'n9LvxiHe5wve7yLe1R1MagKboVs5WrWSJMEsXtJrfqtAwCswjKsd',
  'n9LY8MFrFKudddAjrs3BZ33SwqCypV4aYqP7sH3VKgaJSz3aJUwL',
  'n9MSTcx1fmfyKpaDTtpXucugcqM7yxpaggmwRxcyA3Nr4pE1pN3x',
  'n9Lqr4YZxk7WYRDTBZjjmoAraikLCjAgAswaPaZ6LaGW6Q4Y2eoo',
  'n94a894ARPe5RdcaRgdMBB9gG9ukS5mqsd7q2oNmC1NKqtZqEJnb',
  'n9M2UqXLK25h9YEQTskmCXbWPGhQmB1pFVqeXia38UwLaL838VbG',
  'n9MngHUqEeJXd8cgeEGsjvm9FqQRm4DwhCrTYCtrfnm5FWGFaR6m',
  'n9KqcU9Qc5k1w8y9mPrTZYy14te3qjo1b1ZiieqC2NggbNrAuLpu',
  'n9KQ2DVL7QhgovChk81W8idxm7wDsYzXutDMQzwUBKuxb9WTWBVG',
  'n9MhLZsK7Av6ny2gV5SAGLDsnFXE9p85aYR8diD8xvuvuucqad85',
  'n9KaxgJv69FucW5kkiaMhCqS6sAR1wUVxpZaZmLGVXxAcAse9YhR',
  'n9Jk38y9XCznqiLq53UjREJQbZWnz4Pvmph55GP5ofUPg3RG8eVr',
  'n94rGrfuwvYTS1HEeWboW2nGvAQgVDpiD8id2pLWSHFVggBRpQRE',
  'n9KkK4BiTTXjeF31KX4fTJkyVtH89ik4apq4wF7sQzqmbqBYcU3H',
  'n943ozDG74swHRmAjzY6A4KVFBhEirF4Sh1ACqvDePE3CZTgkMqn',
  'n9MZ7EVGKypqdyNguP31xSqhFqDBF4V5FESLMmLiGrBJ3khP2AzQ',
  'n9M5q9FaYgrBYSU5TuV3tATpy1DuAFKdtdjufDAzWUGXLKr3Trfq',
  'n94RkpbJYRYQrWUmL8PAVQ1XTVKtfyKkLm8C6SWzWPcKEbuNb6EV',
  'n9LFSE8fQ6Ljnc97ToHVtv1sYZ3GpzrXKpT94eFDk8jtdbfoBe7N',
  'n9MxDjQMr1DkzW3Z5X1guKJq4QNDEeYFPgqGgHfpzerGbHWGZvj4',
  'n9JvsY3yhCdsHe3JsVTwvCtvKnchg2eridHLWdBdWf8VkpZSqqS9',
  'n9JgxBLdCHii4xnRNMk7WJhD2qmfJGRvCxmmNNivBZXPRVpeZkH3',
  'n9LL7K3Ubnob3ExqmgpigL3AgzKKhTaVvnZiXqsvz85VjbY3KqFp',
  'n9KRttNtSJ2NHX7P2RkoYpqf2cxhDfkcGCFswarLqHdjjfjPJFJB',
  'n9Km4Xz53K9kcTaVn3mYAHsXqNuAo7A2HazSr34SFufvNwBxYGLn',
  'n9McDrz9tPujrQK3vMXJXzuEJv1B8UG3opfZEsFA8t6QxdZh1H6m',
  'n9Lo7qSD4qwjoMLFE5jDJihJG7r1VXqDpEgRjWfxgukqdbojBnkv',
  'n9LPSEVyNTApMuchFeTE1GD9qhsH9Umagnpu3NLC9zb358KNfiZV',
  'n9JeA5Q54JhUQYHieb2j7ZTCg9RTBagDkam3UP2kWQxTXfxFkA8R',
  'n9KAE7DUEB62ZQ3yWzygKWWqsj7ZqchW5rXg63puZA46k7WzGfQu',
  'n9KeTQ3UyMtaJJD78vT7QiGRMv1GcWHEnhNbwKfdbW2HfRqtvUUt',
  'n9KcrNBzrJUhdujcP8PK57WAmaZKcyXTNRaUFnqBmxwQj18eu3LU',
  'n9LbM9S5jeGopF5J1vBDoGxzV6rNS8K1T5DzhNynkFLqR9N2fywX',
  'n9LabXG8Vo7SfrUcZudeDCuFvWXW5TXbhUSYwgqmgYMFpUYuMN87',
  'n9LkAv98aaGupypuLMH5ogjJ3rTEX178s9EnmRvmySL9k3cVuxTu',
]

/**
 * Calculates the intersection of two sets.
 *
 * @param set1 - The first set.
 * @param set2 - The second set.
 * @returns The intersection.
 */
function setIntersection<T>(set1: Iterable<T>, set2: Map<T, unknown>): Set<T> {
  const intersection: Set<T> = new Set()

  for (const key of set1) {
    if (set2.has(key)) {
      intersection.add(key)
    }
  }

  return intersection
}

/**
 * Calculates the difference of two sets.
 *
 * @param set1 - The first set.
 * @param set2 - The second set.
 * @returns Set1 - set2.
 */
function setDifference<T>(set1: Iterable<T>, set2: Map<T, unknown>): Set<T> {
  const difference: Set<T> = new Set()

  for (const key of set1) {
    if (!set2.has(key)) {
      difference.add(key)
    }
  }

  return difference
}

/**
 * Updates 1 hour, 1 day, and 30 day agreement scores.
 *
 * @param validator_keys - Master Key and Signing Key of the validator.
 * @returns Void.
 */
async function updateAgreementScores(
  validator_keys: ValidatorKeys,
): Promise<void> {
  const end = new Date()

  const days_1 = new Date()
  days_1.setDate(end.getDate() - 1)
  const score1 = await getAgreementScores(validator_keys, days_1, end)
  await update24HourValidatorAgreement(validator_keys, score1)

  const days_30 = new Date()
  days_30.setDate(end.getDate() - 30)
  const score30 = await getAgreementScores(validator_keys, days_30, end)
  await update30DayValidatorAgreement(validator_keys, score30)
}

/**
 * Updates agreement for a validator.
 *
 * @param validator_keys - Signing_keys of validator to update agreement for.
 * @returns Void.
 */
async function updateDailyAgreement(
  validator_keys: ValidatorKeys,
): Promise<void> {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date()
  end.setHours(23, 59, 59, 999)

  const agreement = await getAgreementScores(validator_keys, start, end)

  await saveDailyAgreement({
    main_key: validator_keys.master_key ?? validator_keys.signing_key,
    day: start,
    agreement,
  })
}

/**
 * Detect the ledger before a flagged ledger, which will contain server version information.
 *
 * @param ledger_index - Index of current ledger.
 * @returns Boolean.
 */
function isPreceedingFlagLedger(ledger_index: string): boolean {
  return parseInt(ledger_index, 10) % 256 === 255
}

/**
 * Finds network name from chain id.
 *
 * @param chain - A chain object.
 * @returns String.
 */
async function getNetworkNameFromChainId(chain: Chain): Promise<string> {
  let id = chain.id
  const lists = await getLists().catch((err) => {
    log.error('Error getting validator lists', err)
    return undefined
  })

  if (lists != null) {
    Object.entries(lists).forEach(([network, set]) => {
      if (overlaps(chain.validators, set)) {
        id = network
      }
    })
  }

  return id
}

/**
 *
 */
class Agreement {
  private readonly validationsByPublicKey: Map<
    string,
    Map<string, { seen: number; index: string }>
  > = new Map()

  private reported_at = new Date()

  /**
   * Sets interval for agreement.
   */
  public start(): void {
    setInterval(() => {
      void this.calculateAgreement()
    }, AGREEMENT_INTERVAL)
    setInterval(() => {
      this.purge()
    }, PURGE_INTERVAL)
  }

  /**
   * Calculates agreement scores, run hourly.
   */
  public async calculateAgreement(): Promise<void> {
    log.info('Calculating agreement scores')
    const promises = []

    const agreementChains = chains.calculateChainsFromLedgers()

    for (const chain of agreementChains) {
      const ledger_hashes = chain.ledgers

      const networkName = await getNetworkNameFromChainId(chain)

      log.info(
        `Agreement: ${chain.id}:${networkName}:${Array.from(
          chain.validators,
        ).join(',')}`,
      )

      for (const signing_key of chain.validators) {
        promises.push(
          this.calculateValidatorAgreement(
            signing_key,
            ledger_hashes,
            chain.incomplete,
          ),
        )
      }
    }
    await Promise.all(promises)

    await purgeHourlyAgreementScores()
    await chains.purgeChains()

    this.reported_at = new Date()
  }

  /**
   * Handles validation from rippled validation stream.
   *
   * @param validation - Validation from subscription stream.
   * @returns Void.
   */
  public async handleValidation(validation: ValidationRaw): Promise<void> {
    const signing_key = validation.validation_public_key

    const hashes = this.validationsByPublicKey.get(signing_key) ?? new Map()

    if (!hashes.has(validation.ledger_hash)) {
      hashes.set(validation.ledger_hash, {
        seen: Date.now(),
        index: validation.ledger_index,
      })
      this.validationsByPublicKey.set(signing_key, hashes)
      const validator: Validator = {
        master_key: validation.master_key,
        signing_key,
        ledger_hash: validation.ledger_hash,
        current_index: Number(validation.ledger_index),
        partial: !validation.full,
        last_ledger_time: new Date(),
      }

      let serverVersion = null

      if (isPreceedingFlagLedger(validation.ledger_index)) {
        serverVersion = decodeServerVersion(validation.server_version)
        const ballot: Ballot = {
          signing_key,
          ledger_index: Number(validation.ledger_index),
          amendments: validation.amendments?.join(','),
          base_fee: validation.base_fee ?? validation.ledger_fee?.fee_base,
          reserve_base:
            validation.reserve_base ?? validation.ledger_fee?.reserve_base,
          reserve_inc:
            validation.reserve_inc ?? validation.ledger_fee?.reserve_inc,
        }
        await saveBallot(ballot)
      }

      if (validation.networks) {
        validator.networks = validation.networks
      }

      if (serverVersion) {
        validator.server_version = serverVersion
      }

      chains.updateLedgers(validation)
      await saveValidator(validator)
    }
  }

  /**
   * Promise to calculate agreement for validator.
   *
   * @param signing_key - Signing key to calculate agreement for.
   * @param ledger_hashes - Ledger hashes seen on this validators chain.
   * @param incomplete - Are the ledgers heard incomplete.
   */
  private async calculateValidatorAgreement(
    signing_key: string,
    ledger_hashes: Set<string>,
    incomplete: boolean,
  ): Promise<void> {
    const master_key = await signingToMaster(signing_key)
    const validator_keys = { master_key, signing_key }

    await this.calculateHourlyAgreement(
      validator_keys,
      this.validationsByPublicKey.get(signing_key) ?? new Map(),
      ledger_hashes,
      incomplete,
    )

    await updateDailyAgreement(validator_keys)
  }

  /**
   * Calculate the agreement score for the last hour of validations.
   *
   * @param validator_keys - Signing keys of validations for one validator.
   * @param validations - Set of ledger_hashes validated by signing_key.
   * @param ledgers - Set of ledger_hashes validated by network.
   * @param incomplete - Is this agreement score incomplete.
   * @returns Void.
   */
  private async calculateHourlyAgreement(
    validator_keys: ValidatorKeys,
    validations: Map<string, { seen: number; index: string }>,
    ledgers: Set<string>,
    incomplete: boolean,
  ): Promise<void> {
    const missed = setDifference(ledgers, validations)
    if (
      missed.size > 0 &&
      UNL_MAINNET_SIGNING_KEYS.includes(validator_keys.signing_key)
    ) {
      log.info(
        `Missed validations found for UNL Mainnet. Saving into database...`,
      )
      for (const hash of missed) {
        for (const [, innerMap] of this.validationsByPublicKey) {
          if (innerMap.has(hash)) {
            const missed_validation = {
              signing_key: validator_keys.signing_key,
              master_key: validator_keys.master_key,
              ledger_index: innerMap.get(hash)?.index ?? '/8',
              ledger_hash: hash,
            }
            await saveMissedValidation(missed_validation)
            break
          }
        }
      }
    }

    const validated = setIntersection(ledgers, validations)

    const agreement: AgreementScore = {
      validated: validated.size,
      missed: missed.size,
      incomplete,
    }
    await saveHourlyAgreement({
      main_key: validator_keys.master_key ?? validator_keys.signing_key,
      start: this.reported_at,
      agreement,
    })

    await update1HourValidatorAgreement(validator_keys, agreement)
    await updateAgreementScores(validator_keys)
  }

  /**
   * Purge validations seen more than two hours ago.
   */
  private purge(): void {
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000

    /**
     * Purge old validations.
     *
     * @param validations - Validations map to delete old hashes.
     */
    function purgeValidations(
      validations: Map<string, { seen: number; index: string }>,
    ): void {
      for (const [hash, info] of validations) {
        if (info.seen < twoHoursAgo) {
          validations.delete(hash)
        }
      }
    }

    for (const [_key, validations] of this.validationsByPublicKey) {
      purgeValidations(validations)
    }
  }
}

let agreement: Agreement | undefined

/**
 * Gets instance of Agreement class.
 * Constructs if not exists.
 *
 * @returns Agreement class.
 */
function getAgreementInstance(): Agreement {
  if (agreement) {
    return agreement
  }

  agreement = new Agreement()

  return agreement
}

export default getAgreementInstance()
