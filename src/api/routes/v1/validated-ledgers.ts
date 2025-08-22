import { Request, Response } from 'express'

import { getRecentValidatedLedgers } from '../../../shared/database/validatedLedgers'
import { StreamLedger } from '../../../shared/types'

/**
 * Handles the request to retrieve recent validated ledgers for a specific network.
 *
 * @param req - The Express request object containing the network parameter and optional limit query.
 * @param res - The Express response object to send the response.
 * @returns A promise resolving to the response with validated ledgers or an error.
 */
export default async function handleValidatedLedgers(
  req: Request,
  res: Response,
): Promise<Response> {
  const network = req.params.network
  const limitStr = req.query.limit as string | undefined
  let limit: number | undefined

  if (limitStr) {
    limit = parseInt(limitStr, 10)
    if (limit <= 0) {
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
    if (err instanceof Error) {
      return res.status(500).json({
        result: 'error',
        message: `Internal server error: ${err.message}`,
      })
    }
    return res.status(500).json({
      result: 'error',
      message: 'Internal server error',
    })
  }
}
