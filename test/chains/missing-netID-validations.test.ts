import chains from '../../src/connection-manager/chains'
import { destroy, query, setupTables } from '../../src/shared/database'
import type { LedgerHashIndex, ValidationRaw } from '../../src/shared/types'

import validations from './fixtures/all-validations.json'

jest.useFakeTimers()

describe('Test the assignment of ledgers into appropriate chains', () => {
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
      { signing_key: 'VALIDATOR1', networks: 'testnet' },
      { signing_key: 'VALIDATOR2', networks: 'testnet' },
      { signing_key: 'VALIDATOR3', networks: 'testnet' },
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

    // ledgers are recorded for only network_id == 1025
    expect(constructed).toHaveLength(1)
    expect(constructed[0].ledgers).toEqual(
      new Set([
        { ledger_hash: 'LEDGER1', ledger_index: 1 } as LedgerHashIndex,
        { ledger_hash: 'LEDGER2', ledger_index: 2 } as LedgerHashIndex,
        { ledger_hash: 'LEDGER3', ledger_index: 3 } as LedgerHashIndex,
      ]),
    )

    expect(constructed[0].validators).toContain('VALIDATOR1')
    expect(constructed[0].validators).toContain('VALIDATOR2')
    expect(constructed[0].validators).toContain('VALIDATOR3')
    expect(constructed[0].network_id).toBe(1)
  })
})
