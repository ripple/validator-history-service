import { Request, Response } from 'express'

import { staleAmendmentsData } from '../../../connection-manager/amendments'
import { query } from '../../../shared/database'
import { AmendmentsInfo } from '../../../shared/types'
import { isEarlierVersion } from '../../../shared/utils'
import logger from '../../../shared/utils/logger'

interface AmendmentsInfoResponse {
  result: 'success' | 'error'
  count: number
  stale_name: boolean
  stale_version: boolean
  amendments: AmendmentsInfo[]
}

interface AmendmentInfoResponse {
  result: 'success' | 'error'
  stale_name: boolean
  stale_version: boolean
  amendment: AmendmentsInfo
}

interface Cache {
  amendments: AmendmentsInfo[]
  time: number
}

const log = logger({ name: 'api-amendments' })

const cache: Cache = {
  amendments: [],
  time: Date.now(),
}

/**
 * Updates amendments in cache.
 *
 * @returns Void.
 */
async function cacheAmendmentsInfo(): Promise<void> {
  try {
    cache.amendments = await query('amendments_info').select('*')
    cache.amendments.sort((prev: AmendmentsInfo, next: AmendmentsInfo) => {
      if (isEarlierVersion(prev.rippled_version, next.rippled_version)) {
        return 1
      }
      return -1
    })
    cache.time = Date.now()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TODO: clean up
  } catch (err: any) {
    log.error(err.toString())
  }
}

void cacheAmendmentsInfo()

/**
 * Handles Amendments Info request.
 *
 * @param _u - Unused express request.
 * @param res - Express response.
 */
export async function handleAmendmentsInfo(
  _u: Request,
  res: Response,
): Promise<void> {
  try {
    if (Date.now() - cache.time > 60 * 1000) {
      await cacheAmendmentsInfo()
    }
    const amendments: AmendmentsInfo[] = cache.amendments
    const response: AmendmentsInfoResponse = {
      result: 'success',
      count: amendments.length,
      stale_name: staleAmendmentsData.staleName,
      stale_version: staleAmendmentsData.staleVersion,
      amendments,
    }
    res.send(response)
  } catch {
    res.send({ result: 'error', message: 'internal error' })
  }
}

/**
 * Handles Amendment Info request.
 *
 * @param req - Unused express request.
 * @param res - Express response.
 */
export async function handleAmendmentInfo(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const { param } = req.params
    if (Date.now() - cache.time > 60 * 1000) {
      await cacheAmendmentsInfo()
    }
    const amendments: AmendmentsInfo[] = cache.amendments.filter(
      (amend) => amend.name === param || amend.id === param,
    )
    if (amendments.length === 0) {
      res.send({ result: 'error', message: "incorrect amendment's id/name" })
      return
    }
    const response: AmendmentInfoResponse = {
      result: 'success',
      stale_name: staleAmendmentsData.staleName,
      stale_version: staleAmendmentsData.staleVersion,
      amendment: amendments[0],
    }
    res.send(response)
  } catch {
    res.send({ result: 'error', message: 'internal error' })
  }
}
