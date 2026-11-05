// rippled counts only full validations when it scores a validator: a
// validation is full only when its sender was proposing
// (RCLConsensus.cpp:826-827 in 3.4.1), and getTrustedForLedger keeps
// `v.trusted() && v.full()` (Validations.h:1063), which
// NegativeUNLVote::buildScoreTable uses (NegativeUNLVote.cpp:158-233).
// A partial validation must therefore not count as agreement.

import agreement from '../../src/connection-manager/agreement'
import { destroy, query, setupTables } from '../../src/shared/database'
import { AgreementScore, ValidationRaw } from '../../src/shared/types'

/**
 * Builds a validation for the stream.
 *
 * @param key - Validator name, used for both keys.
 * @param index - Ledger index.
 * @param full - Whether the validation is full.
 * @returns A raw validation.
 */
function validation(key: string, index: number, full: boolean): ValidationRaw {
  return {
    flags: full ? 2147483649 : 2147483648,
    full,
    ledger_hash: `FULLONLY_LEDGER${index}`,
    ledger_index: String(index),
    master_key: `${key}MASTER`,
    signature: 'SIG',
    signing_time: 669928656 + index,
    type: 'validationReceived',
    validation_public_key: key,
  } as ValidationRaw
}

describe('Agreement counts full validations only', () => {
  beforeAll(async () => {
    await setupTables()
  })

  afterAll(async () => {
    await destroy()
  })

  beforeEach(async () => {
    await query('hourly_agreement').delete('*')
    await query('daily_agreement').delete('*')
    await query('validators').delete('*')
  })

  test('a validator that sends only partial validations misses every ledger', async () => {
    for (let index = 1; index <= 3; index++) {
      await agreement.handleValidation(validation('FULL1', index, true))
      await agreement.handleValidation(validation('FULL2', index, true))
      await agreement.handleValidation(validation('PARTIAL', index, false))
    }

    const time = Date.now() + 11000
    Date.now = (): number => time
    await agreement.calculateAgreement()

    const rows = (await query('validators').select(
      'master_key',
      'agreement_1hour',
    )) as Array<{ master_key: string; agreement_1hour: AgreementScore }>
    const score = (key: string): AgreementScore | undefined =>
      rows.find((row) => row.master_key === `${key}MASTER`)?.agreement_1hour

    expect(score('FULL1')).toMatchObject({ validated: 3, missed: 0 })
    expect(score('FULL2')).toMatchObject({ validated: 3, missed: 0 })
    expect(score('PARTIAL')).toMatchObject({ validated: 0, missed: 3 })
  })
})
