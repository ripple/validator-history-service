import { Knex } from 'knex'

import { query } from '../shared/database'
import { Ledger, ValidationRaw, Chain, LedgerHashIndex } from '../shared/types'
import { getLists, overlaps } from '../shared/utils'
import logger from '../shared/utils/logger'

const log = logger({ name: 'chains' })

let LAST_SEEN_MAINNET_LEDGER_INDEX = -1

/**
 * Adds ledger information to chain.
 *
 * @param ledger - Ledger to add to chain.
 * @param chain - Chain to update.
 */
function addLedgerToChain(ledger: Ledger, chain: Chain): void {
  // does the chain already have this ledger?
  for (const existingLedger of chain.ledgers) {
    if (existingLedger.ledger_index === ledger.ledger_index) {
      log.error(
        `Invariant Violation: Found two ledgers with conflicting hashes and identical ledger indices in chain: ${chain.network_id}. Existing ledger: ${JSON.stringify(existingLedger)}. \nNew ledger: ${JSON.stringify(ledger)} has the following validators: ${Array.from(ledger.validations).join(', ')}. \nChain is backed by the following validators: ${Array.from(chain.validators).join(', ')}`,
      )
      return
    }
  }

  chain.ledgers.add({
    ledger_hash: ledger.ledger_hash,
    ledger_index: ledger.ledger_index,
  } as LedgerHashIndex)
  for (const validator of ledger.validations) {
    chain.validators.add(validator)
  }

  chain.current = ledger.ledger_index
  chain.updated = ledger.first_seen
  log.info(
    `Adding ledger ${JSON.stringify(ledger)} into the network ${chain.network_id}`,
  )
}

/**
 * Saves the chain id for each validator known to be in a given chain.
 *
 * @param chain - A chain object.
 * @returns Void.
 */
