import { query } from './utils'
import { StreamLedger } from '../types'
import { rippleTimeToUnixTime } from 'xrpl'

export async function insertValidatedLedger(
  network: string,
  ledger: StreamLedger,
): Promise<void> {
  const ledgerTime = new Date(rippleTimeToUnixTime(ledger.ledger_time))
  await query('validated_ledgers')
    .insert({
      network,
      ledger_hash: ledger.ledger_hash,
      ledger_index: ledger.ledger_index,
      ledger_time: ledgerTime,
      // fee_base: ledger.fee_base,
      // fee_ref: ledger.fee_ref,
      // reserve_base: ledger.reserve_base,
      // reserve_inc: ledger.reserve_inc,
      txn_count: ledger.txn_id,
    })
    .onConflict(['network', 'ledger_hash'])
    .ignore()
}
