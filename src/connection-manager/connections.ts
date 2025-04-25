/* eslint-disable max-lines-per-function  -- Disable for this file with complex websocket rules. */
/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Disable since websocket messages are indeterministic */
/* eslint-disable @typescript-eslint/no-unsafe-member-access -- Disable since websocket messages are indeterministic */
/* eslint-disable @typescript-eslint/no-unsafe-call -- -- Disable since websocket messages are indeterministic */
import WebSocket from 'ws'
import { Client, LedgerEntryResponse, RIPPLED_API_V1 } from 'xrpl'
import { Amendments, AMENDMENTS_ID } from 'xrpl/dist/npm/models/ledger'

import {
  query,
  saveNodeWsUrl,
  clearConnectionsDb,
  getNetworks,
  saveAmendmentsStatus,
} from '../shared/database'
import { fetchAmendmentInfo } from '../shared/database/amendments'
import { FeeVote } from '../shared/types'
import logger from '../shared/utils/logger'

import {
  backtrackAmendmentStatus,
  handleWsMessageSubscribeTypes,
  subscribe,
} from './wsHandling'

const log = logger({ name: 'connections' })
const ports = [443, 80, 6005, 6006, 51233, 51234]
const protocols = ['wss://', 'ws://']
const connections: Map<string, WebSocket> = new Map()
const networkFee: Map<string, FeeVote> = new Map()
const validationNetworkDb: Map<string, string> = new Map()
const enableAmendmentLedgerIndexMap: Map<string, number> = new Map()
const CM_INTERVAL = 60 * 60 * 1000
const WS_TIMEOUT = 10000
const REPORTING_INTERVAL = 1 * 60 * 1000
const BACKTRACK_INTERVAL = 30 * 60 * 1000
const BASE_RETRY_DELAY = 1 * 1000
const MAX_RETRY_DELAY = 30 * 1000

// The frequent closing codes seen so far after connections established include:
//  1008: Policy error: client is too slow. (Most frequent)
//  1006: Abnormal Closure: The connection was closed abruptly without a proper handshake or a clean closure.
//  1005: No Status Received: An empty or undefined status code is used to indicate no further details about the closure.
// Reconnection should happen after seeing these codes for established connections.
const CLOSING_CODES = [1005, 1006, 1008]
let cmStarted = false

/**
 * Sets the handlers for each WebSocket object.
 *
 * @param ws - A WebSocket object.
 * @param networks - The networks of the node we are trying to reach where it retrieves validations.
 * @param retryCount - Retry count for exponential backoff.
 * @returns A Promise that resolves to void once a connection has been created or timeout has occured.
 */
async function setHandlers(
  ws: WebSocket,
  networks: string | undefined,
  retryCount = 0,
): Promise<void> {
  const ledger_hashes: string[] = []
  return new Promise(function setHandlersPromise(resolve, _reject) {
    ws.on('open', () => {
      log.info(
        `Websocket connection opened for: ${ws.url} on ${
          networks ?? 'unknown network'
        }`,
      )

      if (connections.has(ws.url)) {
        resolve()
        return
      }
      void saveNodeWsUrl(ws.url, true)
      connections.set(ws.url, ws)
      subscribe(ws)

      resolve()
    })
    ws.on('message', function handleMessage(message: string) {
      let data
      try {
        data = JSON.parse(message)
      } catch (error: unknown) {
        log.error('Error parsing validation message', error)
        return
      }

      void handleWsMessageSubscribeTypes(
        data,
        ledger_hashes,
        networks,
        networkFee,
        ws,
        validationNetworkDb,
        enableAmendmentLedgerIndexMap,
      )
    })
    ws.on('close', async (code, reason) => {
      log.error(
        `Websocket closed for ${ws.url} on ${
          networks ?? 'unknown network'
        } with code ${code} and reason ${reason.toString('utf-8')}.`,
      )

      if (connections.get(ws.url)?.url === ws.url) {
        connections.delete(ws.url)
        void saveNodeWsUrl(ws.url, false)
      }
      ws.terminate()

      const delay = BASE_RETRY_DELAY * 2 ** retryCount

      if (CLOSING_CODES.includes(code) && delay <= MAX_RETRY_DELAY) {
        log.info(
          `Reconnecting to ${ws.url} on ${
            networks ?? 'unknown network'
          } after ${delay}ms...`,
        )

        setTimeout(async () => {
          // Open a new Websocket connection for the same url
          const newWS = new WebSocket(ws.url, { handshakeTimeout: WS_TIMEOUT })

          await setHandlers(newWS, networks, retryCount + 1)
        }, delay)
      }

      resolve()
    })
    ws.on('error', (err) => {
      log.error(
        `Websocket connection error for ${ws.url} on ${
          networks ?? 'unknown network'
        } - ${err.message}`,
      )

      if (connections.get(ws.url)?.url === ws.url) {
        connections.delete(ws.url)
        void saveNodeWsUrl(ws.url, false)
      }
      ws.terminate()
      resolve()
    })
  })
}

