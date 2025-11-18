import type { ValidationRaw } from '../../src/shared/types'

interface MockLogger {
  trace: jest.Mock
  info: jest.Mock
  warn: jest.Mock
  error: jest.Mock
  debug: jest.Mock
}

describe('XRPL Mainnet continuity check - out-of-order ledgers', () => {
  let errorMock: jest.Mock

  beforeEach(() => {
    jest.resetModules()
    errorMock = jest.fn()
  })

  test('out-of-order validated ledgers do not log errors', () => {
    jest.isolateModules(() => {
      jest.doMock('../../src/shared/utils/logger', () => ({
        __esModule: true,
        default: (): MockLogger => ({
          trace: jest.fn(),
          info: jest.fn(),
          warn: jest.fn(),
          // capture chains.ts log.error
          error: errorMock,
          debug: jest.fn(),
        }),
      }))

      // eslint-disable-next-line max-len -- comment is required to explain the mock behavior
      /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires, n/global-require -- import AFTER mocking so chains grabs the mocked logger */
      const chains = (
        require('../../src/connection-manager/chains') as {
          default: typeof import('../../src/connection-manager/chains').default
        }
      ).default
      /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires, n/global-require */

      const originalNow = Date.now
      const base = originalNow()

      // Feed validations out of order; indices are large to avoid the "really old mainnet" filter
      const makeValidationMessage = (
        hash: string,
        index: number,
        signer: string,
      ): ValidationRaw => ({
        flags: 0,
        full: true,
        ledger_hash: hash,
        ledger_index: String(index),
        master_key: `${signer}_MASTER`,
        signature: 'sig',
        signing_time: base,
        type: 'validationReceived',
        validation_public_key: signer,
        network_id: 0,
      })

      // First-seen timestamps
      Date.now = (): number => base

      // Two distinct validations per ledger (required by calculateChainsFromLedgers)
      const L1 = 100000001
      const L2 = 100000002
      const L3 = 100000003

      // Intentionally out-of-order arrival
      chains.updateLedgers(makeValidationMessage('H3', L3, 'VAL_A'))
      chains.updateLedgers(makeValidationMessage('H3', L3, 'VAL_B'))
      chains.updateLedgers(makeValidationMessage('H2', L2, 'VAL_A'))
      chains.updateLedgers(makeValidationMessage('H2', L2, 'VAL_B'))
      chains.updateLedgers(makeValidationMessage('H1', L1, 'VAL_A'))
      chains.updateLedgers(makeValidationMessage('H1', L1, 'VAL_B'))

      // Age entries past 10s threshold so they are processed
      Date.now = (): number => base + 11_000

      // Triggers the sort-and-continuity check; should NOT log errors
      chains.calculateChainsFromLedgers()

      // No error logs expected after sorting by ledger_index
      expect(errorMock).not.toHaveBeenCalled()

      // restore clock
      Date.now = originalNow
    })
  })
})
