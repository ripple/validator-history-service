import chains from '../../src/connection-manager/chains'
import { destroy, query, setupTables } from '../../src/shared/database'
import { LedgerHash, LedgerIndex } from '../../src/shared/types'

import validations from './fixtures/all-validations.json'

jest.useFakeTimers()

describe('Creates chains', () => {
  beforeAll(async () => {
    await setupTables()
  })

  afterAll(async () => {
    await destroy()
  })

  beforeEach(async () => {
    await query('crawls').delete('*')
  })

  test('Perfect validation scores', async () => {
    for (const validation of validations) {
      chains.updateLedgers(validation)
    }

    const time = Date.now() + 11000

    // Mock date.now
    Date.now = (): number => time
    const constructed: Array<{
      ledgers: Map<LedgerHash, LedgerIndex>
      validators: Set<string>
    }> = chains.calculateChainsFromLedgers()

    const ledgerHashes = Array.from(constructed[0].ledgers.keys())
    console.log('hashes', ledgerHashes)
    expect(ledgerHashes).toContain('LEDGER1')
    expect(ledgerHashes).toContain('LEDGER2')
    expect(ledgerHashes).toContain('LEDGER3')

    expect(constructed[0].validators).toContain('VALIDATOR1')
    expect(constructed[0].validators).toContain('VALIDATOR2')
    expect(constructed[0].validators).toContain('VALIDATOR3')
  })

  test('Purge chains removes ledgers', async () => {
    await chains.purgeChains()

    const constructed: Array<{
      ledgers: Map<LedgerHash, LedgerIndex>
      validators: Set<string>
    }> = chains.calculateChainsFromLedgers()

    expect(constructed[0].ledgers).toEqual(new Map())

    expect(constructed[0].validators).toContain('VALIDATOR1')
    expect(constructed[0].validators).toContain('VALIDATOR2')
    expect(constructed[0].validators).toContain('VALIDATOR3')
  })
})
