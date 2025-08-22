import { StreamLedger, MissingLedger } from '../types'

import { query } from './utils'

/**
 * Inserts a validated ledger into the database, ignoring if it already exists.
 *
 * @param network - The network identifier.
 * @param ledger - The ledger data to insert.
 * @returns A promise that resolves when the insertion is complete.
 */
export async function insertValidatedLedger(
  network: string,
  ledger: StreamLedger,
): Promise<void> {
  await query('validated_ledgers')
    .insert({
      network,
      ledger_hash: ledger.ledger_hash,
      ledger_index: ledger.ledger_index,
      ledger_time: ledger.ledger_time,
      fee_base: ledger.fee_base,
      reserve_base: ledger.reserve_base,
      reserve_inc: ledger.reserve_inc,
      txn_id: ledger.txn_id,
    })
    .onConflict(['network', 'ledger_hash'])
    .ignore()
}

/**
 * Retrieves the most recent validated ledgers for a network, up to a specified limit.
 *
 * @param network - The network identifier.
 * @param limit - Optional limit on the number of ledgers to return (default: 100).
 * @returns A promise resolving to an array of recent validated ledgers.
 */
export async function getRecentValidatedLedgers(
  network: string,
  limit?: number,
): Promise<StreamLedger[]> {
  return query('validated_ledgers')
    .where('network', network)
    .orderBy('ledger_index', 'desc')
    .select('*')
    .limit(limit ?? 100)
}

/**
 * Inserts a missing ledger record into the database, ignoring if it already exists.
 *
 * @param missedLedger - The missing ledger data to insert.
 * @returns A promise that resolves when the insertion is complete.
 */
export async function insertMissingLedger(
  missedLedger: MissingLedger,
): Promise<void> {
  await query('missing_ledgers')
    .insert({
      network: missedLedger.network,
      ledger_index: missedLedger.ledger_index,
      previous_ledger_index: missedLedger.previous_ledger_index,
      previous_ledger_received_at: missedLedger.previous_ledger_received_at,
    })
    .onConflict(['network', 'ledger_index'])
    .ignore()
}

/**
 * Retrieves all missing ledgers for a network, ordered by ledger index descending.
 *
 * @param network - The network identifier.
 * @returns A promise resolving to an array of missing ledgers.
 */
export async function getMissingLedgers(
  network: string,
): Promise<MissingLedger[]> {
  return query('missing_ledgers')
    .where('network', network)
    .orderBy('ledger_index', 'desc')
    .select('*')
}
