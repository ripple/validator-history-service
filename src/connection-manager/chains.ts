import { Knex } from 'knex'

import { query } from '../shared/database'
import { Ledger, ValidationRaw, Chain, LedgerHashIndex } from '../shared/types'
import { getLists, overlaps } from '../shared/utils'
import logger from '../shared/utils/logger'

const log = logger({ name: 'chains' })
/**
 * Helper to sort chains by chain length.
 *
 * @param chain1 - First Chain.
 * @param chain2 - Second Chain.
 * @returns Number for sorting criteria.
 */
function sortChainLength(chain1: Chain, chain2: Chain): number {
  return chain2.current - chain2.first - (chain1.current - chain1.first)
}

let LAST_SEEN_MAINNET_LEDGER_INDEX = -1

/**
 * Adds ledger information to chain.
 *
 * @param ledger - Ledger to add to chain.
 * @param chain - Chain to update.
 */
function addLedgerToChain(ledger: Ledger, chain: Chain): void {
  chain.ledgers.add({ ledger_hash: ledger.ledger_hash, ledger_index: ledger.ledger_index } as LedgerHashIndex)
  for (const validator of ledger.validations) {
    chain.validators.add(validator)
  }

  // is the incoming ledger more recent than the current chain's tip (i.e. chain.current)? If so, update the chain's tip.
  chain.current = ledger.ledger_index > chain.current ? ledger.ledger_index : chain.current
  chain.updated = ledger.ledger_index > chain.current ? ledger.first_seen : chain.updated

  log.info(`Ledgers in the chain ${chain.id}: ${Array.from(chain.ledgers)}}`)
  log.info(`Validators belonging to the chain ${chain.id}: ${Array.from(chain.validators)}}`)
}

/**
 * Saves the chain id for each validator known to be in a given chain.
 *
 * @param chain - A chain object.
 * @returns Void.
 */
