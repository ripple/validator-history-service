import { Knex } from 'knex'

import { query } from '../shared/database'
import { Ledger, ValidationRaw, Chain } from '../shared/types'
import { getLists, overlaps } from '../shared/utils'
import logger from '../shared/utils/logger'

const log = logger({ name: 'chains' })

/**
 * Adds ledger information to chain.
 *
 * @param ledger - Ledger to add to chain.
 * @param chain - Chain to update.
 */
function addLedgerToChain(ledger: Ledger, chain: Chain): void {
  chain.ledgers.add(ledger.ledger_hash)
  for (const validator of ledger.validations) {
    chain.validators.add(validator)
  }

  chain.current = ledger.ledger_index
  chain.updated = ledger.first_seen
  log.info(`Adding ledger ${JSON.stringify(ledger)} into the Chain ${chain.network_id}`)
}

/**
 * Saves the chain id for each validator known to be in a given chain.
 *
 * @param chain - A chain object.
 * @returns Void.
 */
async function saveValidatorChains(chain: Chain): Promise<void> {
  let id: number | string = chain.network_id
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

  const promises: Knex.QueryBuilder[] = []
  chain.validators.forEach((signing_key) => {
    promises.push(
      query('validators').where({ signing_key }).update({ chain: id.toString() }),
    )
  })
  try {
    await Promise.all(promises)
  } catch (err: unknown) {
    log.error('Error saving validator chains', err)
  }
}

/**
 *
 */
class Chains {
  private readonly ledgersByHash: Map<string, Ledger> = new Map()
  private chains: Chain[] = []

  /**
   * Updates chains as validations come in.
   *
   * @param validation - A raw validation message.
   */
  public updateLedgers(validation: ValidationRaw): void {
    if(validation.network_id == undefined) {
      log.warn(`Validation ${JSON.stringify(validation)} has no network id`)
      return
    }
    const { ledger_hash, validation_public_key: signing_key } = validation
    const ledger_index = Number(validation.ledger_index)

    const ledger: Ledger | undefined = this.ledgersByHash.get(ledger_hash)

    if (ledger === undefined) {
      this.ledgersByHash.set(ledger_hash, {
        ledger_hash,
        ledger_index,
        validations: new Set(),
        first_seen: Date.now(),
        network_id: validation.network_id,
      })
    }

    log.info(`Grouping ledger ${ledger_hash} into the chain with network id: ${validation.network_id}`)

    this.ledgersByHash.get(ledger_hash)?.validations.add(signing_key)
  }

  /**
   * Updates and returns all chains. Called once per hour by calculateAgreement.
   *
   * @returns List of chains being monitored by the system.
   */
  public calculateChainsFromLedgers(): Chain[] {
    const list = []
    const now = Date.now()

    for (const [ledger_hash, ledger] of this.ledgersByHash) {
      const tenSecondsOld = now - ledger.first_seen > 10 * 1000

      if (ledger.validations.size > 1 && tenSecondsOld) {
        list.push(ledger)
      }

      if (tenSecondsOld) {
        this.ledgersByHash.delete(ledger_hash)
      }
    }

    list.sort((ledger1, ledger2) => ledger1.ledger_index - ledger2.ledger_index)

    for (const ledger of list) {
      this.updateChains(ledger)
    }

    return this.chains
  }

  /**
   * Clears all ledgers seen on a chain and saves the chain for each validator.
   */
  public async purgeChains(): Promise<void> {
    const promises: Array<Promise<void>> = []

    this.chains = this.chains.filter((chain) => {
      return Date.now() - chain.updated < 60 * 60 * 1000
    })

    for (const chain of this.chains) {
      chain.ledgers.clear()
      chain.incomplete = false
      promises.push(saveValidatorChains(chain))
    }

    await Promise.all(promises)
  }

  /**
   * Adds a new chain to chains.
   *
   * @param ledger - Ledger being validated on a new chain.
   */
  private addNewChain(ledger: Ledger): void {
    const current = ledger.ledger_index
    const validators = ledger.validations
    const ledgerSet = new Set([ledger.ledger_hash])

    const chain: Chain = {
      network_id: ledger.network_id,
      current,
      first: current,
      validators,
      updated: ledger.first_seen,
      ledgers: ledgerSet,
      incomplete: true,
    }

    log.info(`Discovered new chain with network id: ${chain.network_id}. Seeding it with ${JSON.stringify(ledger)}`)
    this.chains.push(chain)
  }

  /**
   * Updates Chains as ledgers are parsed.
   *
   * @param ledger - The Ledger being handled in order to update the chains.
   */
  private updateChains(ledger: Ledger): void {
    // find the chain whose network_id matches the incoming ledger's network_id
    const chainWithIdenticalNetID = this.chains.filter((chain: Chain) => chain.network_id == ledger.network_id)

    if (chainWithIdenticalNetID == undefined || chainWithIdenticalNetID.length === 0) {
      this.addNewChain(ledger)
    } else if (chainWithIdenticalNetID.length > 1) {
      log.error('Invariant Violation: Discovered multiple chains with identical network-id: ', JSON.stringify(chainWithIdenticalNetID))
    }
    else {
      addLedgerToChain(ledger, chainWithIdenticalNetID[0])
    }
  }
}

let chains: Chains | undefined

/**
 * Gets an instance of the chains class.
 * Initializes if not exists.
 *
 * @returns An instance of chains.
 */
function getChainsInstance(): Chains {
  if (chains) {
    return chains
  }

  chains = new Chains()

  return chains
}

export default getChainsInstance()
