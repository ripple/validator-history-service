import { Request, Response } from 'express'

import { query } from '../../../shared/database'
import { AgreementScore } from '../../../shared/types'

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
  date.setHours(23, 0, 0, 0)

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
 * @param master_key - Master key of validator.
 * @returns A promise that resolves to an array of ScoreResponse.
 */
async function getReports(master_key: string): Promise<ScoreResponse[]> {
  return query('daily_agreement')
    .select([
      'validators.master_key',
      'daily_agreement.day as date',
      'validators.chain',
      'daily_agreement.agreement',
    ])
    .innerJoin(
      'validators',
      'daily_agreement.master_key',
      'validators.master_key',
    )
    .where('validators.master_key', '=', master_key)
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
    const master_key = req.params.publicKey
    const scores: ScoreResponse[] = await getReports(master_key)

    const response = {
      result: 'success',
      count: scores.length,
      reports: scores,
    }

    res.send(response)
  } catch {
    res.send({ result: 'error', message: 'internal error' })
  }
}
