/* eslint-disable max-lines -- Complex functions */
import WebSocket from 'ws'
import {
  Client,
  LedgerEntryResponse,
  LedgerResponse,
  RIPPLED_API_V1,
  rippleTimeToUnixTime,
} from 'xrpl'
import { Amendments, AMENDMENTS_ID } from 'xrpl/dist/npm/models/ledger'
import { LedgerResponseExpanded } from 'xrpl/dist/npm/models/methods/ledger'

import {
  getNetworks,
  saveAmendmentsStatus,
  saveAmendmentStatus,
} from '../shared/database'
import {
  NETWORKS_HOSTS,
  deleteAmendmentStatus,
} from '../shared/database/amendments'
import { insertValidatedLedger } from '../shared/database/validatedLedgers'
import {
  AmendmentStatus,
  FeeVote,
  StreamLedger,
  StreamManifest,
  ValidationRaw,
} from '../shared/types'
import logger from '../shared/utils/logger'

import agreement from './agreement'
import { handleManifest } from './manifests'

const LEDGER_HASHES_SIZE = 10
const GOT_MAJORITY_FLAG = 65536
const LOST_MAJORITY_FLAG = 131072
const FOURTEEN_DAYS_IN_MILLISECONDS = 14 * 24 * 60 * 60 * 1000
const ports = [443, 80, 6005, 6006, 51233, 51234]
const protocols = ['wss://', 'ws://']

const log = logger({ name: 'connections' })

/**
 * Subscribes a WebSocket to manifests and validations streams.
 *
 * @param ws - A WebSocket object.
 */
export function subscribe(ws: WebSocket): void {
  ws.send(
    JSON.stringify({
      id: 2,
      command: 'subscribe',
      streams: ['manifests', 'validations', 'ledger'],
    }),
  )
}

/**
 * Check if a ledger entry is right after a flag ledger, where amendments are enabled.
 *
 * @param ledger_index - The index of the ledger.
 * @returns Boolean.
 */
function isFlagLedgerPlusOne(ledger_index: number): boolean {
  if (ledger_index % 256 === 1) {
    return true
  }
  return false
}

/**
 * Handles a WebSocket message received from a subscribe request.
 *
 * @param data - The WebSocket message received from connection.
 * @param ledger_hashes - The list of recent ledger hashes.
 * @param networks - The networks of subscribed node.
 * @param network_fee - The map of default fee for the network to be used in case the validator does not vote for a new fee.
 * @param ws - The WebSocket message received from.
 * @param validationNetworkDb -- A map of validator signing_keys to their corresponding networks.
 * @param enableAmendmentLedgerIndexMap -- A map of network to ledger index of last seen EnableAmendment transaction.
 * @returns Void.
 */
// eslint-disable-next-line max-params -- Disabled for this function.
export async function handleWsMessageSubscribeTypes(
  data: ValidationRaw | StreamManifest | StreamLedger | LedgerEntryResponse,
  ledger_hashes: string[],
  networks: string | undefined,
  network_fee: Map<string, FeeVote>,
  ws: WebSocket,
  validationNetworkDb: Map<string, string>,
  enableAmendmentLedgerIndexMap: Map<string, number>,
): Promise<void> {
  if (data.type === 'validationReceived') {
    const validationData = data as ValidationRaw
    if (ledger_hashes.includes(validationData.ledger_hash)) {
      validationData.networks = networks
    }

    const validationNetwork =
      validationNetworkDb.get(validationData.validation_public_key) ??
      validationData.networks

    // Get the fee for the network to be used in case the validator does not vote for a new fee.
    if (validationNetwork) {
      validationData.ledger_fee = network_fee.get(validationNetwork)
    }
    void agreement.handleValidation(validationData)
  } else if (data.type === 'manifestReceived') {
    void handleManifest(data as StreamManifest)
  } else if (data.type.includes('ledger')) {
    const current_ledger = data as StreamLedger
    ledger_hashes.push(current_ledger.ledger_hash)
    if (networks === 'main') {
      await insertValidatedLedger(networks, current_ledger)
    }
    if (networks) {
      const fee: FeeVote = {
        fee_base: current_ledger.fee_base,
        reserve_base: current_ledger.reserve_base,
        reserve_inc: current_ledger.reserve_inc,
      }
      network_fee.set(networks, fee)
    }
    if (ledger_hashes.length > LEDGER_HASHES_SIZE) {
      ledger_hashes.shift()
    }
    checkAndHandleEnableAmendmentLedger(
      current_ledger.ledger_index,
      networks,
      enableAmendmentLedgerIndexMap,
      ws.url,
    )
  }
}

