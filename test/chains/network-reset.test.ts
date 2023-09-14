import chains from '../../src/connection-manager/chains'
import { destroy, setupTables } from '../../src/shared/database'

import validationsAtReset from './fixtures/reset-validations.json'

jest.useFakeTimers()

describe('Chains on reset', () => {
  beforeAll(async () => {
    await setupTables()
  })

  afterAll(async () => {
    await destroy()
  })

  test('Chain at reset before purged', async () => {
    for (const validation of validationsAtReset.slice(0, 6)) {
      chains.updateLedgers(validation)
    }

    let time = Date.now() + 11000
    Date.now = (): number => time

    const before: Array<{
      ledgers: Set<string>
      validators: Set<string>
    }> = await chains.calculateChainsFromLedgers()

    expect(before[0].ledgers).toContain('LEDGER1000')
    expect(before[0].ledgers).toContain('LEDGER1001')

    expect(before[0].validators).toContain('VALIDATOR1')
    expect(before[0].validators).toContain('VALIDATOR2')
    expect(before[0].validators).toContain('VALIDATOR3')

    // Reset the network
    for (const validation of validationsAtReset.slice(6)) {
      chains.updateLedgers(validation)
    }

    time = Date.now() + 11000
    Date.now = (): number => time

    const after: Array<{
      ledgers: Set<string>
      validators: Set<string>
    }> = await chains.calculateChainsFromLedgers()

    expect(after.length).toEqual(1)
    expect(after[0].ledgers.size).toEqual(1)
    expect(after[0].ledgers).toContain('LEDGER1')

    expect(before[0].validators).toContain('VALIDATOR1')
    expect(before[0].validators).toContain('VALIDATOR2')
    expect(before[0].validators).toContain('VALIDATOR3')
  })
})
