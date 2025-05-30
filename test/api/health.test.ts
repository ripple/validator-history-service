import { Request, Response } from 'express'

import { handleMonitoringMetrics } from '../../src/api/routes/v1/health'
import { destroy, query, setupTables } from '../../src/shared/database'
import { saveConnectionHealth } from '../../src/shared/database/connectionHealth'
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

    const req = {} as Request
    const resp = {
      send: jest.fn(),
      set: jest.fn(),
      status: jest.fn(),
    } as unknown as Response

    await handleMonitoringMetrics(req, resp)

    await flushPromises()

    const expectedLines = [
      'connected_nodes{network="amm-dev"} 0',
      'connected_nodes{network="dev"} 0',
      'connected_nodes{network="main"} 2',
      'connected_nodes{network="test"} 0',
      'connected_nodes{network="xahau-main"} 1',
      'connected_nodes{network="xahau-test"} 0',
    ]

    expect(resp.send).toHaveBeenCalledWith(expectedLines.join('\n'))
  })
})
