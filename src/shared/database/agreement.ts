import {
  HourlyAgreement,
  DailyAgreement,
  AgreementScore,
  ValidatorKeys,
} from '../types'
import logger from '../utils/logger'

import { query } from './utils'

const log = logger({ name: 'database-agreement' })

/**
 * Saves an hourly agreement score to agreement table.
 *
 * @param agreement - Agreement score.
 * @returns Void.
 */
export async function saveHourlyAgreement(
  agreement: HourlyAgreement,
): Promise<void> {
  query('hourly_agreement')
    .insert(agreement)
    .onConflict(['main_key', 'start'])
    .merge()
    .catch((err: Error) => log.error('Error saving Hourly Agreement', err))
}

/**
 * Saves an daily agreement score to daily agreement table.
 *
 * @param agreement - Agreement score.
 * @returns Void.
 */
export async function saveDailyAgreement(
  agreement: DailyAgreement,
): Promise<void> {
  query('daily_agreement')
    .insert(agreement)
    .onConflict(['main_key', 'day'])
    .merge()
    .catch((err) => log.error('Error saving Daily Agreement', err))
}

/**
 * Calculate agreement scores for a validator.
 *
 * @param validator - Validator to get agreement score.
 * @param start - Start time for agreement score.
 * @param end - End time for agreement score.
 * @returns Agreement Score for validator between start and end.
 */
export async function getAgreementScores(
  validator: ValidatorKeys,
  start: Date,
  end: Date,
): Promise<AgreementScore> {
  const agreement = await getHourlyAgreementScores(validator, start, end)

  return calculateAgreementScore(agreement)
}

/**
 * Maps a signing key to a master key.
 *
 * @param signing_key - Signing key to look up.
 * @returns String or undefined if not found.
 */
export async function signingToMaster(
  signing_key: string,
): Promise<string | undefined> {
  return query('validators')
    .select('master_key')
    .where({ signing_key })
    .where('revoked', '=', 'false')
    .then(async (resp) => resp[0]?.master_key)
    .catch((err) => log.error('Error finding master key from signing key', err))
}

/**
 * Get all hourly agreement scores for a validator.
 *
 * @param validator - Validator to get agreement score.
 * @param start - Start time for agreement score.
 * @param end - End time for agreement score.
 * @returns Hourly Agreement for validator between start and end.
 */
async function getHourlyAgreementScores(
  validator: ValidatorKeys,
  start: Date,
  end: Date,
): Promise<AgreementScore[]> {
  return query('hourly_agreement')
    .select(['agreement'])
    .where({ main_key: validator.master_key ?? validator.signing_key })
    .where('start', '>', start)
    .where('start', '<', end)
    .then(async (scores) =>
      scores.map((score: { agreement: AgreementScore }) => score.agreement),
    )
}

/**
 * Calculates an agreement score from a list of AgreementScores.
 *
 * @param scores - List of AgreementScores.
 * @returns Agreement Score for all scores.
 */
function calculateAgreementScore(scores: AgreementScore[]): AgreementScore {
  const result: AgreementScore = {
    validated: 0,
    missed: 0,
    incomplete: false,
  }

  scores.forEach((score) => {
    result.validated += score.validated
    result.missed += score.missed
    result.incomplete = result.incomplete || score.incomplete
  })

  return result
}

/**
 * Updates a validator's 1 hour agreement score.
 *
 * @param validator_keys - Signing keys of the the validator to be updated.
 * @param agreement - An agreement object.
 * @returns A promise that resolves to void once the agreement has been stored.
 */
export async function update1HourValidatorAgreement(
  validator_keys: ValidatorKeys,
  agreement: AgreementScore,
): Promise<void> {
  const { master_key, signing_key } = validator_keys
  if (master_key) {
    await query('validators')
      .where({ master_key })
      .update({ agreement_1hour: agreement })
      .catch((err) =>
        log.error(
          `Error Updating 1 Hour Validator Agreement, ${master_key}`,
          err,
        ),
      )
  } else {
    await query('validators')
      .where({ signing_key })
      .update({ agreement_1hour: agreement })
      .catch((err) =>
        log.error(
          `Error Updating 1 Hour Validator Agreement, ${signing_key}`,
          err,
        ),
      )
  }
}
/**
 *  Updates the validator's 24 hour agreement score.
 *
 * @param validator_keys - Signing keys of the the validator to be updated.
 * @param agreement - An agreement object.
 * @returns A promise that resolves to void once the agreement has been stored.
 */
export async function update24HourValidatorAgreement(
  validator_keys: ValidatorKeys,
  agreement: AgreementScore,
): Promise<void> {
  const { master_key, signing_key } = validator_keys
  if (master_key) {
    await query('validators')
      .where({ master_key })
      .update({ agreement_24hour: agreement })
      .catch((err) =>
        log.error(
          `Error updating 24 Hour Validator Agreement, ${master_key}`,
          err,
        ),
      )
  } else {
    await query('validators')
      .where({ signing_key })
      .update({ agreement_24hour: agreement })
      .catch((err) =>
        log.error(
          `Error updating 24 Hour Validator Agreement, ${signing_key}`,
          err,
        ),
      )
  }
}

/**
 *  Updates the validator's 30 day agreement score.
 *
 * @param validator_keys - Signing key of the the validator to be updated.
 * @param agreement - An agreement object.
 * @returns A promise that resolves to void once the agreement has been stored.
 */
export async function update30DayValidatorAgreement(
  validator_keys: ValidatorKeys,
  agreement: AgreementScore,
): Promise<void> {
  const { master_key, signing_key } = validator_keys
  if (master_key) {
    await query('validators')
      .where({ master_key })
      .update({ agreement_30day: agreement })
      .catch((err) =>
        log.error(
          `Error updating 30 Day Validator Agreement, ${master_key}`,
          err,
        ),
      )
  } else {
    await query('validators')
      .where({ signing_key })
      .update({ agreement_30day: agreement })
      .catch((err) =>
        log.error(
          `Error updating 30 Day Validator Agreement, ${signing_key}`,
          err,
        ),
      )
  }
}
