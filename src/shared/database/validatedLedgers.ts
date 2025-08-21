import { query } from './utils'
import { StreamLedger } from '../types'

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
