import chains from '../../src/connection-manager/chains'
import { destroy, query, setupTables } from '../../src/shared/database'
import type { LedgerHashIndex, ValidationRaw } from '../../src/shared/types'

import validations from './fixtures/all-validations.json'

jest.useFakeTimers()

describe('Test the assignment of ledgers into appropriate chains with legacy validations', () => {
  beforeAll(async () => {
    await setupTables()
  })

  afterAll(async () => {
    await destroy()
  })

  beforeEach(async () => {
    await query('connection_health').delete('*')
    await query('crawls').delete('*')
    await query('validators').delete('*')
  })

  test(`Simulate validationReceived messages without network_id field`, async () => {
    await query('validators').insert([
      { signing_key: 'VALIDATOR1', networks: 'test' },
      { signing_key: 'VALIDATOR2', networks: 'test' },
      { signing_key: 'VALIDATOR3', networks: 'test' },
    ])

    for (const validation of validations) {
      const validationSansNetworkId = { ...validation, network_id: undefined }
      await chains.updateLedgers(
        validationSansNetworkId as unknown as ValidationRaw,
      )
    }

    const time = Date.now() + 11000

    // Mock date.now
    Date.now = (): number => time
    const constructed: Array<{
      ledgers: Set<LedgerHashIndex>
      validators: Set<string>
      network_id: number
    }> = chains.calculateChainsFromLedgers()

    // If validation messages do not have a network_id field, they are ignored.
    expect(constructed).toHaveLength(0)
  })
})
