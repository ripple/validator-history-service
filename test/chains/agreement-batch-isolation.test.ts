// calculateAgreement() runs one promise per validator inside a single
// Promise.all, then purges the hourly scores, purges the ledger chains, and
// advances reported_at. Previously any single validator's promise rejecting
// (e.g. a transient DB error) rejected the whole Promise.all, which skipped
// the purge/reset for every validator in that hour, not just the one that
// failed -- that is what let the ledger chains grow unbounded. Each
// validator's promise must now be caught individually so the batch-level
// purge/reset always runs.

import agreement from '../../src/connection-manager/agreement'
import chains from '../../src/connection-manager/chains'
import * as database from '../../src/shared/database'
import { destroy, query, setupTables } from '../../src/shared/database'

import validations from './fixtures/all-validations.json'

describe('Agreement batch isolation', () => {
  beforeAll(async () => {
    await setupTables()
  })

  afterAll(async () => {
    await destroy()
  })

  beforeEach(async () => {
    await query('hourly_agreement').delete('*')
    await query('daily_agreement').delete('*')
    await query('manifests').delete('*')
    await query('validators').delete('*')
  })

  afterEach(async () => {
    jest.restoreAllMocks()
    await query('hourly_agreement').delete('*')
    await query('daily_agreement').delete('*')
    await query('manifests').delete('*')
    await query('validators').delete('*')
  })

  test('one validator failing to calculate agreement does not block the purge/reset for the batch', async () => {
    for (const validation of validations) {
      await agreement.handleValidation(validation)
    }

    const time = Date.now() + 11000
    Date.now = (): number => time

    jest.spyOn(database, 'getAgreementScores').mockImplementationOnce(() => {
      throw new Error('simulated pool timeout for one validator')
    })

    const purgeChainsSpy = jest.spyOn(chains, 'purgeChains')

    await expect(agreement.calculateAgreement()).resolves.toBeUndefined()

    expect(purgeChainsSpy).toHaveBeenCalled()

    const constructed: Array<{ ledgers: Set<string> }> =
      chains.calculateChainsFromLedgers()
    expect(constructed[0].ledgers).toEqual(new Set())
  })
})
