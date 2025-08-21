import { Request, Response } from 'express'

import { getMissingLedgers } from '../../../shared/database/validatedLedgers'

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
  } catch (err) {
    return res.status(500).json({
      result: 'error',
      message: 'Internal server error',
    })
  }
}
