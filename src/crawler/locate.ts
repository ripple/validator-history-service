import { City, WebServiceClient } from '@maxmind/geoip2-node'
import moment from 'moment'

import { saveLocation, getNodesToLocate } from '../shared/database'
import { Node, Location } from '../shared/types'
import config from '../shared/utils/config'
import logger from '../shared/utils/logger'

const log = logger({ name: 'locate' })
const LOCATE_TIMEOUT = 10000
const TIME_FORMAT = 'YYYY-MM-DD HH:mm:ss[Z]'

let client: WebServiceClient | undefined

/**
 * Gets client, initializes if undefined.
 *
 * @returns A MaxMind geo-ip2 client.
 */
function getClient(): WebServiceClient | undefined {
  if (!config.maxmind.user || !config.maxmind.key) {
    return undefined
  }

  if (client) {
    return client
  }

  client = new WebServiceClient(config.maxmind.user, config.maxmind.key, {
    host: 'geolite.info',
    timeout: LOCATE_TIMEOUT,
  })

  return client
}

/**
 * Get the geolocation of nodes.
 *
 * @param nodes - Nodes to locate.
 */
async function updateLocation(nodes: Node[]): Promise<void> {
  const geoClient = getClient()

  if (!geoClient) {
    log.warn('No specified geolocation keys')
    return
  }

  for (const node of nodes) {
    if (node.ip === undefined) {
      continue
    }

    let resp: City | undefined
    try {
      resp = await geoClient.city(node.ip)
    } catch (err) {
      log.error('maxmind Error', err)
      continue
    }

    const subdivision = resp.subdivisions
      ? resp.subdivisions[resp.subdivisions.length - 1]
      : undefined

    const city: string | undefined = resp.city?.names.en
    const region: string | undefined = subdivision?.names.en
    const country: string | undefined = resp.country?.names.en

    log.info(
      `${node.public_key}, ${city ?? ''}, ${region ?? ''}, ${country ?? ''}`,
    )

    const location: Location = {
      public_key: node.public_key,
      ip: node.ip,
      updated: moment.utc().format(TIME_FORMAT),
      lat: resp.location?.latitude,
      long: resp.location?.longitude,
      continent: resp.continent?.names.en,
      country,
      region,
      city,
      postal_code: resp.postal?.code,
      country_code: resp.country?.isoCode,
      region_code: subdivision?.isoCode,
      timezone: resp.location?.timeZone,
      isp: resp.traits.isp,
      org: resp.traits.organization,
      domain: resp.traits.domain,
      location_source: 'maxmind',
    }

    await saveLocation(location)
  }
}

async function startLocation(): Promise<void> {
  const nodes: Node[] = await getNodesToLocate()

  log.info(`Locating ${nodes.length} nodes`)
  void updateLocation(nodes)
}

/**
 * Start the geolocation of nodes.
 */
export default async function locate(): Promise<void> {
  try {
    await startLocation()
  } catch (err) {
    log.error('Error geolocating nodes', err)
  }
}
