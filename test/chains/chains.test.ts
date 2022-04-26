import chains from '../../src/connection-manager/chains'
import { destroy, query, setupTables } from '../../src/shared/database'

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
      ledgers: Set<string>
      validators: Set<string>
    }> = chains.calculateChainsFromLedgers()

    expect(constructed[0].ledgers).toContain('LEDGER1')
    expect(constructed[0].ledgers).toContain('LEDGER2')
    expect(constructed[0].ledgers).toContain('LEDGER3')

    expect(constructed[0].validators).toContain('VALIDATOR1')
    expect(constructed[0].validators).toContain('VALIDATOR2')
    expect(constructed[0].validators).toContain('VALIDATOR3')
  })

  test('Purge chains removes ledgers', async () => {
    await chains.purgeChains()

    const constructed: Array<{
      ledgers: Set<string>
      validators: Set<string>
    }> = chains.calculateChainsFromLedgers()

    expect(constructed[0].ledgers).toEqual(new Set())

    expect(constructed[0].validators).toContain('VALIDATOR1')
    expect(constructed[0].validators).toContain('VALIDATOR2')
    expect(constructed[0].validators).toContain('VALIDATOR3')
  })
})
