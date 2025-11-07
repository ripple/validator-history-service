import { jest } from '@jest/globals'
import type { Chain } from '../../src/shared/types'

import { destroy, query, setupTables } from '../../src/shared/database'
import { saveValidatorChains } from '../../src/connection-manager/chains'


jest.mock('../../src/shared/utils', () => {
  // Re-export actual utilities except `getLists`
  const actual = jest.requireActual('../../src/shared/utils')
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

  test('test the happy-path scenario of saveValidatorChains', async () => {
    const sampleChain: Chain = {
      network_id: 1025,
      current: 1,
      first: 1,
      validators: new Set(['VALIDATOR1', 'VALIDATOR2', 'VALIDATOR3']),
      updated: Date.now(),
      ledgers: new Set(['LEDGER1', 'LEDGER2', 'LEDGER3']),
      incomplete: false,
    }
    // seed the validators table with three entries, with all but the `chain` column.
    await query('validators').insert([
      { signing_key: 'VALIDATOR1' },
      { signing_key: 'VALIDATOR2' },
      { signing_key: 'VALIDATOR3' },
    ])
    await saveValidatorChains(sampleChain)

    const validators = await query('validators').select('*')
    expect(validators.length).toBe(3)

    expect(validators[0].chain).toBe('fake-network')
    expect(validators[1].chain).toBe('fake-network')
    expect(validators[2].chain).toBe('fake-network')
  })
})
