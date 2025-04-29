import {
  query,
  destroy,
  setupTables,
  tearDown,
  getNodes,
} from '../../src/shared/database'
import { saveConnectionHealth } from '../../src/shared/database/connectionHealth'
import { ConnectionHealth, Node } from '../../src/shared/types'

import data from './fixtures/connection_health.json'

const flushPromises = async (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 50)
  })

describe('connection_health tests', () => {
  beforeAll(async () => {
    await tearDown()
    await setupTables()
  })

  afterAll(async () => {
    await tearDown()
    await destroy()
  })

  beforeEach(async () => {
    await query('connection_health').delete('*')
    await query('crawls').delete('*')
  })

  test('update existing connection_health row', async () => {
    const initialData: ConnectionHealth = {
      ...data.initial,
      status_update_time: new Date(data.initial.status_update_time),
    }

    const updatedData: ConnectionHealth = {
      ...data.updated,
      status_update_time: new Date(data.initial.status_update_time),
    }

    await saveConnectionHealth(initialData)
    await flushPromises()
    const result = (await query('connection_health')
      .select('*')
      .where({ network: 'xahau-main' })) as ConnectionHealth[]

    await flushPromises()
    expect(result[0].ws_url).toBe(initialData.ws_url)

    await saveConnectionHealth(updatedData)
    await flushPromises()
    const updatedResult = (await query('connection_health')
      .select('*')
      .where({ network: 'xahau-main' })) as ConnectionHealth[]

    await flushPromises()
    expect(updatedResult[0].connected).toBe(updatedData.connected)
    expect(updatedResult.length).toBe(1)
  })

  test('crawls and empty connection_health left join test', async () => {
    const crawlsData: Node[] = data.crawls_only as Node[]

    crawlsData.forEach(async (row) => {
      await query('crawls').insert({
        ...row,
        networks: 'main',
        start: new Date(Date.now() - 5 * 60 * 1000),
      })
    })

    await flushPromises()

    const tenMinutesAgo = new Date()
    tenMinutesAgo.setMinutes(tenMinutesAgo.getMinutes() - 10)

    const nodes = await getNodes(tenMinutesAgo)
    await flushPromises()
    expect(nodes.length).toBe(1)
    expect(nodes[0].ws_url).toBe(null)
  })

  test('crawls and connection_health left join test', async () => {
    const crawlsData: Node[] = data.crawls_and_connections_test.crawls as Node[]

    const connectionHealthData: ConnectionHealth = {
      ...data.crawls_and_connections_test.connection_health,
      status_update_time: new Date(),
    } as ConnectionHealth

    crawlsData.forEach(async (row) => {
      await query('crawls').insert({
        ...row,
        networks: 'main',
        start: new Date(Date.now() - 5 * 60 * 1000),
      })
    })

    await flushPromises()

    await saveConnectionHealth(connectionHealthData)

    await flushPromises()

    const tenMinutesAgo = new Date()
    tenMinutesAgo.setMinutes(tenMinutesAgo.getMinutes() - 10)

    const nodes = await getNodes(tenMinutesAgo)
    await flushPromises()
    expect(nodes.length).toBe(2)

    const node1 = nodes.find((node) => node.public_key === 'key-1')
    const node2 = nodes.find((node) => node.public_key === 'key-2')
    expect(node1?.ws_url).toBe(connectionHealthData.ws_url)
    expect(node2?.ws_url).toBe(null)
  })
})
