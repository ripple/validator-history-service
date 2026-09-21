import { Request, Response } from 'express'

import { db, query } from '../../../shared/database'
import { AgreementScore } from '../../../shared/types'
import logger from '../../../shared/utils/logger'

import { CANONICAL_KEY, EFFECTIVE_KEY, MATCHES_PUBLIC_KEY } from './utils'

const log = logger({ name: 'api-validator-report' })

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
 * Accepts a master key or a signing key, matching the behavior of the validator
 * endpoint. Agreement rows are keyed by the master key when one is recorded on
 * the validator and by the signing key otherwise, so the join and the lookup
 * differ. The join uses the key the rows were written under, while the lookup
 * also consults `manifests` so a validator stays reachable by master key even
 * when `validators.master_key` is null.
 *
 * @param public_key - Master key or signing key of validator.
 * @returns A promise that resolves to an array of ScoreResponse.
 */
async function getReports(public_key: string): Promise<ScoreResponse[]> {
  return query('daily_agreement')
    .select([
      db().raw(`${CANONICAL_KEY} as master_key`),
      'daily_agreement.day as date',
      'validators.chain',
      'daily_agreement.agreement',
    ])
    .innerJoin('validators', (join) => {
      join.on(db().raw(`daily_agreement.main_key = ${EFFECTIVE_KEY}`))
    })
    .whereRaw(MATCHES_PUBLIC_KEY, [public_key, public_key, public_key])
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
