import { Request, Response } from 'express'

import { db, query } from '../../../shared/database'
import { AgreementScore } from '../../../shared/types'
import logger from '../../../shared/utils/logger'

const log = logger({ name: 'api-validator-report' })

// Agreement rows are keyed by `master_key ?? signing_key` (see
// `saveDailyAgreement` in the connection-manager), so reads must resolve a
// validator to that same effective key.
const EFFECTIVE_KEY = 'COALESCE(validators.master_key, validators.signing_key)'

interface ScoreResponse {
  validation_public_key: string
  date: Date
  chain: string
  score: string
  total: string
  missed: string
  incomplete: boolean
}

interface DatabaseResponse {
  master_key: string
  date: Date
  chain: string
  agreement: AgreementScore
}

/**
 * Formats database query.
 *
 * @param response - Response from the database query.
 * @returns Formatted daily score.
 */
function formatResponse(response: DatabaseResponse): ScoreResponse {
  const {
    master_key,
    date,
    chain,
    agreement: { validated, missed, incomplete },
  } = response
  const denominator = validated + missed
  const score: number = denominator === 0 ? 0 : validated / denominator
  date.setHours(0, 0, 0, 0)

  return {
    validation_public_key: master_key,
    date,
    chain,
    score: score.toFixed(5),
    total: (validated + missed).toString(),
    missed: missed.toString(),
    incomplete: incomplete || new Date() < date,
  }
}

/**
 * Gets all daily score reports for a validator.
 *
 * Accepts either a master key or a signing key, matching the behavior of the
 * validator endpoint. Validators that never published a manifest have a null
 * `master_key` and are only reachable by their signing key.
 *
 * @param public_key - Master key or signing key of validator.
 * @returns A promise that resolves to an array of ScoreResponse.
 */
async function getReports(public_key: string): Promise<ScoreResponse[]> {
  return query('daily_agreement')
    .select([
      db().raw(`${EFFECTIVE_KEY} as master_key`),
      'daily_agreement.day as date',
      'validators.chain',
      'daily_agreement.agreement',
    ])
    .innerJoin('validators', (join) => {
      join.on(db().raw(`daily_agreement.main_key = ${EFFECTIVE_KEY}`))
    })
    .where((builder) => {
      builder
        .where('validators.master_key', '=', public_key)
        .orWhere('validators.signing_key', '=', public_key)
    })
    .andWhere('validators.revoked', '=', 'false')
    .then((resp: DatabaseResponse[]) => resp.map(formatResponse))
}

/**
 * Handles manifest request.
 *
 * @param req - Express request.
 * @param res - Express response.
 * @returns Void.
 */
export default async function handleValidatorReport(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const public_key = req.params.publicKey
    const scores: ScoreResponse[] = await getReports(public_key)

    const response = {
      result: 'success',
      count: scores.length,
      reports: scores,
    }

    res.status(200).send(response)
  } catch (err: unknown) {
    log.error('Error handleValidatorReport: ', err)
    res.status(500).send({
      result: 'error',
      message: `internal error: ${(err as Error).message}`,
    })
  }
}
