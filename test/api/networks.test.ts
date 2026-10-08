import { Request, Response } from 'express'

import handleNetworks from '../../src/api/routes/v1/networks'
import { db, setupTables, destroy, query } from '../../src/shared/database'
import networks from '../../src/shared/database/networks'

describe('networks endpoint', () => {
  beforeAll(async () => {
    // Only wipe if the table is already there: this suite may run before any
    // suite that creates it. setupTables then reseeds the default networks.
    if (await db().schema.hasTable('networks')) {
      await query('networks').delete('*')
    }
    await setupTables()
  })

  afterAll(async () => {
    await destroy()
  })

  test('should respond with success and returns all networks', async () => {
    const req = {} as Request
    const res = {
      send: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as Response

    await handleNetworks(req, res)

    const expectedResult = {
      result: 'success',
      count: networks.length,
      networks,
    }

    expect(res.send).toHaveBeenCalledWith(expectedResult)
  })
})
