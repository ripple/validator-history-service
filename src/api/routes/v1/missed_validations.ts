import { Request, Response } from 'express'

import { query } from '../../../shared/database'
import { MissedValidation } from '../../../shared/types'

/**
 * Handles missed validations requests.
 *
 * @param _u - Unused Request object.
 * @param res - Response containing ripple health check result.
 */
export default async function handleMissedValidations(
  _u: Request,
  res: Response,
): Promise<void> {
  try {
    const count = (await query('missed_validations').select(
      '*',
    )) as MissedValidation[]
    res.status(200).send(count)
  } catch {
    res.send({ result: 'error', message: 'internal error' })
  }
}
