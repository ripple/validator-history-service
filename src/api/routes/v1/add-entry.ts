import { Request, Response } from 'express'

import Crawler from '../../../crawler/crawl'
import crawlNode from '../../../crawler/network'
import { query } from '../../../shared/database'
import networks, { Network } from '../../../shared/database/networks'
import { Crawl } from '../../../shared/types'

const CRAWL_PORTS = [51235, 2459, 30001]

/**
 * Fetches the crawl data for the node.
 *
 * @param host - The host URL to crawl.
 * @returns The crawl data from the node.
 * @throws If none of the possible crawl ports work.
 */
async function fetchCrawls(host: string): Promise<Crawl> {
  const promises = []
  for (const port of CRAWL_PORTS) {
    promises.push(crawlNode(host, port))
  }
  const results = await Promise.all(promises)
  for (const result of results) {
    if (result != null) {
      return result
    }
  }
  throw new Error('node could not be crawled')
}

/**
 * Checks whether the UNL of the node is recorded in the networks table.
 *
 * @param unl - The UNL of the node.
 * @returns Whether the UNL of the node has been seen before.
 */
async function isUnlRecorded(unl: string): Promise<boolean> {
  const result = await query('networks')
    .select('network')
    .where('unls', 'like', `%${unl}%`)
  return result.length > 0
}

/**
 * Checks whether the public key of the node is recorded in the crawls table.
 *
 * @param publicKey - The public key of the node.
 * @returns Whether the public key of the node has been seen before.
 */
async function isPublicKeyRecorded(publicKey: string): Promise<boolean> {
  const result = await query('crawls')
    .select('public_key')
    .where('public_key', '=', publicKey)
  return result.length > 0
}

/**
 * Adds the node (and its corresponding network) to the networks table.
 *
 * @param url - The URL endpoint of the node.
 * @param unl - The UNL of the node.
 */
async function addNode(url: string, unl: string | null): Promise<void> {
  const currentNetworks = await query('networks')
    .select('network')
    .orderBy('network')
  const maxNetwork =
    currentNetworks[currentNetworks.length - networks.length - 1]?.network ?? 0
  const network: Network = {
    network: (Number(maxNetwork) + 1).toString(),
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
}

/**
 * Add entry to new network.
 *
 * @param req - Express request.
 * @param res - Express response.
 * @returns The Express response.
 */
export default async function addEntry(
  req: Request,
  res: Response,
): Promise<Response> {
  try {
    const { entryUrl } = req.params

    // fetch crawl
    const crawl = await fetchCrawls(entryUrl)

    // check UNL
    const { node_unl } = crawl
    if (node_unl != null && (await isUnlRecorded(node_unl))) {
      return res.send({
        result: 'error',
        message: 'node UNL part of an existing network',
      })
    }

    // check if node public key is already recorded
    const { public_key } = crawl.this_node
    if (await isPublicKeyRecorded(public_key)) {
      return res.send({
        result: 'error',
        message: 'node public key part of an existing network',
      })
    }
    // add node to networks list
    await addNode(entryUrl, node_unl)

    return res.send({
      result: 'success',
    })
  } catch (err) {
    return res.send({ result: 'error', message: err.message })
  }
}
