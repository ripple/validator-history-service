import axios, { AxiosRequestConfig } from 'axios'
import { Request, Response } from 'express'

import Crawler from '../../../crawler/crawl'
import { query } from '../../../shared/database'
import { Network } from '../../../shared/database/networks'
import { getNetworkId } from '../../../shared/utils'
import logger from '../../../shared/utils/logger'

const log = logger({ name: 'api-get-network' })

/**
 *
 * @param host
 * @param port
 * @returns
 */
async function crawlNode(
  host: string,
  port: number,
): Promise<{ crawl: Crawler; port: number } | undefined> {
  const crawl = await crawlNodeOriginal(host, port)
  if (crawl == null) {
    return undefined
  }
  return { crawl, port }
}

/**
 *
 * Determine whether the given Network ID is already in the system.
 *
 * @param id - The network ID.
 * @returns Whether the network ID is registered in the db.
 */
async function isNetworkIdRegistered(id: number): Promise<boolean> {
  const result = await query('networks').select('id').where('id', '=', id)
  return result.length > 0
}

interface ServerInfoPort {
  port: string
  protocol: string[]
}

/**
 * Helper function to get the peer port for a node.
 *
 * @param url - The URL to a node.
 * @returns The peer port for the node.
 */
async function getPeerPort(url: string): Promise<number | undefined> {
  const data = JSON.stringify({
    method: 'server_info',
  })
  const params: AxiosRequestConfig = {
    method: 'post',
    url,
    headers: {
      'Content-Type': 'application/json',
    },
    data,
  }

  try {
    const response = await axios(params)
    const ports = response.data.result?.info?.ports
    const peerPorts: string[] = ports
      .filter((port: ServerInfoPort) => port.protocol.includes('peer'))
      .map((port: ServerInfoPort) => port.port)
    if (peerPorts.length === 0) {
      throw new Error(`Cannot find a peer port for ${url}`)
    }
    return Number(peerPorts[0])
  } catch (err: unknown) {
    log.error((err as Error).message)
    return Promise.resolve(undefined)
  }
}

/**
 * Adds the node (and its corresponding network) to the networks table.
 *
 * @param networkId - The network ID of the node.
 * @param url - The URL endpoint of the node.
 * @param unl - The UNL of the node.
 * @param port - The peer port of the node.
 * @returns The ID of the new network.
 */
async function addNode(
  networkId: number,
  url: string,
  unl: string | null,
  port: number,
): Promise<void> {
  const network: Network = {
    id: networkId,
    entry: url,
    port,
    unls: unl ? [unl] : [],
  }
  await query('networks').insert({
    ...network,
    unls: network.unls.join(','),
  })

  const crawler = new Crawler()
  void crawler.crawl(network)
}

/**
 * Fetch network ID from network entry. If the network doesn't exist, adds it with a new ID.
 *
 * @param req - Express request.
 * @param res - Express response.
 * @returns The Express response.
 */
export default async function getNetworkOrAdd(
  req: Request,
  res: Response,
): Promise<Response> {
  try {
    const { entryUrl } = req.params

    // check network ID
    const networkId = await getNetworkId(entryUrl)
    if (networkId == null) {
      throw new Error('Network ID does not exist')
    }

    if (!(await isNetworkIdRegistered(networkId))) {
      const peerPort = await getPeerPort(entryUrl)
      if (peerPort == null) {
        throw new Error('Peer port does not exist')
      }
      const crawlResult = await crawlNode(entryUrl, peerPort)
      if (crawlResult == null) {
        throw new Error('Crawl failed')
      }

      // check UNL
      const { crawl } = crawlResult
      const { node_unl } = crawl
      // add node to networks list
      await addNode(networkId, entryUrl, node_unl, peerPort)
    }

    return res.send({
      result: 'success',
      network: networkId,
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TODO: clean up
  } catch (err: any) {
    log.error(err.stack)
    return res.send({ result: 'error', message: err.message })
  }
}
