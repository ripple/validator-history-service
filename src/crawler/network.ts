/* eslint-disable @typescript-eslint/no-unsafe-member-access -- untyped peer crawl response */
/* eslint-disable @typescript-eslint/no-unsafe-call -- untyped peer crawl response */

import https from 'https'
import net from 'net'

import axios, { AxiosInstance } from 'axios'

import { Crawl, Node } from '../shared/types'
import logger from '../shared/utils/logger'

let fetch: AxiosInstance | undefined

const log = logger({ name: 'crawl' })

/**
 * Gets Axios Instance, creates if not instantiated.
 *
 * @returns An initialized AxiosInstance.
 */
function getAxiosInstance(): AxiosInstance {
  if (fetch) {
    return fetch
  }

  fetch = axios.create({
    httpsAgent: new https.Agent({
      rejectUnauthorized: false,
      requestCert: true,
    }),
  })

  return fetch
}

const TIMEOUT = 6000

/**
 * Builds the `/crawl` URL for a host, bracketing bare IPv6 literals so the URL
 * parser doesn't mistake the address colons for a port separator (which threw
 * ERR_INVALID_URL on v6 peers and aborted the crawl).
 *
 * @param host - Hostname or IP address of peer.
 * @param port - Port to hit the /crawl endpoint on.
 * @returns A well-formed https URL.
 */
function buildCrawlUrl(host: string, port: number): string {
  const formattedHost = net.isIPv6(host) ? `[${host}]` : host
  return `https://${formattedHost}:${port}/crawl`
}

interface CrawlResponseBody {
  overlay?: { active?: Node[] }
  server?: Record<string, unknown>
  unl?: { validator_sites?: Array<{ uri: string }> }
}

/**
 * Extracts the UNL host from a crawl response's validator_sites, stripping any
 * scheme. Returns undefined when the response advertises no validator site.
 *
 * @param body - The parsed /crawl response body.
 * @returns The UNL host, or null.
 */
function parseNodeUnl(body: CrawlResponseBody): string | null {
  const validatorSites = body.unl?.validator_sites ?? []
  if (validatorSites.length === 0) {
    return null
  }
  return validatorSites[0].uri.replace(/^https?:\/\//u, '')
}

/**
 * Parses a /crawl HTTP response body into a Crawl, or undefined if the body is
 * not a well-formed crawl response.
 *
 * @param body - The parsed JSON response body from a peer.
 * @returns The Crawl, or undefined if the body is malformed.
 */
function parseCrawlResponse(body: CrawlResponseBody): Crawl | undefined {
  const active_nodes = body.overlay?.active
  const server = body.server

  // A well-formed /crawl response always carries a `server` object and an
  // active-peers array. A peer that omits either used to throw a TypeError on
  // destructuring, which rejected the whole crawl cycle; treat it as an empty
  // result instead.
  if (active_nodes === undefined || server == null) {
    return undefined
  }

  const {
    pubkey_node: public_key,
    server_state,
    io_latency_ms,
    load_factor_server,
    uptime,
    build_version: version,
    complete_ledgers,
  } = server

  const this_node = {
    public_key,
    server_state,
    io_latency_ms,
    load_factor_server,
    uptime,
    version,
    complete_ledgers,
  } as Node

  return {
    this_node,
    active_nodes,
    node_unl: parseNodeUnl(body),
  }
}

/**
 * Crawl endpoint at host:port/crawl.
 *
 * @param host - Hostname or ip address of peer.
 * @param port - Port to hit /crawl endpoint.
 * @returns A list of Nodes.
 */
async function crawlNode(
  host: string,
  port: number,
): Promise<Crawl | undefined> {
  return getAxiosInstance()
    .get<CrawlResponseBody>(buildCrawlUrl(host, port), { timeout: TIMEOUT })
    .then((response) => parseCrawlResponse(response.data))
    .catch((error) => {
      if (error.message.includes('wrong network')) {
        throw error
      }
      if (!error.isAxiosError) {
        log.error(error)
      }
      return undefined
    })
}

export default crawlNode
