import WebSocket from 'ws'
import { rippleTimeToUnixTime } from 'xrpl'

import {
  query,
  saveAmendmentEnabled,
  saveAmendmentsEnabled,
} from '../shared/database'
import {
  AmendmentEnabled,
  DatabaseValidator,
  FeeVote,
  LedgerEnableAmendmentResponse,
  LedgerEntryAmendmentsResponse,
  StreamLedger,
  StreamManifest,
  TxEnableAmendmentResponse,
  ValidationRaw,
} from '../shared/types'

import agreement from './agreement'
import { handleManifest } from './manifests'

const LEDGER_HASHES_SIZE = 10
const AMENDMENT_LEDGER_ENTRY_INDEX =
  '7DB0788C020F02780A673DC74757F23823FA3014C1866E72CC4CD8B226CD6EF4'

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
 * Sends a ledger_entry WebSocket request to retrieve amendments enabled on a network.
 *
 * @param ws - A WebSocket object.
 */
export function getAmendmentLedgerEntry(ws: WebSocket): void {
  ws.send(
    JSON.stringify({
      command: 'ledger_entry',
      index: AMENDMENT_LEDGER_ENTRY_INDEX,
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
 * Sends a tx WebSocket request to retrieve EnableAmendment transaction details.
 *
 * @param ws - A WebSocket object.
 * @param transaction -- The hash of the transaction..
 */
function getEnableAmendmentTx(ws: WebSocket, transaction: string): void {
  ws.send(
    JSON.stringify({
      command: 'tx',
      transaction,
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
 * @returns Void.
 */
export async function handleWsMessageSubscribeTypes(
  data:
    | ValidationRaw
    | StreamManifest
    | StreamLedger
    | LedgerEntryAmendmentsResponse,
  ledger_hashes: string[],
  networks: string | undefined,
  network_fee: Map<string, FeeVote>,
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
  }
}

/**
 * Handle ws ledger_entry amendments messages.
 *
 * @param ws - A WebSocket object.
 * @param data - The WebSocket message received from connection.
 * @param networks - The networks of subscribed node.
 */
export async function handleWsMessageLedgerEntryAmendments(
  ws: WebSocket,
  data: LedgerEntryAmendmentsResponse,
  networks: string | undefined,
): Promise<void> {
  if (data.result.node.LedgerEntryType === 'Amendments') {
    await saveAmendmentsEnabled(data.result.node.Amendments, networks)
  }
  if (isFlagLedgerPlusOne(data.result.ledger_index)) {
    getEnableAmendmentLedger(ws, data.result.ledger_index)
  }
}

/**
 * Handle ws ledger messages to search for EnableAmendment transactions.
 *
 * @param ws - A WebSocket object.
 * @param data - The WebSocket message received from connection.
 */
export async function handleWsMessageLedgerEnableAmendments(
  ws: WebSocket,
  data: LedgerEnableAmendmentResponse,
): Promise<void> {
  data.result.ledger.transactions.forEach(async (transaction) => {
    if (
      transaction.TransactionType === 'EnableAmendment' &&
      !transaction.Flags
    ) {
      getEnableAmendmentTx(ws, transaction.hash)
    }
  })
}

/**
 * Handle ws ledger messages to process EnableAmendment transactions.
 *
 * @param data - The WebSocket message received from connection.
 * @param networks - The WebSocket message received from connection.
 */
export async function handleWsMessageTxEnableAmendments(
  data: TxEnableAmendmentResponse,
  networks: string | undefined,
): Promise<void> {
  const amendment: AmendmentEnabled = {
    amendment_id: data.result.Amendment,
    networks,
    ledger_index: data.result.ledger_index,
    tx_hash: data.result.hash,
    date: new Date(rippleTimeToUnixTime(data.result.date)),
  }
  await saveAmendmentEnabled(amendment)
}
