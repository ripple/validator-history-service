import { Request, Response } from 'express'

import Crawler from '../../../crawler/crawl'
import crawlNode from '../../../crawler/network'
import { query } from '../../../shared/database'
import networks, { Network } from '../../../shared/database/networks'
import { Crawl } from '../../../shared/types'

const CRAWL_PORTS = [51235, 2459, 30001]

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
  promises: Array<Promise<Crawl | undefined>>,
): Promise<Crawl> {
  return new Promise((resolve, reject) => {
    let errors: Error[] = []
    let undefinedValues = 0
    let resolved: boolean

    /**
     * Helper method when a promise is fulfilled.
     *
     * @param value - The resolved value.
     */
    function onFulfill(value: Crawl | undefined): void {
      // skip if already resolved
      if (resolved) {
        return
      }
      // if the value is undefined (which is returned if an error occurs)
      if (value == null) {
        undefinedValues += 1
        // reject promise combinator if all promises are failed/undefined
        if (undefinedValues + errors.length === promises.length) {
          reject(errors)
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
        reject(errors)
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
async function fetchCrawls(host: string): Promise<Crawl> {
  const promises: Array<Promise<Crawl | undefined>> = []
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
  const result = await query('networks')
    .select('network')
    .where('unls', 'like', `%${unl}%`)
  return result.length > 0 ? result[0].network : undefined
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
  const result = await query('crawls')
    .select('public_key', 'networks')
    .where('public_key', '=', publicKey)
  return result.length > 0 ? result[0].networks : undefined
}

/**
 * Adds the node (and its corresponding network) to the networks table.
 *
 * @param url - The URL endpoint of the node.
 * @param unl - The UNL of the node.
 * @returns The ID of the new network.
 */
async function addNode(url: string, unl: string | null): Promise<string> {
  const currentNetworks = await query('networks')
    .select('network')
    .orderBy('network')
  const maxNetwork =
    currentNetworks[currentNetworks.length - networks.length - 1]?.network ?? 0
  const newNetwork = (Number(maxNetwork) + 1).toString()
  const network: Network = {
    network: newNetwork,
    entry: url,
    port: 51235,
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
 * Add entry to new network.
 *
 * @param req - Express request.
 * @param res - Express response.
 * @returns The Express response.
 */
export default async function getNetwork(
  req: Request,
  res: Response,
): Promise<Response> {
  try {
    const { entryUrl } = req.params

    // fetch crawl
    const crawl = await fetchCrawls(entryUrl)

    // check UNL
    const { node_unl } = crawl
    if (node_unl != null) {
      const unlNetwork = await getNetworkFromUNL(node_unl)
      // eslint-disable-next-line max-depth -- Necessary here
      if (unlNetwork != null) {
        return res.send({
          result: 'success',
          network: unlNetwork,
          created: false,
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
        created: false,
      })
    }
    // add node to networks list
    const newNetwork = await addNode(entryUrl, node_unl)

    return res.send({
      result: 'success',
      network: newNetwork,
      created: true,
    })
  } catch (err) {
    return res.send({ result: 'error', message: err.message })
  }
}
