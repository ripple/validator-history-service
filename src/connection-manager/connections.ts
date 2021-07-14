import WebSocket from 'ws'

import { query, saveNodeWsUrl, clearConnectionsDb} from '../shared/database'

import agreement from './agreement'
import { handleManifest } from './manifests'

const ports = [443, 80, 6005, 6006, 51233, 51234]
const protocols = ['wss://', 'ws://']
const connections: Map<string, WebSocket> = new Map()
const CM_INTERVAL = 60 * 60 * 1000
const WS_TIMEOUT = 10000
const REPORTING_INTERVAL = 15 * 60 * 1000
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
      streams: ['manifests', 'validations'],
    }),
  )
}

/**
 * Sets the handlers for each WebSocket object.
 *
 * @param ip - The ip address of the node we are trying to reach.
 * @param ws - A WebSocket object.
 * @returns A Promise that resolves to void once a connection has been created or timeout has occured.
 */
async function setHandlers(ip: string, ws: WebSocket): Promise<void> {
  return new Promise(function setHandlersPromise(resolve, _reject) {
    ws.on('open', () => {
      if (connections.has(ip)) {
        resolve()
        return
      }
      void saveNodeWsUrl(ws.url, true)
      connections.set(ip, ws)
      subscribe(ws)
      resolve()
    })
    ws.on('message', function handleMessage(message: string) {
      let data
      try {
        data = JSON.parse(message)
      } catch (error) {
        console.log(error)
        return
      }
      if (data?.type === 'validationReceived') {
        void agreement.handleValidation(data)
      } else if (data?.type === 'manifestReceived') {
        void handleManifest(data)
      }
    })
    ws.on('close', () => {
      if (connections.get(ip)?.url === ws.url) {
        connections.delete(ip)
      }
      void saveNodeWsUrl(ws.url, false)
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

  if (connections.has(node.ip)) {
    return Promise.resolve()
  }

  if (node.ws_url) {
    const ws = new WebSocket(node.ws_url, { handshakeTimeout: WS_TIMEOUT })
    return setHandlers(node.ip, ws)
  }

  const promises: Array<Promise<void>> = []
  for (const port of ports) {
    for (const protocol of protocols) {
      const url = `${protocol}${node.ip}:${port}`
      const ws = new WebSocket(url, { handshakeTimeout: WS_TIMEOUT })
      promises.push(setHandlers(node.ip, ws))
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
  console.log('Finding Connections...')
  const tenMinutesAgo = new Date()
  tenMinutesAgo.setMinutes(tenMinutesAgo.getMinutes() - 10)
  
  const nodes = await query('crawls')
    .select(['ip', 'ws_url'])
    .whereNotNull('ip')
    .andWhere('start', '>', tenMinutesAgo)

  const promises: Array<Promise<void>> = []
  nodes.forEach((node: WsNode) => {
    promises.push(findConnection(node))
  })
  await Promise.all(promises)
  console.log(`${connections.size} connections created`)
}

setInterval(() => {
  console.log(`${connections.size} connections established`)
}, REPORTING_INTERVAL)

/**
 * Starts the connection manager and refreshes connections every CM_INTERVAL.
 *
 * @returns Void.
 */
export default async function startConnections(): Promise<void> {
  if (!cmStarted) {
    cmStarted = true
    await clearConnectionsDb();
    await createConnections()
    setInterval(() => {
       void createConnections()
    }, CM_INTERVAL)
  }
}
