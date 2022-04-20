import moment, { Moment } from 'moment'
import { encodeNodePublic } from 'ripple-address-codec'

import { query, saveNode } from '../shared/database'
import { Crawl } from '../shared/types'
import logger from '../shared/utils/logger'
import config from '../shared/utils/config'

import crawlNode from './network'

const log = logger({ name: 'crawler' })
const TIME_FORMAT = 'YYYY-MM-DD HH:mm:ss[Z]'
const DEFAULT_PORT = 51235
const IP_ADDRESS = /^::ffff:/u
const BASE58_MAX_LENGTH = 50

const LEDGER_RANGE = 10000

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

  private static ledgerInRange(
    newestLedger: string | undefined,
    nodeNewestLedger: string | undefined
  ): boolean {
    if (newestLedger != null && nodeNewestLedger != null) {
      const intNewestLedger = parseInt(newestLedger);
      const intNodeNewestLedger = parseInt(nodeNewestLedger);
      if (intNewestLedger - LEDGER_RANGE < intNodeNewestLedger && intNodeNewestLedger < intNewestLedger + LEDGER_RANGE) {
        return true
      } else {
        return false
      }
    }
    return true
  }

  private static getRecentLedger(completeLedgers: string | undefined): string | undefined {
    const splitLedgers = completeLedgers?.split('-')
    if (splitLedgers != null) {
      return splitLedgers[splitLedgers.length-1]
    }
    return undefined;
  }

  /**
   * Starts network crawl at entry point host:port/crawl.
   *
   * @param host - Hostname or ip address of peer.
   * @param port - Port to hit /crawl endpoint.
   *
   */
  public async crawl(host: string, port: number = DEFAULT_PORT): Promise<void> {
    log.info(`Starting crawl at ${host}:${port}`)
    let network = ''
    let unl = ''
    if (host === 's1.ripple.com' || host === 's2.ripple.com' || host === 'p2p.livenet.ripple.com') {
      network = 'main'
      unl = config.vl_main
    }
    if (host === 's.altnet.rippletest.net') {
      network = 'test'
      unl = config.vl_test
    }
    if (host === 's.devnet.rippletest.net') {
      network = 'dev'
      unl = config.vl_dev
    }
    await this.crawlEndpoint(host, port, unl)
    await this.saveConnections(network)
  }

  /**
   * Saves the connections to each node and updates the network that this node was found on.
   *
   * @param network - 'mainnet' 'testnet' or 'devnet'.
   */
  public async saveConnections(network: string): Promise<void> {
    for (const [key, connections] of this.connections) {
      const dbNetworks = await query('crawls')
        .select('networks')
        .where({ public_key: key })
      
      const arr = dbNetworks[0]?.networks?.split(',') || []
      arr.push(network)
      const networks = Array.from(new Set(arr)).join()
      void query('crawls')
        .where({ public_key: key })
        .update({
          inbound_count: connections.in.size,
          outbound_count: connections.out.size,
          networks,
        })
        .catch((err) =>
          log.error('Error updating crawls inbound outbound', err),
        )
    }
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

  private removeConnection(badNode: string) {
    this.connections.delete(badNode);
  }

  private async crawlNode(host: string, port: number, unl: string): Promise<Crawl | undefined> {
    return crawlNode(host, port, unl).catch(() => {
      this.removeConnection(host)
      return undefined
    })
  }

  /**
   * Crawls endpoint at host:port/crawl.
   *
   * @param host - Hostname or ip address of peer.
   * @param port - Port to hit /crawl endpoint.
   * @returns Void.
   */
  private async crawlEndpoint(host: string, port: number, unl: string): Promise<void> {
    const nodes: Crawl | undefined = await this.crawlNode(host, port, unl)

    if (nodes === undefined) {
      return
    }

    const { this_node, active_nodes } = nodes
    const newestLedger = Crawler.getRecentLedger(this_node.complete_ledgers);

    const promises: Array<Promise<void>> = [saveNode(this_node)]

    for (const node of active_nodes) {
      const normalizedPublicKey = Crawler.normalizePublicKey(node.public_key)

      const nodeNewestLedger = Crawler.getRecentLedger(node.complete_ledgers);
      if (nodeNewestLedger && !Crawler.ledgerInRange(newestLedger, nodeNewestLedger)) {
        continue
      }

      this.updateConnections(
        this_node.public_key,
        normalizedPublicKey,
        node.type === 'in',
      )

      const dbNode = {
        ...node,
        public_key: normalizedPublicKey,
        start: this.start.format(TIME_FORMAT),
      }

      if (this.publicKeysSeen.has(normalizedPublicKey)) {
        continue
      }

      this.publicKeysSeen.add(normalizedPublicKey)

      promises.push(saveNode(dbNode))

      if (node.ip === undefined || node.port === undefined) {
        continue
      }

      const ip = IP_ADDRESS.exec(node.ip)
        ? node.ip.substr('::ffff:'.length)
        : node.ip

      promises.push(this.crawlEndpoint(ip, node.port, unl))
    }

    await Promise.all(promises)
  }
}

export default Crawler
