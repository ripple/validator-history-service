import { Request, Response } from 'express'

import { getRecentValidatedLedgers } from '../../../shared/database/validatedLedgers'
import { StreamLedger } from '../../../shared/types'

export default async function handleValidatedLedgers(
  req: Request,
  res: Response,
): Promise<Response> {
  const network = req.params.network
  const limitStr = req.query.limit as string | undefined
  let limit: number | undefined

  if (limitStr) {
    limit = parseInt(limitStr, 10)
    if (isNaN(limit) || limit <= 0) {
      return res.status(400).json({
        result: 'error',
        message: 'Invalid limit: must be a positive number',
      })
    }
  }

  try {
    const ledgers: StreamLedger[] = await getRecentValidatedLedgers(
      network,
      limit,
    )
    return res.status(200).json({
      result: 'success',
      count: ledgers.length,
      ledgers,
    })
  } catch (err) {
    return res.status(500).json({
      result: 'error',
      message: 'Internal server error',
    })
  }
}
