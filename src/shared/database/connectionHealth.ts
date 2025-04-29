import { ConnectionHealth } from '../types'
import logger from '../utils/logger'

import { query } from './utils'

const log = logger({ name: 'connection_health' })

/**
 * Saves the Websocket connection info of a rippled node.
 *
 * @param connectionHealth -- Connection Health object to save or update.
 * @returns Void.
 */
export async function saveConnectionHealth(
  connectionHealth: ConnectionHealth,
): Promise<void> {
  try {
    await query('connection_health')
      .insert(connectionHealth)
      .onConflict('ws_url')
      .merge()
  } catch (err) {
    log.error(
      `DB error in saveConnectionHealth for ${connectionHealth.ws_url} : ${
        (err as Error).message
      }`,
    )
  }
}

/**
 * Checks if a node is currently connected by its public key.
 *
 * @param public_key - The public key of the node.
 * @returns A boolean indicating whether the node is connected.
 */
export async function isNodeConnectedByPublicKey(
  public_key: string,
): Promise<boolean> {
  try {
    const result = (await query('connection_health')
      .select('ws_url')
      .where({ public_key, connected: true })
      .first()) as string | undefined

    return result !== undefined
  } catch (err) {
    log.error(
      `DB error in isNodeConnectedByPublicKey for ${public_key}: ${
        (err as Error).message
      }`,
    )
    return false
  }
}

/**
 * Checks if a node is currently connected by its IP address.
 *
 * @param ip - The IP address of the node.
 * @returns A boolean indicating whether the node is connected.
 */
export async function isNodeConnectedByIp(ip: string): Promise<boolean> {
  try {
    const result = (await query('connection_health')
      .select('ws_url')
      .whereLike('ws_url', `%${ip}%`)
      .andWhere('connected', '=', true)
      .first()) as string | undefined

    return result !== undefined
  } catch (err) {
    log.error(
      `DB error in isNodeConnectedByIp for ${ip}: ${(err as Error).message}`,
    )
    return false
  }
}

/**
 * Checks if a node is currently connected by its WebSocket URL.
 *
 * @param ws_url - The WebSocket URL of the node.
 * @returns A boolean indicating whether the node is connected.
 */
export async function isNodeConnectedByWsUrl(ws_url: string): Promise<boolean> {
  try {
    const result = (await query('connection_health')
      .select('ws_url')
      .where('ws_url', '=', ws_url)
      .andWhere('connected', '=', true)
      .first()) as string | undefined

    return result !== undefined
  } catch (err) {
    log.error(
      `DB error in isNodeConnectedByWsUrl for ${ws_url}: ${
        (err as Error).message
      }`,
    )
    return false
  }
}

/**
 * Updates the connection health status of a node in the database.
 *
 * @param ws_url - The WebSocket URL of the node.
 * @param connected - The connection status to update.
 * @returns Promise that resolves to void.
 */
export async function updateConnectionHealthStatus(
  ws_url: string,
  connected: boolean,
): Promise<void> {
  try {
    await query('connection_health')
      .where('ws_url', '=', ws_url)
      .update({ connected, status_update_time: new Date() })
  } catch (err) {
    log.error(
      `Failed to update connection status for ${ws_url}: ${
        (err as Error).message
      }`,
    )
  }
}

/**
 * Retrieves the total number of connected nodes from the database.
 *
 * @returns The total count of connected nodes.
 */
export async function getTotalConnectedNodes(): Promise<number> {
  try {
    const result = await query('connection_health')
      .where('connected', true)
      .count<{ count: string }>('id as count')
      .first()

    return result ? parseInt(result.count, 10) : 0
  } catch (err) {
    log.error(`DB error in getTotalConnectedNodes: ${(err as Error).message}`)
    return 0
  }
}

/**
 * Sets connected column to false and status_update_time to current time.
 *
 * @returns Promise that resolves to void.
 *
 */
export async function clearConnectionHealthDb(): Promise<void> {
  try {
    await query('connection_health').update({
      connected: false,
      status_update_time: new Date(),
    })
  } catch (err) {
    log.error('Error clearing connections', err)
  }
}
