/* eslint-disable max-lines -- Disable for this file with complex websocket rules. */
/* eslint-disable max-lines-per-function  -- Disable for this file with complex websocket rules. */
import WebSocket from 'ws'

import {
  query,
  saveNodeWsUrl,
  clearConnectionsDb,
  getNetworks,
  saveAmendmentsEnabled,
  saveAmendmentEnabled,
} from '../shared/database'
import {
  AmendmentEnabled,
  DatabaseValidator,
  Fee,
  LedgerEnableAmendmentResponse,
  LedgerEntryAmendmentsResponse,
  StreamLedger,
  StreamManifest,
  TxEnableAmendmentResponse,
  ValidationRaw,
} from '../shared/types'
import { rippleTimeToUnixTime } from '../shared/utils'
import logger from '../shared/utils/logger'

import agreement from './agreement'
import { handleManifest } from './manifests'

const log = logger({ name: 'connections' })
const ports = [443, 80, 6005, 6006, 51233, 51234]
const protocols = ['wss://', 'ws://']
const connections: Map<string, WebSocket> = new Map()
const network_fee: Map<string, Fee> = new Map()
const CM_INTERVAL = 60 * 60 * 1000
const WS_TIMEOUT = 10000
const REPORTING_INTERVAL = 15 * 60 * 1000
const LEDGER_HASHES_SIZE = 10
const AMENDMENT_LEDGER_ENTRY_INDEX =
  '7DB0788C020F02780A673DC74757F23823FA3014C1866E72CC4CD8B226CD6EF4'
let cmStarted = false

/**
 * Subscribes a WebSocket to manifests and validations streams.
 *
 * @param ws - A WebSocket object.
 */
function subscribe(ws: WebSocket): void {
  ws.send(
    JSON.stringify({
      id: 2,
      command: 'subscribe',
      streams: ['manifests', 'validations', 'ledger'],
    }),
  )
}

/**
 * Sends a ledger_entry WebSocket request to retrieve amendments enabled on a network.
 *
 * @param ws - A WebSocket object.
 */
function getAmendmentLedgerEntry(ws: WebSocket): void {
  ws.send(
    JSON.stringify({
      command: 'ledger_entry',
      index: AMENDMENT_LEDGER_ENTRY_INDEX,
      ledger_index: 'validated',
    }),
  )
}

/**
 * Sends a ledger WebSocket request to retrieve transactions on a flag+1 ledger.
 *
 * @param ws - A WebSocket object.
 * @param ledger_index -- The index of the ledger.
 */
function getEnableAmendmentLedger(ws: WebSocket, ledger_index: number): void {
  ws.send(
    JSON.stringify({
      command: 'ledger',
      ledger_index,
      transactions: true,
      expand: true,
    }),
  )
}

/**
 * Sends a tx WebSocket request to retrieve EnableAmendment transaction details.
 *
 * @param ws - A WebSocket object.
 * @param transaction -- The hash of the transaction..
 */
function getEnableAmendmentTx(ws: WebSocket, transaction: string): void {
  ws.send(
    JSON.stringify({
      command: 'tx',
      transaction,
    }),
  )
}

/**
 * Check if a ledger entry is right after a flag ledger, where amendments are enabled.
 *
 * @param ledger_index - The index of the ledger.
 * @returns Boolean.
 */
function isFlagLedgerPlusOne(ledger_index: number): boolean {
  if (ledger_index % 256 === 1) {
    return true
  }
  return false
}

/**
 * Handles a WebSocket message received from a subscribe request.
 *
 * @param data - The WebSocket message received from connection.
 * @param ledger_hashes - The list of recent ledger hashes.
 * @param networks - The networks of subscribed node.
 * @returns Void.
 */
