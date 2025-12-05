/* eslint-disable @typescript-eslint/no-unsafe-assignment -- TODO: add type for Peer Crawler to remove eslint-disable */
/* eslint-disable @typescript-eslint/no-unsafe-member-access -- TODO: add type for Peer Crawler to remove eslint-disable */
/* eslint-disable @typescript-eslint/no-unsafe-call -- TODO: add type for Peer Crawler to remove eslint-disable */
/* eslint-disable no-unsafe-optional-chaining -- TODO: add type for Peer Crawler to remove eslint-disable */
import https from 'https'

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

/* eslint-disable max-lines-per-function -- CrawlNode captures essential info about a node. */
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
  return (
    getAxiosInstance()
      .get(`https://${host}:${port}/crawl`, { timeout: TIMEOUT })
      // eslint-disable-next-line complexity -- CrawlNode captures essential info about a node.
      .then(async (response) => {
        const active_nodes = response.data?.overlay?.active
        const {
          pubkey_node: public_key,
          server_state,
          io_latency_ms,
          load_factor_server,
          uptime,
          build_version: version,
          complete_ledgers,
        } = response.data?.server

        if (active_nodes === undefined) {
          return undefined
        }

        if (response.data?.server?.network_id === undefined) {
          log.error(
            `Server state network ID is undefined for node ${public_key as string}. The node returned the following information in the crawl response: ${JSON.stringify(response.data)}`,
          )
          return undefined
        }

        const this_node: Node = {
          public_key,
          server_state,
          io_latency_ms,
          load_factor_server,
          uptime,
          version,
          complete_ledgers,
          network_id: response.data?.server?.network_id,
        }

        const validatorSites = response.data?.unl?.validator_sites ?? []

        const crawl: Crawl = {
          this_node,
          active_nodes,
          node_unl:
            validatorSites.length > 0
              ? validatorSites[0].uri.replace(/^https?:\/\//u, '')
              : undefined,
        }

        return crawl
      })
      .catch((error) => {
        if (error.message.includes('wrong network')) {
          throw error
        }
        if (!error.isAxiosError) {
          log.error(error)
        }
        return undefined
      })
  )
}
/* eslint-enable max-lines-per-function */

export default crawlNode
