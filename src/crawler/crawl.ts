import moment, { Moment } from 'moment'
import { encodeNodePublic } from 'ripple-address-codec'

import { query, saveNode } from '../shared/database'
import { Network } from '../shared/database/networks'
import { Crawl, Node } from '../shared/types'
import { getIPv4Address } from '../shared/utils'
import logger from '../shared/utils/logger'

import crawlNode from './network'

const log = logger({ name: 'crawler' })
const TIME_FORMAT = 'YYYY-MM-DD HH:mm:ss[Z]'
const DEFAULT_PORT = 51235
const BASE58_MAX_LENGTH = 50

const LEDGER_RANGE = 100000

/**
 *
 */
class Crawler {
  public readonly publicKeysSeen: Set<string>
  public readonly start: Moment

  private readonly connections: Map<
    string,
    { out: Set<string>; in: Set<string> }
  >

  /**
   * Initialize Crawler.
   */
  public constructor() {
    this.start = moment.utc()
    this.publicKeysSeen = new Set()
    this.connections = new Map()
  }

  /**
   * Normalizes a public key to base58 form.
   *
   * @param publicKey - Public key in base64 or base58.
   * @returns Public key in base58 form.
   */
  private static normalizePublicKey(publicKey: string): string {
    if (publicKey.length > BASE58_MAX_LENGTH && publicKey.startsWith('n')) {
      return publicKey
    }
    return encodeNodePublic(Buffer.from(publicKey, 'base64'))
  }

  /**
   * Helper function for determining if a node's newest ledger is close to the current network's range.
   *
   * @param thisCompleteLedgers - The `complete_ledgers` for the current node.
   * @param nodeCompleteLedgers - The `complete_ledgers` for the new node.
   * @returns Whether the network is in a valid range.
   */
  private static ledgerInRange(
    thisCompleteLedgers: string | undefined,
    nodeCompleteLedgers: string | undefined,
  ): boolean {
    const newestLedger = Crawler.getRecentLedger(thisCompleteLedgers)
    const nodeNewestLedger = Crawler.getRecentLedger(nodeCompleteLedgers)
    if (newestLedger == null || nodeNewestLedger == null) {
      return false
    }

    const intNewestLedger = parseInt(newestLedger, 10)
    const intNodeNewestLedger = parseInt(nodeNewestLedger, 10)
    if (Math.abs(intNewestLedger - intNodeNewestLedger) <= LEDGER_RANGE) {
      return true
    }
    return false
  }

  /**
   * Helper function to parse `complete_ledgers` and determine the most recent ledger
   * the node has seen.
   *
   * @param completeLedgers - The `complete_ledgers` value.
   * @returns The most recent ledger the node has seen.
   */
  private static getRecentLedger(
    completeLedgers: string | undefined,
  ): string | undefined {
    const splitLedgers = completeLedgers?.split('-')
    if (splitLedgers != null) {
      return splitLedgers[splitLedgers.length - 1]
    }
    return undefined
  }

  /**
   * Starts network crawl at entry point host:port/crawl.
   *
   * @param network - The network to crawl.
   * @throws Exception if network entry undefined and not mainnet.
   */
  public async crawl(network: Network): Promise<void> {
    const port = network.port ?? DEFAULT_PORT
    log.info(`Starting crawl at ${network.entry}:${port}`)

    await this.crawlEndpoint(network.entry, port, network.unls)
    await this.saveConnections(network.id)
  }

  /**
   * Saves the connections to each node and updates the network that this node was found on.
   *
   * @param network - 'mainnet' 'testnet' or 'devnet'.
   */
  public async saveConnections(network: string): Promise<void> {
    const updates = Array.from(this.connections, async ([key, connections]) =>
      query('crawls')
        .where({ public_key: key })
        .update({
          inbound_count: connections.in.size,
          outbound_count: connections.out.size,
          networks: network,
        })
        .catch((err) =>
          log.error('Error updating crawls inbound outbound', err),
        ),
    )

    await Promise.all(updates)
  }

  /**
   * Updates connections.
   *
   * @param key1 - Keys that connect.
   * @param key2 - Keys that connect.
   * @param inward - Is the connection in or out.
   */
  private updateConnections(key1: string, key2: string, inward: boolean): void {
    const connectionType = inward ? 'in' : 'out'
    const otherConnection = inward ? 'out' : 'in'

    let keys = this.connections.get(key1) ?? { in: new Set(), out: new Set() }
    keys[connectionType].add(key2)
    this.connections.set(key1, keys)

    keys = this.connections.get(key2) ?? { in: new Set(), out: new Set() }
    keys[otherConnection].add(key1)
    this.connections.set(key2, keys)
  }

