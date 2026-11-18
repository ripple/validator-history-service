// rippled tallies amendment and fee votes from trusted full validations
// only: RCLConsensus.cpp:364-366 in 3.4.1 takes
// negativeUNLFilter(getTrustedForLedger(...)), and getTrustedForLedger keeps
// `v.trusted() && v.full()` (Validations.h:1063). A partial validation's
// votes are never counted, so they must not become the validator's ballot.

import agreement from '../../src/connection-manager/agreement'
import { destroy, query, setupTables } from '../../src/shared/database'
import { ValidationRaw } from '../../src/shared/types'

/**
 * Builds a validation of the ledger before a flag ledger, carrying votes.
 *
 * @param key - Validator name, used for both keys.
 * @param full - Whether the validation is full.
 * @returns A raw validation.
 */
function vote(key: string, full: boolean): ValidationRaw {
  return {
    flags: full ? 2147483649 : 2147483648,
    full,
    ledger_hash: `BALLOT_LEDGER_${key}`,
    ledger_index: '511',
    master_key: `${key}MASTER`,
    signature: 'SIG',
    signing_time: 669928656,
    type: 'validationReceived',
    validation_public_key: key,
    amendments: ['AMENDMENT1'],
    base_fee: 20,
  } as ValidationRaw
}

describe('Ballots come from full validations only', () => {
  beforeAll(async () => {
    await setupTables()
  })

  afterAll(async () => {
    await destroy()
  })

  beforeEach(async () => {
    await query('ballot').delete('*')
    await query('validators').delete('*')
  })

  test('a full validation records a ballot and a partial one does not', async () => {
    await agreement.handleValidation(vote('BALLOTFULL', true))
    await agreement.handleValidation(vote('BALLOTPARTIAL', false))

    const ballots = (await query('ballot').select(
      'signing_key',
      'amendments',
    )) as Array<{ signing_key: string; amendments: string }>

    expect(ballots).toEqual([
      { signing_key: 'BALLOTFULL', amendments: 'AMENDMENT1' },
    ])
  })
})
