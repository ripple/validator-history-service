/* eslint-disable import/max-dependencies -- Disbale for this file which uses a lot of types. */
import WebSocket from 'ws'
import { LedgerEntryResponse, rippleTimeToUnixTime } from 'xrpl'
import { AMENDMENTS_ID } from 'xrpl/dist/npm/models/ledger'

import {
  query,
  saveAmendmentStatus,
  saveAmendmentsStatus,
} from '../shared/database'
import { deleteAmendmentStatus } from '../shared/database/amendments'
import {
  AmendmentStatus,
  DatabaseValidator,
  FeeVote,
  LedgerResponseCorrected,
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
 * Sends a ledger_entry WebSocket request to retrieve amendments status on a network.
 *
 * @param ws - A WebSocket object.
 */
export function getAmendmentLedgerEntry(ws: WebSocket): void {
  ws.send(
    JSON.stringify({
      command: 'ledger_entry',
      index: AMENDMENTS_ID,
      ledger_index: 'validated',
    }),
  )
}

/**
 * Sends a ledger WebSocket request to retrieve transactions on a flag+1 ledger.
 *
 * @param ws - A WebSocket object.
 * @param ledger_index -- The index of the ledger.
 */
function getEnableAmendmentLedger(ws: WebSocket, ledger_index: number): void {
  ws.send(
    JSON.stringify({
      command: 'ledger',
      ledger_index,
      transactions: true,
      expand: true,
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
 * @returns Void.
 */
// eslint-disable-next-line max-params -- Disabled for this function.
export async function handleWsMessageSubscribeTypes(
  data: ValidationRaw | StreamManifest | StreamLedger | LedgerEntryResponse,
  ledger_hashes: string[],
  networks: string | undefined,
  network_fee: Map<string, FeeVote>,
  ws: WebSocket,
): Promise<void> {
  if (data.type === 'validationReceived') {
    const validationData = data as ValidationRaw
    if (ledger_hashes.includes(validationData.ledger_hash)) {
      validationData.networks = networks
    }

    // Get network of the validation if ledger_hash is not in cache.
    const validationNetworkDb: DatabaseValidator | undefined = await query(
      'validators',
    )
      .select('*')
      .where('signing_key', validationData.validation_public_key)
      .first()
    const validationNetwork =
      validationNetworkDb?.networks ?? validationData.networks

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
    if (isFlagLedgerPlusOne(current_ledger.ledger_index)) {
      getEnableAmendmentLedger(ws, current_ledger.ledger_index)
    }
  }
}

/**
 * Handle ws ledger_entry amendments messages.
 *
 * @param data - The WebSocket message received from connection.
 * @param networks - The networks of subscribed node.
 */
export async function handleWsMessageLedgerEntryAmendments(
  data: LedgerEntryResponse,
  networks: string | undefined,
): Promise<void> {
  if (
    data.result.node?.LedgerEntryType === 'Amendments' &&
    data.result.node.Amendments
  ) {
    await saveAmendmentsStatus(data.result.node.Amendments, networks)
  }
}

/**
 * Handle ws ledger messages to search for EnableAmendment transactions.
 *
 * @param data - The WebSocket message received from connection.
 * @param networks - The networks of the WebSocket node.
 */
export async function handleWsMessageLedgerEnableAmendments(
  data: LedgerResponseCorrected,
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
