/* eslint-disable max-lines-per-function  -- Disable for this file with complex websocket rules. */
import WebSocket from 'ws'
import { LedgerEntryResponse } from 'xrpl'
import { LedgerResponseExpanded } from 'xrpl/dist/npm/models/methods/ledger'

import {
  query,
  saveNodeWsUrl,
  clearConnectionsDb,
  getNetworks,
} from '../shared/database'
import { fetchAmendmentInfo } from '../shared/database/amendments'
import { FeeVote } from '../shared/types'
import logger from '../shared/utils/logger'

import {
  backtrackAmendmentStatus,
  getAmendmentLedgerEntry,
  handleWsMessageLedgerEnableAmendments,
  handleWsMessageLedgerEntryAmendments,
  handleWsMessageSubscribeTypes,
  subscribe,
} from './wsHandling'

const log = logger({ name: 'connections' })
const ports = [443, 80, 6005, 6006, 51233, 51234]
const protocols = ['wss://', 'ws://']
const connections: Map<string, WebSocket> = new Map()
const networkFee: Map<string, FeeVote> = new Map()
const CM_INTERVAL = 60 * 60 * 1000
const WS_TIMEOUT = 10000
const REPORTING_INTERVAL = 15 * 60 * 1000
const BACKTRACK_INTERVAL = 30 * 60 * 1000

// The frequent closing codes seen so far after connections established include:
//  1008: Policy error: client is too slow. (Most frequent)
//  1006: Abnormal Closure: The connection was closed abruptly without a proper handshake or a clean closure.
//  1005: No Status Received: An empty or undefined status code is used to indicate no further details about the closure.
// Reconnection should happen after seeing these codes for established connections.
const CLOSING_CODES = [1005, 1006, 1008]
let connectionsInitialized = false
let cmStarted = false

/**
 * Sets the handlers for each WebSocket object.
 *
 * @param ip - The ip address of the node we are trying to reach.
 * @param ws - A WebSocket object.
 * @param networks - The networks of the node we are trying to reach where it retrieves validations.
 * @param isInitialNode - Whether source node is an entry/initial node for the network.
 * @returns A Promise that resolves to void once a connection has been created or timeout has occured.
 */