  /**
   * Removes a node from the connections map.
   *
   * @param badNode - The bad node to remove from connections.
   */
  private removeConnection(badNode: string): void {
    this.connections.delete(badNode)
  }

  /**
   * Crawl endpoint at host:port/crawl. Remove if the UNL is a different network.
   *
   * @param host - Hostname or ip address of peer.
   * @param port - Port to hit /crawl endpoint.
   * @param unls - List of UNLs on the current network.
   * @returns A list of Nodes.
   */
  private async crawlNode(
    host: string,
    port: number,
    unls: string[],
  ): Promise<Crawl | undefined> {
    return crawlNode(host, port).then((crawl) => {
      if (crawl == null) {
        return crawl
      }
      const { node_unl } = crawl
      if (node_unl && !unls.includes(node_unl)) {
        this.removeConnection(host)
        return undefined
      }
      return crawl
    })
  }

  /**
   * Crawls endpoint at host:port/crawl.
   *
   * @param host - Hostname or ip address of peer.
   * @param port - Port to hit /crawl endpoint.
   * @param unls - List of UNLs on the current network.
   * @returns Void.
   */
  private async crawlEndpoint(
    host: string,
    port: number,
    unls: string[],
  ): Promise<void> {
    const nodes: Crawl | undefined = await this.crawlNode(host, port, unls)

    if (nodes === undefined) {
      return
    }

    const { this_node, active_nodes } = nodes

    // If we are saving the node outside of peer iterations, we do not want to force missing parameters to null
    const promises: Array<Promise<void>> = [saveNode(this_node, false)]
    for (const node of active_nodes) {
      promises.push(this.processPeer(this_node, node, unls))
    }

    // allSettled, not all: one peer that rejects (unparseable body, an invalid
    // URL, a malformed field, a DB error) must not abort the crawl cycle. If it
    // did, the cycle's summary line never logs and the "no crawl activity"
    // alert flips to NoData even though crawling is still happening.
    const results = await Promise.allSettled(promises)
    logRejections(results, `${host}:${port}`)
  }

  /**
   * Records one active peer and performs any follow-up work (saving the peer
   * and recursively crawling it). Resolves without doing anything when the peer
   * should be skipped - a ledger out of range, an already-seen key, or a peer
   * with no reachable ip/port.
   *
   * This is `async` so that a throw on any peer-controlled field (an invalid
   * public key, a non-string `complete_ledgers` or `ip`) becomes a rejected
   * promise that the caller's `allSettled` isolates, rather than propagating
   * out of the loop and dropping every remaining peer on the endpoint.
   *
   * @param this_node - The node that reported this peer.
   * @param node - The active peer to process.
   * @param unls - List of UNLs on the current network.
   * @returns A promise that resolves once the peer is handled.
   */
  private async processPeer(
    this_node: Node,
    node: Node,
    unls: string[],
  ): Promise<void> {
    const normalizedPublicKey = Crawler.normalizePublicKey(node.public_key)

    if (
      !Crawler.ledgerInRange(this_node.complete_ledgers, node.complete_ledgers)
    ) {
      return
    }

    this.updateConnections(
      this_node.public_key,
      normalizedPublicKey,
      node.type === 'in',
    )

    if (this.publicKeysSeen.has(normalizedPublicKey)) {
      return
    }
    this.publicKeysSeen.add(normalizedPublicKey)

    const dbNode = {
      ...node,
      public_key: normalizedPublicKey,
      start: this.start.format(TIME_FORMAT),
    }
    // If a peer has the node IP as null, we want to overwrite in the database
    const promises: Array<Promise<void>> = [saveNode(dbNode, true)]

    if (node.ip !== undefined && node.port !== undefined) {
      const ip = getIPv4Address(node.ip)
      promises.push(this.crawlEndpoint(ip, node.port, unls))
    }
    await Promise.all(promises)
  }
}

/**
 * Logs any rejected promises from a settled batch without rethrowing, so a
 * single failed peer save or sub-crawl can't abort the crawl.
 *
 * @param results - The settled results from the peer save/crawl batch.
 * @param source - The host:port the batch was crawled from, for the log line.
 */
function logRejections(
  results: Array<PromiseSettledResult<void>>,
  source: string,
): void {
  for (const result of results) {
    if (result.status === 'rejected') {
      log.error(`Error crawling from ${source}`, result.reason)
    }
  }
}

export default Crawler
