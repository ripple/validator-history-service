import { Request, Response } from 'express'

import { handleWebSocketHealthMetrics } from '../../src/api/routes/v1/health'
import {
  destroy,
  query,
  saveConnectionHealth,
  setupTables,
} from '../../src/shared/database'
import { ConnectionHealth } from '../../src/shared/types'

import connectionHealthData from './fixtures/connection_health.json'

const flushPromises = async (): Promise<void> =>
  new Promise((resolve) => {
    setImmediate(resolve)
  })

describe('connections health', () => {
  beforeAll(async () => {
    await setupTables()
    await query('connection_health').delete('*')
  })

  afterAll(async () => {
    await destroy()
  })

  test('prometheus metrics response format', async () => {
    const data: ConnectionHealth[] = connectionHealthData.data.map((item) => ({
      ws_url: item.ws_url,
      network: item.network,
      connected: item.connected,
      status_update_time: new Date(item.status_update_time),
    }))

    data.forEach(async (row) => {
      await saveConnectionHealth(row)
    })

    await flushPromises()

    const req = {
      params: { network: 'main' },
    } as unknown as Request
    const resp = {
      send: jest.fn(),
      set: jest.fn(),
      status: jest.fn(),
    } as unknown as Response

    await handleWebSocketHealthMetrics(req, resp)

    const expectedResult = `connected_nodes{network="main"} 2`
    expect(resp.send).toHaveBeenCalledWith(expectedResult)
  })
})
