import { Request, Response } from 'express'

import handleNetworks from '../../src/api/routes/v1/networks'
import { setupTables, destroy, query } from '../../src/shared/database'
import networks from '../../src/shared/database/networks'

describe('networks endpoint', () => {
  beforeAll(async () => {
    await query('networks').delete('*')
    await setupTables()
  })

  afterAll(async () => {
    await destroy()
  })

  test('should respond with success and returns all networks', async () => {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- Disable for mock request.
    const req = {} as Request
    const sendMock = jest.fn()
    const statusMock = {
      send: sendMock,
    } as unknown as Response

    await handleNetworks(req, statusMock)

    const expectedResult = {
      result: 'success',
      count: networks.length,
      networks: networks,
    }

    expect(statusMock.send).toHaveBeenCalledWith(
      expect.objectContaining(expectedResult),
    )
  })
})
