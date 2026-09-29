import { Request, Response } from 'express'

import { db } from '../../../shared/database'
import logger from '../../../shared/utils/logger'

const log = logger({ name: 'api-validator-diagnostics' })

/**
 * TEMPORARY diagnostic endpoint.
 *
 * Reports aggregate counts over the `validators` table so the shape of the
 * table can be inspected without database access. Returns counts only - never
 * rows - so it stays cheap regardless of table size.
 *
 * Remove once the dev `validators` table has been explained and cleaned up.
 *
 * @param _u - Unused express request.
 * @param res - Express response.
 */
export default async function handleValidatorDiagnostics(
  _u: Request,
  res: Response,
): Promise<void> {
  try {
    const result = await db().raw<{ rows: Array<Record<string, string>> }>(`
      SELECT
        count(*)                                                      AS total,
        count(*) FILTER (WHERE revoked = false)                       AS revoked_false,
        count(*) FILTER (WHERE revoked = true)                        AS revoked_true,
        count(*) FILTER (WHERE revoked IS NULL)                       AS revoked_null,
        count(*) FILTER (WHERE last_ledger_time IS NULL)              AS last_ledger_time_null,
        count(*) FILTER (WHERE last_ledger_time < now() - interval '30 days')
                                                                      AS older_than_30d,
        count(*) FILTER (WHERE last_ledger_time >= now() - interval '30 days')
                                                                      AS seen_last_30d,
        count(*) FILTER (WHERE last_ledger_time < now() - interval '30 days'
                           AND unl IS NULL)                           AS purgeable_now,
        count(*) FILTER (WHERE unl IS NOT NULL)                       AS unl_tagged,
        count(*) FILTER (WHERE current_index = 1000000)               AS at_index_1000000,
        count(*) FILTER (WHERE chain IS NULL)                         AS chain_null,
        min(last_ledger_time)                                         AS oldest_seen,
        max(last_ledger_time)                                         AS newest_seen
      FROM validators`)

    res.status(200).send({ result: 'success', validators: result.rows[0] })
  } catch (err: unknown) {
    log.error('Error handleValidatorDiagnostics: ', err)
    res.status(500).send({
      result: 'error',
      message: `internal error: ${(err as Error).message}`,
    })
  }
}
