import { Request, Response } from 'express'

import { query } from '../../../shared/database'

/**
 * Handles health check requests.
 *
 * @param _u - Unused Request object.
 * @param res - Response containing ripple health check result.
 */
export default async function handleHealth(
  _u: Request,
  res: Response,
): Promise<void> {
  try {
    const count = (await query('crawls')
      .countDistinct('ip')
      .where('connected', '=', true)) as Array<{ [key: string]: number }>
    res.status(200).send(count[0])
  } catch {
    res.send({ result: 'error', message: 'internal error' })
  }
}
