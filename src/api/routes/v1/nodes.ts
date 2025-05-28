import { Request, Response } from 'express'

import { query } from '../../../shared/database'
import logger from '../../../shared/utils/logger'

import { CACHE_INTERVAL_MILLIS } from './utils'

const log = logger({ name: 'api-nodes' })

interface NodeResponse {
  node_public_key: string
  networks?: string
  lat?: number
  long?: number
  complete_ledgers?: string
  complete_shards?: string
  version?: string
  ip?: string
  port?: number
  uptime?: number
  country_code?: number
  country?: string
  region?: string
  region_code?: number
  city?: string
  postal_code?: number
  timezone?: string
  server_state?: string
  io_latency_ms?: number
  load_factor_server?: number
}

interface Cache {
  nodes: NodeResponse[]
  time: number
}

const cache: Cache = {
  nodes: [],
  time: Date.now(),
}

/**
 * Handwave-y function that removes null values.
 *
 * @param node - NodeResponse object with null values.
 * @returns NodeResponse without null values.
 */
function removeNull(node: NodeResponse): NodeResponse {
  return Object.fromEntries(
    Object.entries(node).filter(([_u, value]) => value !== null),
  ) as NodeResponse
}

/**
 * Finds Validator with public_key in database.
 *
 * @param public_key - Signing key for validator.
 * @returns Validator or undefined if not found.
 */
async function findInDatabase(
  public_key: string,
): Promise<NodeResponse | undefined> {
  const result = (await query('crawls')
    .select([
      'crawls.public_key as node_public_key',
      'crawls.networks',
      'crawls.complete_ledgers',
      'crawls.complete_shards',
      'crawls.ip',
      'crawls.port',
      'crawls.uptime',
      'crawls.version',
      'crawls.server_state',
      'crawls.io_latency_ms',
      'crawls.load_factor_server',
      'location.lat',
      'location.long',
      'location.country_code',
      'location.country',
      'location.region',
      'location.region_code',
      'location.city',
      'location.postal_code',
      'location.timezone',
    ])
    .fullOuterJoin('location', 'crawls.public_key', 'location.public_key')
    .where({ public_key })
    .limit(1)) as NodeResponse[]

  const node = result.shift()
  if (node === undefined) {
    return undefined
  }

  return removeNull(node)
}

/**
 * Reads nodes from database.
 *
 * @returns Locations of nodes crawled in the last hour.
 */
async function getNodes(): Promise<NodeResponse[]> {
  const now = new Date()
  const hourAgo = new Date()
  hourAgo.setHours(now.getHours() - 1)

  return query('crawls')
    .select([
      'crawls.public_key as node_public_key',
      'crawls.networks',
      'crawls.complete_ledgers',
      'crawls.complete_shards',
      'crawls.ip',
      'crawls.port',
      'crawls.uptime',
      'crawls.version',
      'crawls.port',
      'crawls.uptime',
      'crawls.version',
      'crawls.server_state',
      'crawls.io_latency_ms',
      'crawls.load_factor_server',
      'inbound_count',
      'outbound_count',
      'location.lat',
      'location.long',
      'location.country_code',
      'location.country',
      'location.region',
      'location.region_code',
      'location.city',
      'location.postal_code',
      'location.timezone',
    ])
    .fullOuterJoin('location', 'crawls.public_key', 'location.public_key')
    .where('crawls.start', '>', hourAgo)
    .then((nodes: NodeResponse[]) => nodes.map((node) => removeNull(node)))
}

/**
 * Updates cached Nodes.
 *
 * @returns Void.
 */
async function cacheNodes(): Promise<void> {
  try {
    cache.nodes = await getNodes()
    cache.time = Date.now()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TODO: clean up
  } catch (err: any) {
    log.error(err)
  }
}

void cacheNodes()

/**
 * Handles Nodes request.
 *
 * @param req - Express request.
 * @param res - Express response.
 */
export async function handleNode(req: Request, res: Response): Promise<void> {
  try {
    if (Date.now() - cache.time > CACHE_INTERVAL_MILLIS) {
      await cacheNodes()
    }

    const public_key = req.params.publicKey
    let node: NodeResponse | undefined = cache.nodes.find(
      (resp: NodeResponse) => resp.node_public_key === public_key,
    )

    if (node === undefined) {
      node = await findInDatabase(public_key)
    }

    if (node === undefined) {
      res.status(404).send({ result: 'error', message: 'node not found' })
    }

    res.status(200).send({
      ...node,
      result: 'success',
    })
  } catch (err: unknown) {
    res.status(500).send({
      result: 'error',
      message: `internal error: ${(err as Error).message}`,
    })
  }
}

/**
 * Handles Nodes request.
 *
 * @param req - Unused express request.
 * @param res - Express response.
 */
export async function handleNodes(req: Request, res: Response): Promise<void> {
  try {
    if (Date.now() - cache.time > CACHE_INTERVAL_MILLIS) {
      await cacheNodes()
    }

    const { network } = req.params
    const nodes =
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Necessary here
      network == null
        ? cache.nodes
        : cache.nodes.filter((node) => node.networks === network)

    res.status(200).send({
      result: 'success',
      count: nodes.length,
      nodes,
    })
  } catch (err: unknown) {
    res.status(500).send({
      result: 'error',
      message: `internal error: ${(err as Error).message}`,
    })
  }
}

/**
 * Handles Topology request.
 *
 * @param _u - Unused express request.
 * @param res - Express response.
 */
export async function handleTopology(
  _u: Request,
  res: Response,
): Promise<void> {
  try {
    if (Date.now() - cache.time > CACHE_INTERVAL_MILLIS) {
      await cacheNodes()
    }

    res.status(200).send({
      result: 'success',
      node_count: cache.nodes.length,
      link_count: 0,
      nodes: cache.nodes,
      links: [],
    })
  } catch (err: unknown) {
    res.status(500).send({
      result: 'error',
      message: `internal error: ${(err as Error).message}`,
    })
  }
}