/**
 * Checks and handles the EnableAmendment ledger for a given network.
 *
 * @param ledgerIndex - The index of the ledger to check.
 * @param network - The network associated with the ledger.
 * @param enableAmendmentLedgerIndexMap - A map of network to ledger index of last seen EnableAmendment transaction.
 * @param url -- Websocket url.
 */
function checkAndHandleEnableAmendmentLedger(
  ledgerIndex: number,
  network: string | undefined,
  enableAmendmentLedgerIndexMap: Map<string, number>,
  url: string,
): void {
  if (!network) {
    return
  }

  if (!isFlagLedgerPlusOne(ledgerIndex)) {
    return
  }

  // Already seen by some other node for this network. No need to save again.
  const lastSeenLedgerIndex = enableAmendmentLedgerIndexMap.get(network)
  if (lastSeenLedgerIndex && lastSeenLedgerIndex >= ledgerIndex) {
    return
  }

  enableAmendmentLedgerIndexMap.set(network, ledgerIndex)
  void processEnableAmendmentTransaction(url, network, ledgerIndex)
}

/**
 * Retrieves and processes the EnableAmendment transaction for a specific network.
 *
 * @param url - The WebSocket URL of the network.
 * @param network - The name of the network.
 * @param ledgerIndex - The index of the ledger to retrieve.
 */
