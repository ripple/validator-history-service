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
  } catch {
    res.send({ result: 'error', message: 'internal error' })
  }
}

/**
 * Handles monitoring metrics requests.
 *
 * @param req - HTTP request object.
 * @param res - Response containing number of connected nodes in Prometheus exposition format.
 */
export async function handleWebSocketHealthMetrics(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const { network } = req.params
    const result = (await query('connection_health')
      .count('ws_url')
      .where('network', '=', network)
      .andWhere('connected', '=', true)) as Array<{ [key: string]: number }>

    const metrics = `connected_nodes{network="${network}"} ${result[0].count}`
    res.set('Content-Type', 'text/plain')
    res.status(200)
    res.send(metrics)
  } catch {
    res.send({ result: 'error', message: 'internal error' })
  }
}
