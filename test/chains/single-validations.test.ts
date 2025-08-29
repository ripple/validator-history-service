import chains from '../../src/connection-manager/chains'
import { destroy, query, setupTables } from '../../src/shared/database'

import singleValidations from './fixtures/single-validations.json'

jest.useFakeTimers()

describe('Single Validations', () => {
  beforeAll(async () => {
    await setupTables()
  })

  afterAll(async () => {
    await destroy()
  })

  beforeEach(async () => {
    await query('connection_health').delete('*')
    await query('crawls').delete('*')
  })

  test('Ignores single validations', async () => {
    for (const validation of singleValidations) {
      chains.updateLedgers(validation)
    }

    const time = Date.now() + 11000

    // Mock date.now
    Date.now = (): number => time
    const constructed: Array<{
      ledgers: Set<string>
      validators: Set<string>
    }> = await chains.calculateChainsFromLedgers()

    expect(constructed).toEqual([])
  })
})
