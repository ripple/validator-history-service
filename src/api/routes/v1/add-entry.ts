import { Request, Response } from 'express'

import crawlNode from '../../../crawler/network'
import { query } from '../../../shared/database'
import { Crawl } from '../../../shared/types'
import networks from '../../../shared/utils/networks'

const CRAWL_PORTS = [51235, 2459, 30001]

/**
 * @param value
 */
function isNumeric(value) {
  return /^-?\d+$/.test(value)
}

/**
 * @param host
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
 * @param unl
 */
async function isUnlRecorded(unl: string): Promise<boolean> {
  const result = await query('networks')
    .select('network')
    .where('unls', 'like', `%${unl}%`)
  return result.length > 0
}

/**
 * @param publicKey
 */
async function isPublicKeyRecorded(publicKey: string): Promise<boolean> {
  const result = await query('crawls')
    .select('public_key')
    .where('public_key', '=', publicKey)
  return result.length > 0
}

/**
 * @param url
 * @param unl
 */
async function addNode(url: string, unl: string | null): Promise<void> {
  const currentNetworks = await query('networks')
    .select('network')
    .orderBy('network')
  const maxNetwork =
    currentNetworks[currentNetworks.length - networks.length - 1]?.network ?? 0
  console.log(currentNetworks, maxNetwork)
  await query('networks').insert({
    network: Number(maxNetwork) + 1,
    entry: url,
    port: 51235,
    unls: unl ?? '',
  })
}

/**
 * Add entry to new network.
 *
 * @param req - Express request.
 * @param res - Express response.
 */
export default async function addEntry(
  req: Request,
  res: Response,
): Promise<Response> {
  try {
    const { entryUrl } = req.params

    // fetch crawl
    const crawl = await fetchCrawls(entryUrl)
    console.log(crawl.this_node)

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
