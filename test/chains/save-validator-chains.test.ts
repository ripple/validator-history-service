import { saveValidatorChains } from '../../src/connection-manager/chains'
import { destroy, query, setupTables } from '../../src/shared/database'
import type { Chain, LedgerHashIndex } from '../../src/shared/types'

jest.mock('../../src/shared/utils', () => {
  // Re-export actual utilities except `getLists`
  const actual: typeof import('../../src/shared/utils') = jest.requireActual(
    '../../src/shared/utils',
  )
  return {
    ...(actual as object),
    getLists: jest.fn(async () => {
      return {
        'fake-network': new Set(['VALIDATOR1', 'VALIDATOR2', 'VALIDATOR3']),
      }
    }),
  }
})

describe('validate the logic of saveValidatorChains', () => {
  beforeAll(async () => {
    await setupTables()
  })

  afterAll(async () => {
    await destroy()
  })

  beforeEach(async () => {
    await query('validators').delete('*')
    jest.resetModules()
    jest.clearAllMocks()
    jest.useFakeTimers()
  })

  afterEach(async () => {
    await query('validators').delete('*')
    jest.useRealTimers()
  })

  test('the happy-path scenario of saveValidatorChains', async () => {
    const sampleChain: Chain = {
      network_id: 1025,
      current: 1,
      first: 1,
      validators: new Set(['VALIDATOR1', 'VALIDATOR2', 'VALIDATOR3']),
      updated: Date.now(),
      ledgers: new Set([
        { ledger_hash: 'LEDGER1', ledger_index: 1 } as LedgerHashIndex,
        { ledger_hash: 'LEDGER2', ledger_index: 2 } as LedgerHashIndex,
        { ledger_hash: 'LEDGER3', ledger_index: 3 } as LedgerHashIndex,
      ]),
      incomplete: false,
    }
    // seed the validators table with three entries, with all but the `chain` column.
    await query('validators').insert([
      { signing_key: 'VALIDATOR1' },
      { signing_key: 'VALIDATOR2' },
      { signing_key: 'VALIDATOR3' },
    ])
    await saveValidatorChains(sampleChain)

    const validators: Array<{ signing_key: string; chain: string }> =
      (await query('validators').select('*')) as Array<{
        signing_key: string
        chain: string
      }>
    expect(validators).toHaveLength(3)

    expect(validators[0].chain).toBe('fake-network')
    expect(validators[1].chain).toBe('fake-network')
    expect(validators[2].chain).toBe('fake-network')
  })
})
