import {
  query,
  setupTables,
  tearDown,
  getNodes,
  destroy,
} from '../../src/shared/database'
import {
  getTotalConnectedNodes,
  isNodeConnectedByIp,
  isNodeConnectedByPublicKey,
  isNodeConnectedByWsUrl,
  saveConnectionHealth,
  updateConnectionHealthStatus,
} from '../../src/shared/database/connectionHealth'
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
    await flushPromises()
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
      status_update_time: new Date(data.updated.status_update_time),
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

  test('findByPublicKey test', async () => {
    const crawlsData: Node[] = data.crawls_only as Node[]

    crawlsData.forEach(async (row) => {
      await query('crawls').insert({
        ...row,
        networks: 'main',
        start: new Date(Date.now() - 5 * 60 * 1000),
      })
    })

    const connectionHealthData = data.connection_health_find_by_public_key as {
      connection_health_rows: ConnectionHealth[]
    }

    connectionHealthData.connection_health_rows.forEach(async (row) => {
      await saveConnectionHealth({ ...row, status_update_time: new Date() })
    })

    await flushPromises()

    const result = await isNodeConnectedByPublicKey('key-2')
    await flushPromises()
    expect(result).toBe(true)
  })

  test('findByIp and findByWsUrl test', async () => {
    const crawlsData: Node[] = data.crawls_only as Node[]

    crawlsData.forEach(async (row) => {
      await query('crawls').insert({
        ...row,
        networks: 'main',
        start: new Date(Date.now() - 5 * 60 * 1000),
      })
    })

    const connectionHealthData = data.connection_health_find_by_ip as {
      connection_health_rows: ConnectionHealth[]
    }

    connectionHealthData.connection_health_rows.forEach(async (row) => {
      await saveConnectionHealth({ ...row, status_update_time: new Date() })
    })

    await flushPromises()

    const result = await isNodeConnectedByIp('p2p.livenet.ripple.com')
    await flushPromises()
    expect(result).toBe(true)

    const falseResult = await isNodeConnectedByIp('test.com')
    await flushPromises()
    expect(falseResult).toBe(false)

    const findByWsURL = await isNodeConnectedByWsUrl(
      'wss://p2p.livenet.ripple.com:51233/',
    )
    await flushPromises()
    expect(findByWsURL).toBe(true)
  })

  test('updateConnectionHealthStatus test', async () => {
    const crawlsData: Node[] = data.crawls_only as Node[]

    crawlsData.forEach(async (row) => {
      await query('crawls').insert({
        ...row,
        networks: 'main',
        start: new Date(Date.now() - 5 * 60 * 1000),
      })
    })

    const connectionHealthData = data.connection_health_find_by_ip as {
      connection_health_rows: ConnectionHealth[]
    }

    connectionHealthData.connection_health_rows.forEach(async (row) => {
      await saveConnectionHealth({ ...row, status_update_time: new Date() })
    })

    await flushPromises()

    const beforeResult = await getTotalConnectedNodes()
    await flushPromises()
    expect(beforeResult).toBe(2)

    await updateConnectionHealthStatus(
      'wss://p2p.livenet.ripple.com:51233/',
      false,
    )
    await flushPromises()

    const result = await getTotalConnectedNodes()
    await flushPromises()
    expect(result).toBe(1)

    await updateConnectionHealthStatus(
      'ws://p2p.livenet.ripple.com:51234/',
      false,
    )
    await flushPromises()

    const zeroResult = await getTotalConnectedNodes()
    await flushPromises()
    expect(zeroResult).toBe(0)
  })
})
