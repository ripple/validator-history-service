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
} from '../shared/database'
import { AgreementScore, ValidationRaw } from '../shared/types'
import logger from '../shared/utils/logger'
import chains from './chains'

const log = logger({name:'agreement'})

const AGREEMENT_INTERVAL = 60 * 60 * 1000
const PURGE_INTERVAL = 10 * 60 * 1000

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
 * @param master_key - Master Key of the validator.
 * @returns Void.
 */
async function updateAgreementScores(master_key: string): Promise<void> {
  const end = new Date()

  const days_1 = new Date()
  days_1.setDate(end.getDate() - 1)
  const score1 = await getAgreementScores(master_key, days_1, end)
  await update24HourValidatorAgreement(master_key, score1)

  const days_30 = new Date()
  days_30.setDate(end.getDate() - 30)
  const score30 = await getAgreementScores(master_key, days_30, end)
  await update30DayValidatorAgreement(master_key, score30)
}

/**
 * Updates agreement for a validator.
 *
 * @param master_key - Signing_key of validator to update agreement for.
 * @returns Void.
 */
async function updateDailyAgreement(master_key: string): Promise<void> {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date()
  end.setHours(23, 59, 59, 999)

  const agreement = await getAgreementScores(master_key, start, end)

  await saveDailyAgreement({
    master_key,
    day: start,
    agreement,
  })
}

/**
 *
 */
class Agreement {
  private readonly validationsByPublicKey: Map<
    string,
    Map<string, number>
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
      hashes.set(validation.ledger_hash, Date.now())
      this.validationsByPublicKey.set(signing_key, hashes)
      const validator = {
        signing_key,
        ledger_hash: validation.ledger_hash,
        current_index: Number(validation.ledger_index),
        partial: !validation.full,
        last_ledger_time: new Date(),
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

    if (!master_key) {
      return
    }

    await this.calculateHourlyAgreement(
      master_key,
      this.validationsByPublicKey.get(signing_key) ?? new Map(),
      ledger_hashes,
      incomplete,
    )

    await updateDailyAgreement(master_key)
  }

  /**
   * Calculate the agreement score for the last hour of validations.
   *
   * @param master_key - Signing key of validations.
   * @param validations - Set of ledger_hashes validated by signing_key.
   * @param ledgers - Set of ledger_hashes validated by network.
   * @param incomplete - Is this agreement score incomplete.
   * @returns Void.
   */
  private async calculateHourlyAgreement(
    master_key: string,
    validations: Map<string, number>,
    ledgers: Set<string>,
    incomplete: boolean,
  ): Promise<void> {
    const missed = setDifference(ledgers, validations)
    const validated = setIntersection(ledgers, validations)

    const agreement: AgreementScore = {
      validated: validated.size,
      missed: missed.size,
      incomplete,
    }
    await saveHourlyAgreement({
      master_key,
      start: this.reported_at,
      agreement,
    })

    await update1HourValidatorAgreement(master_key, agreement)
    await updateAgreementScores(master_key)
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
    function purgeValidations(validations: Map<string, number>): void {
      for (const [hash, time] of validations) {
        if (time < twoHoursAgo) {
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
