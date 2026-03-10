/* eslint-disable max-lines -- this file needs to handle modern and legacy rippled validators */
import { Knex } from 'knex'

import { query } from '../shared/database'
import networks from '../shared/database/networks'
import { Ledger, ValidationRaw, Chain, LedgerHashIndex } from '../shared/types'
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

const networkNameToChainID = new Map<string, number>()
for (const item of networks) {
  networkNameToChainID.set(item.id, item.network_id)
}

/**
 * Saves the chain id for each validator known to be in a given chain.
 * This is determined by the network_id field present in the validations of the constituent validators of the chain.
 *
 * @param chain - A chain object.
 * @returns Void.
 */
export async function saveValidatorChains(chain: Chain): Promise<void> {
  let chainName: string | undefined
  const matchingNetworkIDChain: string[] = []

  // detect if there is >1 overlap of the NetworkID amongst the XRPL networks
  // this indicates an error in the VHS chain-assignment logic. If the Chains-data is corrupted,
  // do not overwrite the validators table with the incorrect data
  for (const [networkName, networkChainID] of networkNameToChainID) {
    if (networkChainID === chain.network_id) {
      matchingNetworkIDChain.push(networkName)
    }
  }

  if (matchingNetworkIDChain.length > 1) {
    log.error(
      'ERROR: Multiple XRPL chains have identical NetworkID values. This indicates a fatal error in the chain assignment logic of the VHS.',
    )
    log.error('Current Chain NetworkID: ', chain.network_id)
    log.error(
      'Conflicting chains with identical NetworkIDs: ',
      matchingNetworkIDChain,
    )
    return
  }
  if (matchingNetworkIDChain.length === 1) {
    chainName = matchingNetworkIDChain[0]
  } else if (matchingNetworkIDChain.length === 0) {
    log.info(
      `Chain name not found for network id: ${chain.network_id} amongst the well known networks. Using network id as chain name.`,
    )
    chainName = chain.network_id.toString()
  }

  const promises: Knex.QueryBuilder[] = []
  chain.validators.forEach((signing_key) => {
    promises.push(
      query('validators').where({ signing_key }).update({ chain: chainName }),
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

  // This map stores the ledger_hash -> network_id -> set of validation_public_keys association data.
  // It has been observed that some validators have misconfigured the network_id values.
  // This map helps determine the correct network_id through majority vote
  private readonly mapNetworkIDValidations = new Map<
    string,
    Map<number, Set<string>>
  >()

  // Reverse lookup from validator signing_key to its authoritative network_id, derived from UNL data.
  // UNL validators are the source of truth for network classification.
  private unlBySigningKey: Map<string, number> = new Map()

  // ── static methods ──

  /**
   * Determines the winning network_id for a ledger using UNL membership.
   * Only UNL validators are considered trustworthy for network classification.
   *
   * @param ledgerValidations - The set of all signing keys that validated this ledger.
   * @param validationsMap - Map of network_id to set of validator signing keys.
   * @param unlBySigningKey - Reverse lookup from signing_key to authoritative network_id.
   * @returns The winning network_id and the set of validations to keep, or undefined if the ledger should be discarded.
   */
  private static resolveNetworkIDForLedgerByUNL(
    ledgerValidations: Set<string>,
    validationsMap: Map<number, Set<string>>,
    unlBySigningKey: Map<string, number>,
  ): { networkId: number; validations: Set<string> } | undefined {
    // Count UNL validators per network_id based on their UNL membership
    const unlCountByNetwork = new Map<number, number>()
    for (const signingKey of ledgerValidations) {
      const unlNetworkId = unlBySigningKey.get(signingKey)
      if (unlNetworkId !== undefined) {
        unlCountByNetwork.set(
          unlNetworkId,
          (unlCountByNetwork.get(unlNetworkId) ?? 0) + 1,
        )
      }
    }

    // No UNL validators signed this ledger — discard it
    if (unlCountByNetwork.size === 0) {
      log.warn(
        `resolveNetworkIDForLedgerByUNL: Discarding ledger: No UNL validators signed it. Received validations: ${Array.from(ledgerValidations).join(', ')}. UNL validator-signing-keys: ${Array.from(unlBySigningKey.keys()).join(', ')}`,
      )
      return undefined
    }

    // UNL validators from multiple networks signed this ledger — discard it
    if (unlCountByNetwork.size > 1) {
      log.warn(
        `Discarding ledger: UNL validators from ${unlCountByNetwork.size} different networks signed it. Networks: ${Array.from(unlCountByNetwork.keys()).join(', ')}`,
      )
      return undefined
    }

    // Exactly one network's UNL validators signed this ledger — guaranteed by size === 1
    const [winningNetworkId] = unlCountByNetwork.keys()

    // Keep UNL validators, plus non-UNL validators that reported the correct network_id
    const kept = new Set<string>()
    const correctNetworkValidations = validationsMap.get(winningNetworkId)
    if (correctNetworkValidations) {
      for (const key of correctNetworkValidations) {
        kept.add(key)
      }
    }

    // Note: If the UNL validators reported an incorrect network_id, their agreement scores will be penalized by the system.

    return { networkId: winningNetworkId, validations: kept }
  }

  /**
   * Logs which validations were kept and which were discarded for a ledger.
   *
   * @param ledgerHash - The ledger hash being finalized.
   * @param winningNetworkID - The network_id that won the majority vote.
   * @param validationsMap - Map of network_id to set of validator signing keys.
   */
  private static logLedgerValidationReceived(
    ledgerHash: string,
    winningNetworkID: number,
    validationsMap: Map<number, Set<string>>,
  ): void {
    const winningValidations = validationsMap.get(winningNetworkID)
    const winningKeys = winningValidations
      ? Array.from(winningValidations).join(', ')
      : '(none)'
    log.info(
      `Finalizing validations for ledger ${ledgerHash}: kept ${winningKeys}. NetworkID: ${winningNetworkID}.`,
    )

    for (const [networkID, validations] of validationsMap) {
      if (networkID !== winningNetworkID) {
        log.info(
          `\tDiscarding validations with incorrect network_id ${networkID}: ${Array.from(validations).join(', ')}`,
        )
      }
    }
  }

  /**
   * Checks whether two chains share any validators and throws if they do.
   *
   * @param chainA - First chain to compare.
   * @param chainB - Second chain to compare.
   * @throws Error if any validators appear in both chains.
   */
  private static assertNoValidatorOverlap(chainA: Chain, chainB: Chain): void {
    const overlap = Array.from(chainA.validators).filter(
      (validatorSigningKey) => chainB.validators.has(validatorSigningKey),
    )
    if (overlap.length > 0) {
      const msg = `Invariant Violation: ${overlap.length} validator(s) found in both chain ${chainA.network_id} and chain ${chainB.network_id}: ${overlap.join(', ')}`
      throw new Error(msg)
    }
  }

  // ── public methods ──

  /**
   * Sets the chains. Note: This method is used for testing purposes only.
   *
   * @param chains - The specified chains array.
   */
  public setChains(chains: Chain[]): void {
    this.chains = chains
  }

  /**
   * Sets the UNL data used for network classification.
   * Builds a reverse lookup from signing_key to network_id.
   *
   * @param unlsByNetworkId - Map of network_id to set of UNL validator signing keys.
   */
  public setUNLs(unlsByNetworkId: Map<number, Set<string>>): void {
    this.unlBySigningKey = new Map()
    for (const [networkId, signingKeys] of unlsByNetworkId) {
      for (const key of signingKeys) {
        this.unlBySigningKey.set(key, networkId)
      }
    }
  }

  /**
   * Updates chains as validations come in.
   *
   * @param validation - A raw validation message.
   */
  public async updateLedgers(validation: ValidationRaw): Promise<void> {
    if (validation.network_id === undefined) {
      log.info(
        `Validation ${JSON.stringify(validation)} has no network id. Ignoring this validation.`,
      )
      return
    }

    if (this.isStaleMainnetValidation(validation)) {
      log.trace(
        `XRPL Mainnet Validation is really old. Ignoring this validation: ${JSON.stringify(validation)}`,
      )
      return
    }

    const { ledger_hash, validation_public_key: signing_key } = validation
    const ledger_index = Number(validation.ledger_index)

    if (!this.ledgersByHash.has(ledger_hash)) {
      this.ledgersByHash.set(ledger_hash, {
        ledger_hash,
        ledger_index,
        validations: new Set(),
        first_seen: Date.now(),
        // -1 is a placeholder value. The network_id for this ledger will be finalized in the finalizeLedgerValidations method.
        network_id: -1,
      })
    }

    this.ledgersByHash.get(ledger_hash)?.validations.add(signing_key)
    this.recordValidationNetworkID(
      ledger_hash,
      validation.network_id,
      signing_key,
    )
  }

  public finalizeLedgerValidations(): void {
    for (const [ledgerHash, ledger] of this.ledgersByHash) {
      if (
        Date.now() - ledger.first_seen <= 10 * 1000 ||
        ledger.validations.size <= 1
      ) {
        continue
      }
      const validationsMap = this.mapNetworkIDValidations.get(ledgerHash)
      if (!validationsMap) {
        throw new Error(
          `Chains: Unable to obtain the validations that signed this ledger-hash: ${ledgerHash}`,
        )
      }

      // Fallback: no UNL data at all — discard the ledger since we cannot reliably classify it
      if (this.unlBySigningKey.size === 0) {
        log.info(
          `Discarding ledger ${ledgerHash}: no UNL data available for network classification.`,
        )
        ledger.network_id = -1
        continue
      }

      // Use UNL-based resolution
      const result = Chains.resolveNetworkIDForLedgerByUNL(
        ledger.validations,
        validationsMap,
        this.unlBySigningKey,
      )

      if (result === undefined) {
        log.info(
          `Discarding ledger ${ledgerHash}: no UNL validators signed it or UNL validators from multiple networks signed it.`,
        )
        // Mark with -1 so calculateChainsFromLedgers skips it
        ledger.network_id = -1
        continue
      }

      ledger.network_id = result.networkId
      ledger.validations = result.validations
      Chains.logLedgerValidationReceived(
        ledgerHash,
        result.networkId,
        validationsMap,
      )
    }
  }

  /**
   * Updates and returns all chains. Called once per hour by calculateAgreement.
   *
   * @returns List of chains being monitored by the system.
   */
  public calculateChainsFromLedgers(): Chain[] {
    const list = []
    const now = Date.now()

    this.finalizeLedgerValidations()

    for (const [ledger_hash, ledger] of this.ledgersByHash) {
      const tenSecondsOld = now - ledger.first_seen > 10 * 1000

      if (
        ledger.validations.size > 1 &&
        tenSecondsOld &&
        ledger.network_id !== -1
      ) {
        list.push(ledger)
      }

      if (tenSecondsOld) {
        this.ledgersByHash.delete(ledger_hash)
        this.mapNetworkIDValidations.delete(ledger_hash)
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

    this.auditChainValidatorsOverlap()
  }

  /**
   * Returns all the chains tracked by the Chains singleton instance.
   *
   * @returns The chains.
   */
  public getChains(): Chain[] {
    return this.chains
  }

  // ── private methods ──

  /**
   * Returns whether the validation should be discarded as a stale XRPL Mainnet validation.
   *
   * @param validation - A raw validation message.
   * @returns True if the validation is stale and should be ignored.
   * @throws Error if more than one XRPL Mainnet chain exists.
   */
  private isStaleMainnetValidation(validation: ValidationRaw): boolean {
    const mainnetChains = this.chains.filter((chain) => chain.network_id === 0)
    if (mainnetChains.length > 1) {
      throw new Error(
        `Non-unique XRPL Mainnet chain (network_id == 0) found. Conflicting chains: ${JSON.stringify(mainnetChains)}`,
      )
    }

    if (mainnetChains.length === 0) {
      return false
    }

    const currentIndex = mainnetChains[0].current
    return (
      validation.network_id === 0 &&
      Number(validation.ledger_index) < currentIndex - 100
    )
  }

  /**
   * Records the signing_key in the network_id validation map for the given ledger hash.
   *
   * @param ledger_hash - The ledger hash.
   * @param network_id - The network ID from the validation.
   * @param signing_key - The validator's signing key.
   */
  private recordValidationNetworkID(
    ledger_hash: string,
    network_id: number,
    signing_key: string,
  ): void {
    if (!this.mapNetworkIDValidations.has(ledger_hash)) {
      this.mapNetworkIDValidations.set(ledger_hash, new Map())
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- guaranteed by the `has` check + `set` above
    const networkIDMap = this.mapNetworkIDValidations.get(ledger_hash)!

    if (!networkIDMap.has(network_id)) {
      networkIDMap.set(network_id, new Set())
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- guaranteed by the `has` check + `set` above
    networkIDMap.get(network_id)!.add(signing_key)
  }

  private auditChainValidatorsOverlap(): void {
    // Check if there is any overlap between any two pair of XRPL validator-sets.
    for (let i = 0; i < this.chains.length; i++) {
      for (let j = i + 1; j < this.chains.length; j++) {
        Chains.assertNoValidatorOverlap(this.chains[i], this.chains[j])
      }
    }
  }

  /**
   * Audits the continuity of XRPL Mainnet validated ledgers.
   * This is a purely debug function, with no functional side-effects.
   * This method makes use of the this.chains data member to access the XRPL Mainnet ledgers.
   *
   */
  /* eslint-disable max-lines-per-function, max-statements -- method contains useful logs */
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

        if (sortedLedgers.length === 0) {
          log.error(
            'FATAL: No ledgers recorded over the previous hour on XRPL Mainnet. This should never happen.',
          )
          break
        }

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

  /* eslint-enable max-lines-per-function, max-statements */
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