async function handleWsMessageSubscribeTypes(
  data:
    | ValidationRaw
    | StreamManifest
    | StreamLedger
    | LedgerEntryAmendmentsResponse,
  ledger_hashes: string[],
  networks: string | undefined,
): Promise<void> {
  if (data.type === 'validationReceived') {
    const validationData = data as ValidationRaw
    if (ledger_hashes.includes(validationData.ledger_hash)) {
      validationData.networks = networks
    }

    // Get network of the validation if ledger_hash is not in cache.
    const validationNetworkDb: DatabaseValidator | undefined = await query(
      'validators',
    )
      .select('*')
      .where('signing_key', validationData.validation_public_key)
      .first()
    const validationNetwork =
      validationNetworkDb?.networks ?? validationData.networks

    // Get the fee for the network to be used in case the validator does not vote for a new fee.
    if (validationNetwork) {
      validationData.ledger_fee = network_fee.get(validationNetwork)
    }
    void agreement.handleValidation(validationData)
  } else if (data.type === 'manifestReceived') {
    void handleManifest(data as StreamManifest)
  } else if (data.type.includes('ledger')) {
    const current_ledger = data as StreamLedger
    ledger_hashes.push(current_ledger.ledger_hash)
    if (networks) {
      const fee: Fee = {
        fee_base: current_ledger.fee_base,
        reserve_base: current_ledger.reserve_base,
        reserve_inc: current_ledger.reserve_inc,
      }
      network_fee.set(networks, fee)
    }
    if (ledger_hashes.length > LEDGER_HASHES_SIZE) {
      ledger_hashes.shift()
    }
  }
}

/**
 * Handle ws ledger_entry amendments messages.
 *
 * @param ws - A WebSocket object.
 * @param data - The WebSocket message received from connection.
 * @param networks - The networks of subscribed node.
 */
async function handleWsMessageLedgerEntryAmendments(
  ws: WebSocket,
  data: LedgerEntryAmendmentsResponse,
  networks: string | undefined,
): Promise<void> {
  if (data.result.node.LedgerEntryType === 'Amendments') {
    await saveAmendmentsEnabled(data.result.node.Amendments, networks)
  }
  if (isFlagLedgerPlusOne(data.result.ledger_index)) {
    getEnableAmendmentLedger(ws, data.result.ledger_index)
  }
}

/**
 * Handle ws ledger messages to search for EnableAmendment transactions.
 *
 * @param ws - A WebSocket object.
 * @param data - The WebSocket message received from connection.
 */
async function handleWsMessageLedgerEnableAmendments(
  ws: WebSocket,
  data: LedgerEnableAmendmentResponse,
): Promise<void> {
  data.result.ledger.transactions.forEach(async (transaction) => {
    if (
      transaction.TransactionType === 'EnableAmendment' &&
      !transaction.Flags
    ) {
      getEnableAmendmentTx(ws, transaction.hash)
    }
  })
}

/**
 * Handle ws ledger messages to process EnableAmendment transactions.
 *
 * @param data - The WebSocket message received from connection.
 * @param networks - The WebSocket message received from connection.
 */
async function handleWsMessageTxEnableAmendments(
  data: TxEnableAmendmentResponse,
  networks: string | undefined,
): Promise<void> {
  const amendment: AmendmentEnabled = {
    amendment_id: data.result.Amendment,
    networks,
    ledger_index: data.result.ledger_index,
    tx_hash: data.result.hash,
    date: new Date(rippleTimeToUnixTime(data.result.date)),
  }
  await saveAmendmentEnabled(amendment)
}

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
          ws,
          data as LedgerEntryAmendmentsResponse,
          networks,
        )
      } else if (data.result?.ledger) {
        void handleWsMessageLedgerEnableAmendments(
          ws,
          data as LedgerEnableAmendmentResponse,
        )
      } else if (data.result?.Amendment) {
        void handleWsMessageTxEnableAmendments(
          data as TxEnableAmendmentResponse,
          networks,
        )
      } else {
        void handleWsMessageSubscribeTypes(data, ledger_hashes, networks)
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
