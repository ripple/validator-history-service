import { Request, Response } from 'express'

import { getNetworks } from '../../../shared/database'
import { Network } from '../../../shared/database/networks'

/**
 * Handle networks request.
 *
 * @param _u - Unused express request.
 * @param res - Express response.
 * @returns Void.
 */
export default async function handleNetworks(
  _u: Request,
  res: Response,
): Promise<void> {
  try {
    const networks: Network[] = await getNetworks()
    const response = {
      result: 'success',
      count: networks.length,
      networks,
    }
    res.send(response)
  } catch (err) {
    res.status(500).send({ result: 'error', message: err })
  }
}
