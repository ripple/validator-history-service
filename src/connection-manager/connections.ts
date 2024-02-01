/* eslint-disable max-lines-per-function  -- Disable for this file with complex websocket rules. */
import WebSocket from 'ws'
import { LedgerEntryResponse } from 'xrpl'

import {
  query,
  saveNodeWsUrl,
  clearConnectionsDb,
  getNetworks,
} from '../shared/database'
import { FeeVote, LedgerResponseCorrected } from '../shared/types'
import logger from '../shared/utils/logger'

import {
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
          data as LedgerResponseCorrected,
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
    ws.on('close', () => {
      if (connections.get(ip)?.url === ws.url) {
        connections.delete(ip)
        void saveNodeWsUrl(ws.url, false)
      }
      ws.terminate()
      resolve()
    })
    ws.on('error', () => {
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
 * @returns Void.
 */
export default async function startConnections(): Promise<void> {
  if (!cmStarted) {
    cmStarted = true
    await clearConnectionsDb()
    await createConnections()
    setInterval(() => {
      void createConnections()
    }, CM_INTERVAL)
  }
}
