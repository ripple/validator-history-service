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
import {
  AgreementScore,
  Validator,
  ValidationRaw,
  ValidatorKeys,
  Ballot,
  LedgerHash,
  LedgerIndex,
  Chain,
} from '../shared/types'
import logger from '../shared/utils/logger'

import chains from './chains'

const log = logger({ name: 'agreement' })

const AGREEMENT_INTERVAL = 60 * 60 * 1000
const PURGE_INTERVAL = 10 * 60 * 1000

/**
 * Calculates the difference between a validator's validations and the consensus ledger hash.
 *
 * @returns Set1 - set2.
 * @param ledgers - A map of validated ledger hashes and indexes.
 * @param validations - A map of validated ledger hashes and raw validations.
 */
function differences(
  ledgers: Map<LedgerHash, LedgerIndex>,
  validations: Map<LedgerIndex, ValidationRaw>,
): {
  missed: Set<[LedgerIndex, LedgerHash]>
  correct: Set<[LedgerIndex, LedgerHash]>
} {
  const difference = {
    missed: new Set<[LedgerIndex, LedgerHash]>(),
    correct: new Set<[LedgerIndex, LedgerHash]>(),
  }

  ledgers.forEach((ledgerIndex, ledgerHash: LedgerHash) => {
    const tuple: [LedgerIndex, LedgerHash] = [ledgerIndex, ledgerHash]
    if (
      validations.has(ledgerIndex) &&
      validations.get(ledgerIndex)?.ledger_hash === ledgerHash
    ) {
      difference.correct.add(tuple)
    } else {
      difference.missed.add(tuple)
    }
  })

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
 *
 */
class Agreement {
  private readonly validationsByPublicKey: Map<
    string,
    Map<LedgerIndex, ValidationRaw>
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
          this.calculateValidatorAgreement(signing_key, ledger_hashes, chain),
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

    const hashes =
      this.validationsByPublicKey.get(signing_key) ??
      new Map<LedgerIndex, ValidationRaw>()

    if (!hashes.has(validation.ledger_index)) {
      hashes.set(validation.ledger_hash, validation)
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
   * @param chain - The chain ledgers belong to.
   */
  private async calculateValidatorAgreement(
    signing_key: string,
    ledger_hashes: Map<LedgerHash, LedgerIndex>,
    chain: Chain,
  ): Promise<void> {
    const master_key = await signingToMaster(signing_key)
    const validator_keys = { master_key, signing_key }

    await this.calculateHourlyAgreement(
      validator_keys,
      this.validationsByPublicKey.get(signing_key) ?? new Map(),
      ledger_hashes,
      chain,
    )

    await updateDailyAgreement(validator_keys)
  }

  /**
   * Calculate the agreement score for the last hour of validations.
   *
   * @param validator_keys - Signing keys of validations for one validator.
   * @param validations - Set of ledger_hashes validated by signing_key.
   * @param ledgers - Set of ledger_hashes validated by network.
   * @param chain - The chain ledgers belong to.
   * @returns Void.
   */
  private async calculateHourlyAgreement(
    validator_keys: ValidatorKeys,
    validations: Map<LedgerIndex, ValidationRaw>,
    ledgers: Map<LedgerHash, LedgerIndex>,
    chain: Chain,
  ): Promise<void> {
    const difference = differences(ledgers, validations)

    const agreement: AgreementScore = {
      validated: difference.correct.size,
      missed: difference.missed.size,
      incomplete: chain.incomplete,
    }

    difference.missed.forEach((missedLedger) => {
      const validationHash = validations.get(missedLedger[0])?.ledger_hash
      log.warn(
        `Chain ${chain.id} had a validator (${
          validator_keys.signing_key
        }) miss a ledger (${missedLedger[0]}) due to ${
          validationHash
            ? `a mismatched hash of ${validationHash}`
            : `no validation message`
        }`,
      )
    })
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
    function purgeValidations(validations: Map<string, ValidationRaw>): void {
      for (const [hash, validation] of validations) {
        if (validation.signing_time < twoHoursAgo) {
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
