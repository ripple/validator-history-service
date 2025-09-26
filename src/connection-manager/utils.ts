import { Chain } from '../shared/types'
import { getLists, overlaps } from '../shared/utils'
import logger from '../shared/utils/logger'

const log = logger({ name: 'connection-manager-utils' })

/**
 * Finds network name from chain id.
 *
 * @param chain - A chain object.
 * @returns String.
 */
export default async function getNetworkNameFromChainId(
  chain: Chain,
): Promise<string> {
  let id = chain.id
  const lists = await getLists().catch((err) => {
    log.error('Error getting validator lists', err)
    return undefined
  })

  if (lists != null) {
    Object.entries(lists).forEach(([network, set]) => {
      if (overlaps(chain.validators, set)) {
        id = network
      }
    })
  }

  return id
}