interface WsNode {
  ip: string
  ws_url?: string
  networks?: string
}

/**
 * Tries to find a valid WebSockets endpoint for a node.
 *
 * @param node - The node we are trying to connect to.
 * @returns A promise that resolves to void once a valid endpoint to the node has been found or timeout occurs.
 */
async function findConnection(node: WsNode): Promise<void> {
  if (!node.ip || node.ip.search(':') !== -1) {
    return Promise.resolve()
  }

  if (Array.from(connections.keys()).some((key) => key.includes(node.ip))) {
    return Promise.resolve()
  }

  if (node.ws_url) {
    const ws = new WebSocket(node.ws_url, { handshakeTimeout: WS_TIMEOUT })
    return setHandlers(ws, node.networks)
  }

  const promises: Array<Promise<void>> = []
  for (const port of ports) {
    for (const protocol of protocols) {
      const url = `${protocol}${node.ip}:${port}`
      const ws = new WebSocket(url, { handshakeTimeout: WS_TIMEOUT })
      promises.push(setHandlers(ws, node.networks))
    }
  }
  await Promise.all(promises)
  return Promise.resolve()
}

async function getValidationNetworkDb(): Promise<void> {
  const validatorNetwork: Array<{ signing_key: string; networks: string }> =
    await query('validators').select('signing_key', 'networks')
  for (const entry of validatorNetwork) {
    validationNetworkDb.set(entry.signing_key, entry.networks)
  }
}

/**
 * Creates connections to nodes found in the database.
 *
 * @returns A promise that resolves to void once all possible connections have been created.
 */
async function createConnections(): Promise<void> {
  log.info('Finding Connections...')
  validationNetworkDb.clear()
  await getValidationNetworkDb()
  const tenMinutesAgo = new Date()
  tenMinutesAgo.setMinutes(tenMinutesAgo.getMinutes() - 10)

  const nodes = await query('crawls')
    .select(['ip', 'ws_url', 'networks'])
    .whereNotNull('ip')
    .andWhere('start', '>', tenMinutesAgo)

  const promises: Array<Promise<void>> = []

  nodes.forEach((node: WsNode) => {
    promises.push(findConnection(node))
  })
  await Promise.all(promises)

  log.info(`${connections.size} connections created`)
}

setInterval(() => {
  log.info(`${connections.size} connections established`)
}, REPORTING_INTERVAL)

/**
 * Starts the connection manager and refreshes connections every CM_INTERVAL.
 *
 * @param network - Network name.
 * @param hostName - Hostname to connect.
 * @returns Void.
 */
async function getAmendmentsFromLedgerEntry(
  network: string,
  hostName: string,
): Promise<void> {
  const allUrls: string[] = []
  for (const port of ports) {
    for (const protocol of protocols) {
      allUrls.push(`${protocol}${hostName}:${port}`)
    }
  }

  for (const url of allUrls) {
    try {
      const client = new Client(url)
      client.apiVersion = RIPPLED_API_V1
      await client.connect()

      const amendmentLedgerEntry: LedgerEntryResponse<Amendments> =
        await client.request({
          command: 'ledger_entry',
          index: AMENDMENTS_ID,
          ledger_index: 'validated',
          api_version: RIPPLED_API_V1,
        })

      await saveAmendmentsStatus(
        amendmentLedgerEntry.result.node?.Amendments ?? [],
        network,
      )

      await client.disconnect()

      return
    } catch (err) {
      log.info(
        `Failed to connect ${url} - ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
    }
  }

  log.error(`Not able to fetch Amendments ledger entry for ${network}`)
}

/**
 * Fetch amendments from ledger entry and .
 *
 * @returns Void.
 */
async function fetchAmendmentsFromLedgerEntry(): Promise<void> {
  const promises: Array<Promise<void>> = []

  for (const network of await getNetworks()) {
    promises.push(getAmendmentsFromLedgerEntry(network.id, network.entry))
  }

  await Promise.all(promises)
}

/**
 * Starts the connection manager and refreshes connections every CM_INTERVAL.
 *
 * @returns Void.
 */
export default async function startConnections(): Promise<void> {
  if (!cmStarted) {
    cmStarted = true
    await fetchAmendmentInfo()
    await clearConnectionsDb()
    await fetchAmendmentsFromLedgerEntry()
    await createConnections()
    await backtrackAmendmentStatus()

    setInterval(() => {
      void fetchAmendmentInfo()
      void fetchAmendmentsFromLedgerEntry()
      void createConnections()
    }, CM_INTERVAL)

    setInterval(() => {
      void backtrackAmendmentStatus()
    }, BACKTRACK_INTERVAL)
  }
}
