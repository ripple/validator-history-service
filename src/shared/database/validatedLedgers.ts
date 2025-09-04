import { rippleTimeToUnixTime } from 'xrpl'

import { StreamLedger } from '../types'
import logger from '../utils/logger'

import { query } from './utils'

const log = logger({ name: 'validatedLedgers-db' })

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
  try {
    await query('validated_ledgers')
      .insert({
        network,
        ledger_hash: ledger.ledger_hash,
        ledger_index: ledger.ledger_index,
        ledger_time: new Date(rippleTimeToUnixTime(ledger.ledger_time)),
        fee_base: ledger.fee_base,
        reserve_base: ledger.reserve_base,
        reserve_inc: ledger.reserve_inc,
        txn_id: ledger.txn_id,
      })
      .onConflict(['ledger_index', 'network', 'ledger_hash'])
      .ignore()
  } catch (err: unknown) {
    log.error(`Error inserting validated ledger`, err)
  }
}

export interface ValidatedLedger {
  ledger_hash: string
  ledger_index: number
  network: string
  validation_public_keys: string[]
  ledger_time: Date
  fee_base: number
  reserve_base: number
  reserve_inc: number
  txn_id: number
}

/**
 * This method inserts validations associated with a ledger into the validated_ledgers table.
 *
 * @param ledger_hash - The hash of the ledger.
 * @param ledger_index - The index of the ledger.
 * @param validation_public_keys - The signing keys associated with the validations of this ledger.
 * @param networkName - The name of the network.
 * @returns A promise that resolves when the insertion is complete.
 */
export async function insertValidations(
  ledger_hash: string,
  ledger_index: number,
  validation_public_keys: string[],
  networkName: string,
): Promise<void> {
  try {
    const existingLedgers: ValidatedLedger[] = (await query('validated_ledgers')
      .select('*')
      .where('ledger_hash', ledger_hash)
      .andWhere('ledger_index', ledger_index)
      .andWhere('network', networkName)) as ValidatedLedger[]

    if (existingLedgers.length === 1) {
      await query('validated_ledgers')
        .insert({
          ...existingLedgers[0],
          validation_public_keys: Array.from(validation_public_keys),
        })
        .onConflict(['ledger_index', 'ledger_hash', 'network'])
        .merge({
          validation_public_keys: Array.from(validation_public_keys),
        })
    } else if (existingLedgers.length === 0) {
      log.error(
        `Unable to locate the ledger with LedgerHash: ${ledger_hash}, LedgerIndex: ${ledger_index} and network: ${networkName} in the validated_ledgers table. Associated validations ${validation_public_keys.join(
          ',',
        )} are not saved into the DB.`,
      )
    } else {
      log.error(
        `Unexpected number of ledger entries ${Number(
          existingLedgers.length,
        )} found for ledger with LedgerHash: ${ledger_hash}, LedgerIndex: ${ledger_index} and network: ${networkName} in the validated_ledgers table.`,
      )
    }
  } catch (err: unknown) {
    log.error(
      `Error inserting validations into the validated_ledgers table`,
      err,
    )
  }
}
