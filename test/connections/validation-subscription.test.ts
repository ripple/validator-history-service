import { handleWsMessageSubscribeTypes } from '../../src/connection-manager/wsHandling'
import validationStream from './fixtures/validation-stream.json'
import ws from 'ws'
import { saveValidation } from '../../src/shared/database'
jest.mock('../../src/connection-manager/agreement')

jest.mock('ws')
jest.mock('../../src/shared/database/validations')

describe('Persist validations upon reciept', () => {
  test('Persist validations upon reciept', async () => {
    for (const validation of validationStream) {
      await handleWsMessageSubscribeTypes(
        validation,
        [],
        '',
        new Map(),
        // the below method is a mock of the ws library
        new ws.WebSocket('ws://localhost:8080'),
        new Map(),
        new Map(),
      )

      expect(saveValidation).toHaveBeenCalledWith(validation)
    }
  })
})
