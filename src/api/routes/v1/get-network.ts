import { Request, Response } from 'express'

import Crawler from '../../../crawler/crawl'
import crawlNodeOriginal from '../../../crawler/network'
import { query } from '../../../shared/database'
import { Network } from '../../../shared/database/networks'
import { Crawl } from '../../../shared/types'
import logger from '../../../shared/utils/logger'

const log = logger({ name: 'api-get-network' })

const CRAWL_PORTS = [51235, 2459, 30001, 443]

let maxNetwork: number

interface CrawlAndPort {
  crawl: Crawl
  port: number
}

async function updateMaxNetwork(): Promise<void> {
  const currentNetworks = (await query('networks').select('id')) as Array<{
    id: string
  }>
  const currentNetworkNumbers = currentNetworks.reduce(
    (filtered: number[], network: { id: string }) => {
      const { id } = network
      if (!Number.isNaN(Number(id))) {
        filtered.push(Number(id))
      }
      return filtered
    },
    [],
  )
  maxNetwork = Math.max(...currentNetworkNumbers)
  if (maxNetwork === -Infinity) {
    maxNetwork = 0
  }
}

/**
 * A wrapper for `crawlNode` that also returns the port.
 *
 * @param host - The host to crawl.
 * @param port - The peer port guess.
 * @returns The crawl result and the peer port.
 */
async function crawlNode(
  host: string,
  port: number,
): Promise<{ crawl: Crawl; port: number } | undefined> {
  const crawl = await crawlNodeOriginal(host, port)
  if (crawl == null) {
    return undefined
  }
  return { crawl, port }
}

void updateMaxNetwork()
// double check that the max network is accurate every hour
setInterval(updateMaxNetwork, 60 * 60 * 1000)

/**
 * An implementation of `Promise.any`. Returns the first promise to resolve.
 * Ignores errors, unless they all error.
 * This method is used to improve performance of this API call - since the API
 * call checks multiple possible ports for the `/crawl` endpoint, it should
 * return the first one to succeed. The other ones will probably fail, but will
 * take several seconds to fail.
 * Modified from https://stackoverflow.com/a/57599519.
 *
 * @param promises - The crawl Promises that are waiting.
 * @returns The first promise to resolve.
 */
async function any(
  promises: Array<Promise<CrawlAndPort | undefined>>,
): Promise<CrawlAndPort> {
  return new Promise((resolve, reject) => {
    let errors: Error[] = []
    let undefinedValues = 0
    let resolved: boolean

    function sendReject(): void {
      if (errors.length > 0) {
        reject(errors)
      }
      reject(new Error('crawl attempts all failed'))
    }

    /**
     * Helper method when a promise is fulfilled.
     *
     * @param value - The resolved value.
     */
    function onFulfill(value: CrawlAndPort | undefined): void {
      // skip if already resolved
      if (resolved) {
        return
      }
      // if the value is undefined (which is returned if an error occurs)
      if (value == null) {
        undefinedValues += 1
        // reject promise combinator if all promises are failed/undefined
        if (undefinedValues + errors.length === promises.length) {
          sendReject()
        }
        return
      }
      resolved = true

      // resolve with the first available value
      resolve(value)
    }

    /**
     * Helper method when a promise is rejected.
     *
     * @param error - The error.
     */
    function onError(error: Error): void {
      // skip if already resolved
      if (resolved) {
        return
      }

      // collect error
      errors = errors.concat(error)

      // reject promise combinator if all promises are failed/undefined
      if (undefinedValues + errors.length === promises.length) {
        sendReject()
      }
    }

    promises.forEach(async (promise) => promise.then(onFulfill, onError))
  })
}

/**
 * Fetches the crawl data for the node.
 *
 * @param host - The host URL to crawl.
 * @returns The crawl data from the node.
 */
async function fetchCrawls(host: string): Promise<CrawlAndPort> {
  const promises: Array<Promise<CrawlAndPort | undefined>> = []
  for (const port of CRAWL_PORTS) {
    promises.push(crawlNode(host, port))
  }
  return any(promises)
}

/**
 * Checks whether the UNL of the node is recorded in the networks table. If so,
 * then it returns the network associated with the UNL.
 *
 * @param unl - The UNL of the node.
 * @returns Whether the UNL of the node has been seen before.
 */
async function getNetworkFromUNL(unl: string): Promise<string | undefined> {
  const result = (await query('networks')
    .select('id')
    .where('unls', 'like', `%${unl}%`)) as Array<{ id: string }>
  return result.length > 0 ? result[0].id : undefined
}

/**
 * Checks whether the public key of the node is recorded in the crawls table. If
 * so, then it returns the network associated with the public key.
 *
 * @param publicKey - The public key of the node.
 * @returns The network associated with the public key of the node. Undefined
 * if the public key has not been seen by the network.
 */
async function getNetworkFromPublicKey(
  publicKey: string,
): Promise<string | undefined> {
  const result = (await query('crawls')
    .select('public_key', 'networks')
    .where('public_key', '=', publicKey)) as Array<{
    public_key: string
    networks: string | undefined
  }>
  return result.length > 0 ? result[0].networks : undefined
}

/**
 * Adds the node (and its corresponding network) to the networks table.
 *
 * @param url - The URL endpoint of the node.
 * @param unl - The UNL of the node.
 * @param port - The peer port of the node.
 * @returns The ID of the new network.
 */
async function addNode(
  url: string,
  unl: string | null,
  port: number,
): Promise<string> {
  const newNetwork = (maxNetwork + 1).toString()
  maxNetwork += 1

  const network: Network = {
    id: newNetwork,
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

  return newNetwork
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

    // fetch crawl
    const { crawl, port } = await fetchCrawls(entryUrl)

    // check UNL
    const { node_unl } = crawl
    if (node_unl != null) {
      const unlNetwork = await getNetworkFromUNL(node_unl)
      // eslint-disable-next-line max-depth -- Necessary here
      if (unlNetwork != null) {
        return res.send({
          result: 'success',
          network: unlNetwork,
        })
      }
    }

    // check if node public key is already recorded
    const { public_key } = crawl.this_node
    const publicKeyNetwork = await getNetworkFromPublicKey(public_key)
    if (publicKeyNetwork != null) {
      return res.send({
        result: 'success',
        network: publicKeyNetwork,
      })
    }
    // add node to networks list
    const newNetwork = await addNode(entryUrl, node_unl, port)

    return res.send({
      result: 'success',
      network: newNetwork,
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TODO: clean up
  } catch (err: any) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- TODO: clean up
    log.error(err.stack)
    /* eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
    -- TODO: clean up */
    return res.send({ result: 'error', message: err.message })
  }
}
