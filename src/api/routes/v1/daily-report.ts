import { Request, Response } from 'express'

import { query } from '../../../shared/database'
import { AgreementScore } from '../../../shared/types'
import logger from '../../../shared/utils/logger'

import { CACHE_INTERVAL_MILLIS } from './utils'

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
  const score: number = validated / (validated + missed)
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
 * Reads nodes from database.
 *
 * @returns Locations of nodes crawled in the last day.
 */
async function getReports(): Promise<DailyScoreResponse[]> {
  const day = new Date()
  day.setHours(0, 0, 0, 0)

  return query('daily_agreement')
    .select([
      'validators.master_key',
      'daily_agreement.day as date',
      'validators.chain',
      'daily_agreement.agreement',
    ])
    .innerJoin(
      'validators',
      'daily_agreement.main_key',
      'validators.master_key',
    )
    .where('daily_agreement.day', '=', day)
    .whereNotNull('validators.master_key')
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

    res.send({
      result: 'success',
      count: cache.scores.length,
      reports: cache.scores,
    })
  } catch {
    res.send({ result: 'error', message: 'internal error' })
  }
}