async function saveValidatorChains(chain: Chain): Promise<void> {
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

  const promises: Knex.QueryBuilder[] = []
  chain.validators.forEach((signing_key) => {
    promises.push(
      query('validators').where({ signing_key }).update({ chain: id }),
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
  private index = 0

  /**
   * Updates chains as validations come in.
   *
   * @param validation - A raw validation message.
   */
  public updateLedgers(validation: ValidationRaw): void {
    const { ledger_hash, validation_public_key: signing_key } = validation
    const ledger_index = Number(validation.ledger_index)

    const ledger: Ledger | undefined = this.ledgersByHash.get(ledger_hash)

    if (ledger === undefined) {
      this.ledgersByHash.set(ledger_hash, {
        ledger_hash,
        ledger_index,
        validations: new Set(),
        first_seen: Date.now(),
      })
    }

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

      if (ledger.validations.size == 1) {
        console.log('DEBUG: Throwing away this ledger because of only one validation: ')
        console.log('DEBUG: Ledger hash: ', ledger_hash)
        console.log('DEBUG: Ledger index: ', ledger.ledger_index)
        console.log('DEBUG: Ledger validations: ', ledger.validations)
        console.log('DEBUG: Ledger first seen: ', ledger.first_seen)
        console.log('DEBUG: Is the ledger older than 10 seconds? ', tenSecondsOld)
      }

      if (tenSecondsOld) {
        this.ledgersByHash.delete(ledger_hash)
      }
    }

    list.sort((ledger1, ledger2) => ledger1.ledger_index - ledger2.ledger_index)

    for (const ledger of list) {
      this.updateChains(ledger)
    }

    for(const chain of this.chains) {
      if(chain.validators.has('nHU4bLE3EmSqNwfL4AP1UZeTNPrSPPP6FXLKXo2uqfHuvBQxDVKd') || chain.validators.has('n9LbM9S5jeGopF5J1vBDoGxzV6rNS8K1T5DzhNynkFLqR9N2fywX')) {
        log.info('DEBUG: Validatig the continuity of XRPL Mainnet validated ledgers: \n')
        log.info('DEBUG: Chain ID: {chain.id}')
        log.info(`DEBUG: Chain updated at: ${chain.updated}`)
        log.info(`DEBUG: Chain first: ${chain.first}`)
        log.info(`DEBUG: Chain current: ${chain.current}`)
        log.info(`DEBUG: Chain validators: ${Array.from(chain.validators)}`)
        log.info(`DEBUG: Chain ledgers: ${Array.from(chain.ledgers)}`)
        log.info(`DEBUG: Chain incomplete: ${chain.incomplete}`)

        // check if the obtained ledgers are consecutive
        for(const ledger of chain.ledgers) {

          // initialization of this variable occurs exactly once, at the start of the program
          if(LAST_SEEN_MAINNET_LEDGER_INDEX === -1) {
            LAST_SEEN_MAINNET_LEDGER_INDEX = ledger.ledger_index
            continue
          }


          if(ledger.ledger_index !== LAST_SEEN_MAINNET_LEDGER_INDEX + 1) {
            log.error('ERROR: Ledgers are not consecutive. Void between indices: ' + LAST_SEEN_MAINNET_LEDGER_INDEX + ' and ' + ledger.ledger_index)
          }
          LAST_SEEN_MAINNET_LEDGER_INDEX = ledger.ledger_index
        }
      }
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
   * Returns the next chain id.
   *
   * @returns The chain id.
   */
  private getNextChainID(): string {
    if (this.index > 10000) {
      this.index = 0
    }

    const id = `chain.${this.index}`
    this.index += 1
    return id
  }

  /**
   * Adds a new chain to chains.
   *
   * @param ledger - Ledger being validated on a new chain.
   */
  private addNewChain(ledger: Ledger): void {
    const current = ledger.ledger_index
    const validators = ledger.validations
    const ledgerSet = new Set([{ ledger_hash: ledger.ledger_hash, ledger_index: ledger.ledger_index } as LedgerHashIndex])

    const chain: Chain = {
      id: this.getNextChainID(),
      current,
      first: current,
      validators,
      updated: ledger.first_seen,
      ledgers: ledgerSet,
      incomplete: true,
    }

    log.info(`Added new chain, chain.${chain.id}`)
    this.chains.push(chain)
  }

  /**
   * Updates Chains as ledgers are parsed.
   *
   * @param ledger - The Ledger being handled in order to update the chains.
   */
  private updateChains(ledger: Ledger): void {
    log.info(`Updating chains for ledger ${JSON.stringify(ledger)}`)
    const next = ledger.ledger_index
    const validators = ledger.validations

    const chainAtNextIndex: Chain | undefined = this.chains
      .filter(
        (chain: Chain) =>
          next === chain.current + 1 && overlaps(validators, chain.validators),
      )
      .sort(sortChainLength)
      .shift()

    if (chainAtNextIndex !== undefined) {
      log.info(`Adding ledger ${ledger.ledger_hash} to chain ${chainAtNextIndex.id} (chain at next index)`)
      addLedgerToChain(ledger, chainAtNextIndex)
      return
    }

    const chainAtThisIndex: Chain | undefined = this.chains
      .filter(
        (chain) =>
          next === chain.current && overlaps(validators, chain.validators),
      )
      .sort(sortChainLength)
      .shift()

    if (chainAtThisIndex !== undefined) {
      log.info(`Found this ledger ${ledger.ledger_hash} in chain ${chainAtThisIndex.id}. No action taken.`)
      return
    }

    const chainWithThisValidator: Chain | undefined = this.chains
      .filter((chain) => overlaps(chain.validators, validators))
      .shift()

    const chainWithLedger: Chain | undefined = this.chains.find(
      (chain: Chain) => chain.ledgers.has({ ledger_hash: ledger.ledger_hash, ledger_index: ledger.ledger_index } as LedgerHashIndex),
    )

    if (chainWithThisValidator !== undefined) {
      const skipped = ledger.ledger_index - chainWithThisValidator.current
      log.warn(`Processing ledger ${ledger.ledger_hash}: Discovered chain with an overlap of validators ${chainWithThisValidator.id}. Possibly skipped ${skipped} ledgers`)
      if (skipped !== 0) {
        log.info(`Adding ledger ${ledger.ledger_hash} to chain ${chainWithThisValidator.id} (chain with an overlap of validators); Existing chain id: ${JSON.stringify(chainWithThisValidator)}`)
        chainWithThisValidator.incomplete = true
        addLedgerToChain(ledger, chainWithThisValidator)
      }
    }

    if (chainWithThisValidator !== undefined || chainWithLedger !== undefined) {
      log.info(`No action taken for ledger ${ledger.ledger_hash}; \nINFO: Chain with an overlap of validators: ${chainWithThisValidator?.id};\n  Chain that contains this ledger: ${chainWithLedger?.id}`)
      return
    }

    log.info(`Adding new chain for ledger ${ledger.ledger_hash}`)
    this.addNewChain(ledger)
  }

  /**
   *
   * VHS tests use this method to reset the chains singleton value. This ensures that tests are not contaminating each other.
   */
  public __resetChainsSingletonForTests(): void {
    this.ledgersByHash.clear()
    this.chains = []
    this.index = 0
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
