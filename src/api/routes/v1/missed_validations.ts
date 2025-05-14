import { Request, Response } from 'express'

import { query } from '../../../shared/database'
import { MissedValidation } from '../../../shared/types'

const MissedValidationsBySigningKey: Map<
  string,
  {
    count: number
    entries: Array<{
      master_key?: string
      ledger_index: string
      ledger_hash: string
    }>
  }
> = new Map()

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
    const missed = (await query('missed_validations').select(
      '*',
    )) as MissedValidation[]
    for (const record of missed) {
      const { signing_key, master_key, ledger_index, ledger_hash } = record

      let group = MissedValidationsBySigningKey.get(signing_key)

      // eslint-disable-next-line max-depth -- Disabled for testing.
      if (!group) {
        group = {
          count: 0,
          entries: [],
        }
        MissedValidationsBySigningKey.set(signing_key, group)
      }

      group.entries.push({ master_key, ledger_index, ledger_hash })
      group.count += 1
    }

    res.status(200).send(Object.fromEntries(MissedValidationsBySigningKey))
  } catch {
    res.send({ result: 'error', message: 'internal error' })
  }
}
