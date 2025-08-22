import { Request, Response } from 'express'

import { getMissingLedgers } from '../../../shared/database/validatedLedgers'

/**
 * Handles the request to retrieve missing ledgers for a specific network.
 *
 * @param req - The Express request object containing the network parameter.
 * @param res - The Express response object to send the response.
 * @returns A promise resolving to the response with missing ledgers or an error.
 */
export default async function handleMissingLedgers(
  req: Request,
  res: Response,
): Promise<Response> {
  const network = req.params.network

  try {
    const missingLedgers = await getMissingLedgers(network)

    return res.status(200).json({
      result: 'success',
      count: missingLedgers.length,
      missingLedgers,
    })
  } catch (_err) {
    return res.status(500).json({
      result: 'error',
      message: 'Internal server error',
    })
  }
}