async function setHandlers(
  ip: string,
  ws: WebSocket,
  networks: string | undefined,
  isInitialNode = false,
): Promise<void> {
  const ledger_hashes: string[] = []
  return new Promise(function setHandlersPromise(resolve, _reject) {
    ws.on('open', () => {
      if (networks === 'xahau-main') {
        log.info(`Debug1 connection opened:${ws.url}`)
      }
      if (connections.has(ip)) {
        resolve()
        return
      }
      void saveNodeWsUrl(ws.url, true)
      connections.set(ip, ws)
      subscribe(ws)

      // Use LedgerEntry to look for amendments that has already been enabled on a network when connections
      // first start, or when a new network is added. This only need to be ran only once on the initial node
      // on the network table per network, as new enabled amendments afterwards will be added when there's a
      // EnableAmendment tx happens, which would provide more information compared to ledger_entry (please
      // look at handleWsMessageLedgerEnableAmendments function for more details).
      if (isInitialNode) {
        getAmendmentLedgerEntry(ws)
      }
      resolve()
    })
    ws.on('message', function handleMessage(message: string) {
      if (networks === 'xahau-main') {
        log.info(`Debug1 data received:${ws.url}`)
      }
      let data
      try {
        data = JSON.parse(message)
      } catch (error: unknown) {
        log.error('Error parsing validation message', error)
        return
      }

      if (data.result?.node) {
        void handleWsMessageLedgerEntryAmendments(
          data as LedgerEntryResponse,
          networks,
        )
      } else if (data.result?.ledger && isInitialNode) {
        void handleWsMessageLedgerEnableAmendments(
          data as LedgerResponseExpanded,
          networks,
        )
      } else {
        void handleWsMessageSubscribeTypes(
          data,
          ledger_hashes,
          networks,
          networkFee,
          ws,
        )
      }
    })
    ws.on('close', async (code, reason) => {
      if (networks === 'xahau-main') {
        log.info(
          `Debug1 connection closed:${ws.url}:${code}:${reason.toString(
            'utf-8',
          )}`,
        )
      }
      const nodeNetworks = networks ?? 'unknown network'
      if (connectionsInitialized) {
        log.error(
          `Websocket closed for ${
            ws.url
          } on ${nodeNetworks} with code ${code} and reason ${reason.toString(
            'utf-8',
          )}.`,
        )
        if (CLOSING_CODES.includes(code)) {
          log.info(
            `Reconnecting to ${ws.url} on ${networks ?? 'unknown network'}...`,
          )
          // Open a new Websocket connection for the same url
          const newWS = new WebSocket(ws.url, { handshakeTimeout: WS_TIMEOUT })
          // Clean up the old Websocket connection
          connections.delete(ip)
          ws.terminate()
          resolve()

          await setHandlers(ip, newWS, networks, isInitialNode)
          // return since the old websocket connection has already been terminated
          return
        }
      }
      if (connections.get(ip)?.url === ws.url) {
        connections.delete(ip)
        void saveNodeWsUrl(ws.url, false)
      }
      ws.terminate()
      resolve()
    })
    ws.on('error', (err) => {
      if (networks === 'xahau-main') {
        log.info(`Debug1 connection error:${ws.url}:${err.message}`)
      }
      if (connections.get(ip)?.url === ws.url) {
        connections.delete(ip)
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
  const networkInitialIps = (await getNetworks()).map(
    (network) => network.entry,
  )
  if (!node.ip || node.ip.search(':') !== -1) {
    return Promise.resolve()
  }

  if (connections.has(node.ip)) {
    return Promise.resolve()
  }

  if (node.ws_url) {
    const ws = new WebSocket(node.ws_url, { handshakeTimeout: WS_TIMEOUT })
    return setHandlers(node.ip, ws, node.networks)
  }

  const promises: Array<Promise<void>> = []
  for (const port of ports) {
    for (const protocol of protocols) {
      const url = `${protocol}${node.ip}:${port}`
      const ws = new WebSocket(url, { handshakeTimeout: WS_TIMEOUT })
      promises.push(
        setHandlers(
          node.ip,
          ws,
          node.networks,
          networkInitialIps.includes(node.ip),
        ),
      )
    }
  }
  await Promise.all(promises)
  return Promise.resolve()
}

/**
 * Creates connections to nodes found in the database.
 *
 * @returns A promise that resolves to void once all possible connections have been created.
 */
async function createConnections(): Promise<void> {
  log.info('Finding Connections...')
  const tenMinutesAgo = new Date()
  tenMinutesAgo.setMinutes(tenMinutesAgo.getMinutes() - 10)

  const nodes = await query('crawls')
    .select(['ip', 'ws_url', 'networks'])
    .whereNotNull('ip')
    .andWhere('start', '>', tenMinutesAgo)

  const networksDb = await getNetworks()
  networksDb.forEach((network) => {
    nodes.push({
      ip: network.entry,
      ws_url: '',
      networks: network.id,
    })
  })

  const promises: Array<Promise<void>> = []
  connectionsInitialized = false
  nodes.forEach((node: WsNode) => {
    promises.push(findConnection(node))
  })
  await Promise.all(promises)
  connectionsInitialized = true
  log.info(`${connections.size} connections created`)
}

setInterval(() => {
  log.info(`${connections.size} connections established`)
}, REPORTING_INTERVAL)

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
    await createConnections()
    await backtrackAmendmentStatus()
    setInterval(() => {
      void fetchAmendmentInfo()
      void createConnections()
    }, CM_INTERVAL)

    setInterval(() => {
      void backtrackAmendmentStatus()
    }, BACKTRACK_INTERVAL)
  }
}