export async function saveValidatorChains(chain: Chain): Promise<void> {
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
      query('validators')
        .where({ signing_key })
        .update({ chain: id.toString() }),
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
    // eslint-disable-next-line max-len -- comment is required to explain the legacy behavior
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- older rippled binaries do not return a network_id field
    if (validation.network_id === undefined) {
      log.trace(`Validation ${JSON.stringify(validation)} has no network id`)
      return
    }
    if (
      validation.network_id === 0 &&
      Number(validation.ledger_index) < 100000000
    ) {
      log.trace(
        `XRPL Mainnet Validation is really old. Ignoring this validation: ${JSON.stringify(
          validation,
        )}`,
      )
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

    this.auditMainnetLedgers()

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
      if (
        chain.network_id === 0 &&
        chain.current !== LAST_SEEN_MAINNET_LEDGER_INDEX
      ) {
        log.error(
          `Invariant Violation: Purging XRPL Mainnet chain ledgers. Sanity Check -- LedgerIndex of the last recorded ledger: ${
            chain.current
          }. LAST_SEEN_MAINNET_LEDGER_INDEX: ${
            LAST_SEEN_MAINNET_LEDGER_INDEX
          }. These values must be identical to ensure no ledgers are lost.`,
        )
      }
      chain.ledgers.clear()
      chain.incomplete = false
      promises.push(saveValidatorChains(chain))
    }

    await Promise.all(promises)
  }

  /**
   * Updates Chains as ledgers are parsed.
   *
   * @param ledger - The Ledger being handled in order to update the chains.
   */
  public updateChains(ledger: Ledger): void {
    // find the chain whose network_id matches the incoming ledger's network_id
    const chainWithIdenticalNetID: Chain[] = this.chains.filter(
      (chain: Chain) => chain.network_id === ledger.network_id,
    )

    if (chainWithIdenticalNetID.length === 0) {
      this.addNewChain(ledger)
    } else if (chainWithIdenticalNetID.length > 1) {
      log.error(
        'Invariant Violation: Discovered multiple chains with identical network-id: ',
        JSON.stringify(chainWithIdenticalNetID),
      )
    } else {
      addLedgerToChain(ledger, chainWithIdenticalNetID[0])
    }
  }

  /**
   * Returns all the chains tracked by the Chains singleton instance.
   *
   * @returns The chains.
   */
  public getChains(): Chain[] {
    return this.chains
  }

  /**
   * Sets the chains. Note: This method is used for testing purposes only.
   *
   * @param chains - The specified chains array.
   */
  public setChains(chains: Chain[]): void {
    this.chains = chains
  }

  /**
   * Audits the continuity of XRPL Mainnet validated ledgers.
   * This is a purely debug function, with no functional side-effects.
   * This method makes use of the this.chains data member to access the XRPL Mainnet ledgers.
   *
   */
  private auditMainnetLedgers(): void {
    const START_OF_MAINNET_LEDGER_INDEX = LAST_SEEN_MAINNET_LEDGER_INDEX
    for (const chain of this.chains) {
      if (chain.network_id === 0) {
        log.trace(
          'Validating the continuity of XRPL Mainnet validated ledgers: ',
        )
        log.trace(JSON.stringify(chain))
        log.trace(
          `Ledgers stored in the chain: ${JSON.stringify(
            Array.from(chain.ledgers),
          )}`,
        )
        log.trace(
          `Validators belonging to the chain: ${JSON.stringify(
            Array.from(chain.validators),
          )}`,
        )

        /* eslint-disable max-depth -- this debug logic is specific to XRPL Mainnet only */
        // Check if the obtained ledgers are consecutive.
        // Sort the ledgers to account for out-of-order reciept of validations.
        // Note: Sorting the ledgers does not affect the agreement computation.
        const sortedLedgers: LedgerHashIndex[] = Array.from(chain.ledgers).sort(
          (a: LedgerHashIndex, b: LedgerHashIndex) =>
            a.ledger_index - b.ledger_index,
        )

        // Note: Due to the async reception of validations, the previous hourly computation of agreement scores
        // might have received "tardy" validations.
        // That should not affect the continuity of ledgers in the VHS.
        if (LAST_SEEN_MAINNET_LEDGER_INDEX >= sortedLedgers[0].ledger_index) {
          LAST_SEEN_MAINNET_LEDGER_INDEX = -1
        }

        for (const ledger of sortedLedgers) {
          // initialization of this variable occurs exactly once, at the start of the program
          if (LAST_SEEN_MAINNET_LEDGER_INDEX === -1) {
            LAST_SEEN_MAINNET_LEDGER_INDEX = ledger.ledger_index
            continue
          }

          if (ledger.ledger_index !== LAST_SEEN_MAINNET_LEDGER_INDEX + 1) {
            log.error(
              `Ledgers are not consecutive on XRPL Mainnet. Void between indices: ${
                LAST_SEEN_MAINNET_LEDGER_INDEX
              } and ${ledger.ledger_index}`,
            )
          }
          LAST_SEEN_MAINNET_LEDGER_INDEX = ledger.ledger_index
        }
        /* eslint-enable max-depth */
      }
    }
    log.info(
      `Over the previous hour, VHS processed ledgers between indices: (${START_OF_MAINNET_LEDGER_INDEX} to ${LAST_SEEN_MAINNET_LEDGER_INDEX} (inclusive)] on XRPL Mainnet.`,
    )
  }

  /**
   * Adds a new chain to chains.
   *
   * @param ledger - Ledger being validated on a new chain.
   */
  private addNewChain(ledger: Ledger): void {
    const current = ledger.ledger_index
    const validators = ledger.validations
    const ledgerSet = new Set([
      {
        ledger_hash: ledger.ledger_hash,
        ledger_index: ledger.ledger_index,
      } as LedgerHashIndex,
    ])

    const chain: Chain = {
      network_id: ledger.network_id,
      current,
      first: current,
      validators,
      updated: ledger.first_seen,
      ledgers: ledgerSet,
      incomplete: true,
    }

    log.info(
      `Discovered new chain with network id: ${chain.network_id}. Seeding it with ${JSON.stringify(ledger)}`,
    )
    this.chains.push(chain)
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
