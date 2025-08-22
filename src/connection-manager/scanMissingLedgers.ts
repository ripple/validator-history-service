import { db, query } from '../shared/database'
import { insertMissingLedger } from '../shared/database/validatedLedgers'
import { MissingLedger } from '../shared/types'

// check for missing ledgers every minute
const SCAN_PERIOD = 1000 * 60 * 5
export default async function checkForMissingLedgers(): Promise<void> {
  const hasTable =
    (await db().schema.hasTable('validated_ledgers')) &&
    (await db().schema.hasTable('missing_ledgers'))
  if (!hasTable) {
    return
  }
  const recentLedgers: Array<{ ledger_index: string; received_at: Date }> =
    await query('validated_ledgers')
      .orderBy('ledger_index', 'asc')
      .where('received_at', '>', new Date(Date.now() - SCAN_PERIOD))
      .where('network', 'main')
      .select('ledger_index', 'received_at')

  for (let i = 0; i < recentLedgers.length - 1; i++) {
    const currentLedger = recentLedgers[i]

    if (
      parseInt(recentLedgers[i + 1].ledger_index, 10) !==
      parseInt(currentLedger.ledger_index, 10) + 1
    ) {
      await insertMissingLedger({
        network: 'main',
        ledger_index: parseInt(currentLedger.ledger_index, 10) + 1,
        previous_ledger_index: parseInt(currentLedger.ledger_index, 10),
        previous_ledger_received_at: currentLedger.received_at,
      } as MissingLedger)
    }
  }
}
