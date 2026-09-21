import { Request, Response } from 'express'

import { db, query } from '../../../shared/database'
import { AgreementScore } from '../../../shared/types'
import logger from '../../../shared/utils/logger'

import { CACHE_INTERVAL_MILLIS, EFFECTIVE_KEY } from './utils'

const log = logger({ name: 'api-daily-report' })

interface DailyScoreResponse {
  validation_public_key: string
  date: string
  chain: string
  score: string
  total: string
  missed: string
  incomplete: boolean
}

interface DatabaseResponse {
  master_key: string
  date: string
  chain: string
  agreement: AgreementScore
}

interface Cache {
  scores: DailyScoreResponse[]
  time: number
}

const cache: Cache = {
  scores: [],
  time: Date.now(),
}

/**
 * Formats database query.
 *
 * @param response - Response from the database query.
 * @returns Formatted daily score.
 */
function formatResponse(response: DatabaseResponse): DailyScoreResponse {
  const {
    master_key,
    date,
    chain,
    agreement: { validated, missed },
  } = response
  const denominator = validated + missed
  const score: number = denominator === 0 ? 0 : validated / denominator
  const time = new Date()
  time.setHours(23, 0, 0, 0)

  return {
    validation_public_key: master_key,
    date,
    chain,
    score: score.toFixed(5),
    total: (validated + missed).toString(),
    missed: missed.toString(),
    incomplete: new Date() < time,
  }
}

/**
 * Reads today's daily agreement scores from the database.
 *
 * Joins on the effective key so that validators without a manifest (null
 * `master_key`) are included, matching the validator reports endpoint.
 *
 * @returns Daily scores for every validator with agreement data today.
 */
async function getReports(): Promise<DailyScoreResponse[]> {
  const day = new Date()
  day.setHours(0, 0, 0, 0)

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
    .where('daily_agreement.day', '=', day)
    .then((resp: DatabaseResponse[]) => resp.map(formatResponse))
}

/**
 * Updates cached Nodes.
 *
 * @returns Void.
 */
async function cacheScores(): Promise<void> {
  try {
    cache.scores = await getReports()
    cache.time = Date.now()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TODO: clean up
  } catch (err: any) {
    log.error(err)
  }
}

void cacheScores()

/**
 * Handles Nodes request.
 *
 * @param _u - Unused express request.
 * @param res - Express response.
 */
export default async function handleDailyScores(
  _u: Request,
  res: Response,
): Promise<void> {
  try {
    if (Date.now() - cache.time > CACHE_INTERVAL_MILLIS) {
      await cacheScores()
    }

    res.status(200).send({
      result: 'success',
      count: cache.scores.length,
      reports: cache.scores,
    })
  } catch (err: unknown) {
    log.error('Error handleDailyScores: ', err)
    res.status(500).send({
      result: 'error',
      message: `internal error: ${(err as Error).message}`,
    })
  }
}
