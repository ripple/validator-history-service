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
    const req = {} as Request
    const sendMock = jest.fn()
    const statusMock = {
      send: sendMock,
    } as unknown as Response

    await handleNetworks(req, statusMock)

    expect(statusMock.send).toHaveBeenCalledWith(
      expect.objectContaining({
        result: 'success',
        count: networks.length,
        networks: expect.arrayContaining([
          expect.objectContaining({
            id: 'main',
            entry: 'p2p.livenet.ripple.com',
            port: 51235,
            unls: expect.any(Array),
          }),
        ]),
      }),
    )
  })
})
