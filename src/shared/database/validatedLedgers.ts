import { query } from './utils'
import { StreamLedger, MissingLedger } from '../types'

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

export async function getRecentValidatedLedgers(
  network: string,
  limit?: number,
): Promise<StreamLedger[]> {
  return await query('validated_ledgers')
    .where('network', network)
    .orderBy('ledger_index', 'desc')
    .select('*')
    .limit(limit ?? 100)
}

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

export async function getMissingLedgers(
  network: string,
): Promise<MissingLedger[]> {
  return await query('missing_ledgers')
    .where('network', network)
    .orderBy('ledger_index', 'desc')
    .select('*')
}
