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
    const count = (await query('connection_health')
      .count('ws_url')
      .where('connected', '=', true)) as Array<{ [key: string]: number }>
    res.status(200).send(count[0])
  } catch (err: unknown) {
    res.send({
      result: 'error',
      message: `internal error: ${(err as Error).message}`,
    })
  }
}

/**
 * Handles monitoring metrics requests.
 *
 * @param _req - HTTP request object.
 * @param res - Response containing number of connected nodes in Prometheus exposition format.
 */
export async function handleMonitoringMetrics(
  _req: Request,
  res: Response,
): Promise<void> {
  try {
    const result = (await query('connection_health')
      .select('network')
      .count('* as count')
      .where('connected', '=', true)
      .groupBy('network')) as Array<{ network: string; count: number }>

    const metrics = result
      .map((row) => `connected_nodes{network="${row.network}"} ${row.count}`)
      .join('\n')

    res.set('Content-Type', 'text/plain')
    res.status(200)
    res.send(metrics)
  } catch (err: unknown) {
    res.send({
      result: 'error',
      message: `internal error: ${(err as Error).message}`,
    })
  }
}
