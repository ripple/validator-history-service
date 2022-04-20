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

/**
 * Crawl endpoint at host:port/crawl.
 *
 * @param host - Hostname or ip address of peer.
 * @param port - Port to hit /crawl endpoint.
 * @param unl
 * @returns A list of Nodes.
 */
async function crawlNode(
  host: string,
  port: number,
  unl: string,
): Promise<Crawl | undefined> {
  return getAxiosInstance()
    .get(`https://${host}:${port}/crawl`, { timeout: TIMEOUT })
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

      const this_node: Node = {
        public_key,
        server_state,
        io_latency_ms,
        load_factor_server,
        uptime,
        version,
        complete_ledgers,
      }

      const crawl: Crawl = {
        this_node,
        active_nodes,
      }

      const validatorSites = response.data?.unl.validator_sites
      if (validatorSites.length === 0) {
        return crawl
      }
      const node_unl = validatorSites[0].uri

      const unls = [`https://${unl}`]
      if (unl === 'vl.ripple.com') {
        unls.concat(['https://vl.xrplf.org', 'https://vl.coil.com'])
      }
      if (!unls.includes(node_unl)) {
        throw new Error(`Node in the wrong network: ${host}, ${unl}`)
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
}

export default crawlNode