async function processEnableAmendmentTransaction(
  url: string,
  network: string,
  ledgerIndex: number,
): Promise<void> {
  try {
    const client = new Client(url)
    client.apiVersion = RIPPLED_API_V1
    await client.connect()

    const ledgerResponse: LedgerResponseExpanded = await client.request({
      command: 'ledger',
      ledger_index: ledgerIndex,
      transactions: true,
      expand: true,
      api_version: RIPPLED_API_V1,
    })

    void handleWsMessageLedgerEnableAmendments(ledgerResponse, network)
    await client.disconnect()
  } catch (err) {
    log.error(
      `Failed to process EnableAmendment Transaction for ${network} at ${url} - ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }
}

/**
 * Handle ws ledger messages to search for EnableAmendment transactions.
 *
 * @param data - The WebSocket message received from connection.
 * @param networks - The networks of the WebSocket node.
 */
export async function handleWsMessageLedgerEnableAmendments(
  data: LedgerResponseExpanded,
  networks: string | undefined,
): Promise<void> {
  if (!networks || !data.result.ledger.transactions) {
    return
  }
  log.info(
    `Flag + 1 ledger found for ${networks} at index ${data.result.ledger.ledger_index}`,
  )
  log.info(`Searching for EnableAmendment transaction(s)...`)
  await Promise.all(
    data.result.ledger.transactions.map(async (transaction) => {
      if (
        typeof transaction !== 'string' &&
        transaction.TransactionType === 'EnableAmendment'
      ) {
        if (!transaction.Flags) {
          log.info(`EnableAmendment transaction found for amendment ${transaction.Amendment} on ${networks} \n
                  Amendment has been enabled.`)
          const enabledAmendment: AmendmentStatus = {
            amendment_id: transaction.Amendment,
            networks,
            ledger_index: data.result.ledger_index,
            tx_hash: transaction.hash,
            date: new Date(rippleTimeToUnixTime(data.result.ledger.close_time)),
            eta: undefined,
          }
          await saveAmendmentStatus(enabledAmendment)
        } else if (transaction.Flags === GOT_MAJORITY_FLAG) {
          log.info(`EnableAmendment transaction found for amendment ${transaction.Amendment} on ${networks} \n
                  Amendment has reached majority.`)
          const incomingAmendment = {
            amendment_id: transaction.Amendment,
            networks,
            eta: new Date(
              rippleTimeToUnixTime(data.result.ledger.close_time) +
                FOURTEEN_DAYS_IN_MILLISECONDS,
            ),
          }
          await saveAmendmentStatus(incomingAmendment)
        } else if (transaction.Flags === LOST_MAJORITY_FLAG) {
          log.info(`EnableAmendment transaction found for amendment ${transaction.Amendment} on ${networks} \n
                  Amendment has lost majority.`)
          await deleteAmendmentStatus(transaction.Amendment, networks)
        }
      }
    }),
  )
}

/**
 * Backtracking a network to update amendment status in case of Websocket disconnection.
 *
 * @param network - The network being tracked.
 * @param url - The Faucet URL of the network.
 * @returns Void.
 */
async function backtrackNetworkAmendmentStatus(
  network: string,
  url: string,
): Promise<void> {
  try {
    log.info(`Backtracking to update amendment status for ${network}...`)
    const client = new Client(url)
    await client.connect()
    const ledgerResponse: LedgerResponse = await client.request({
      command: 'ledger',
      ledger_index: 'validated',
    })
    const currentLedger = ledgerResponse.result.ledger_index

    // a flag + 1 ledger typically comes in every 10 to 15 minutes.
    const fourFlagPlusOneLedgerBefore =
      (Math.floor(currentLedger / 256) - 3) * 256 + 1

    for (
      let index = fourFlagPlusOneLedgerBefore;
      index < currentLedger;
      index += 256
    ) {
      const ledger: LedgerResponse = await client.request({
        command: 'ledger',
        transactions: true,
        ledger_index: index,
        expand: true,
      })

      await handleWsMessageLedgerEnableAmendments(
        ledger as LedgerResponseExpanded,
        network,
      )
    }

    await client.disconnect()

    log.info(`Finished backtracked amendment status for ${network}...`)
  } catch (error) {
    log.error(
      `Failed to backtrack amendment status for ${network} due to error: ${String(
        error,
      )}`,
    )
  }
}

/**
 * Backtrack amendment status periodically to ensure changes are captured.
 *
 * @returns Void.
 */
export async function backtrackAmendmentStatus(): Promise<void> {
  for (const [networks, url] of NETWORKS_HOSTS) {
    await backtrackNetworkAmendmentStatus(networks, url)
  }
}

/**
 * Retrieves and store existing Amendments into amendments_status table.
 *
 * @param network - Network name.
 * @param hostName - Hostname to connect.
 * @returns Void.
 */
async function getAmendmentsFromLedgerEntry(
  network: string,
  hostName: string,
): Promise<void> {
  log.info(
    `Started fetching Amendments ledger entry for ${network} @ ${hostName}`,
  )
  const allUrls: string[] = []
  for (const port of ports) {
    for (const protocol of protocols) {
      allUrls.push(`${protocol}${hostName}:${port}`)
    }
  }

  let statusesUpdated = false
  for (const url of allUrls) {
    try {
      const client = new Client(url)
      client.apiVersion = RIPPLED_API_V1
      await client.connect()

      const amendmentLedgerEntry: LedgerEntryResponse<Amendments> =
        await client.request({
          command: 'ledger_entry',
          index: AMENDMENTS_ID,
          ledger_index: 'validated',
          api_version: RIPPLED_API_V1,
        })

      await saveAmendmentsStatus(
        amendmentLedgerEntry.result.node?.Amendments ?? [],
        network,
      )

      await client.disconnect()

      statusesUpdated = true
      break
    } catch (err) {
      log.info(
        `Failed to connect ${url} - ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
    }
  }

  if (!statusesUpdated) {
    log.error(
      `Not able to fetch Amendments ledger entry for ${network} @ ${hostName}`,
    )
  }

  log.info(
    `Finished fetching Amendments ledger entry for ${network} @ ${hostName}`,
  )
}

/**
 * Fetch existing Amendments from ledger_entry.
 *
 * @returns Void.
 */
export async function fetchAmendmentsFromLedgerEntry(): Promise<void> {
  const promises: Array<Promise<void>> = []

  for (const network of await getNetworks()) {
    promises.push(getAmendmentsFromLedgerEntry(network.id, network.entry))
  }

  await Promise.all(promises)
}
