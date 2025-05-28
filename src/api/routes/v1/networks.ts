import { Request, Response } from 'express'

import { getNetworks } from '../../../shared/database'
import { Network } from '../../../shared/database/networks'
import logger from '../../../shared/utils/logger'

const log = logger({ name: 'api-networks' })

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
    res.status(200).send(response)
  } catch (err: unknown) {
    log.error('Error handleNetworks: ', err)
    res.status(500).send({
      result: 'error',
      message: `internal error: ${(err as Error).message}`,
    })
  }
}
