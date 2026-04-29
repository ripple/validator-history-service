import nock from 'nock'

import Crawler from '../../src/crawler/crawl'
import { destroy, query, setupTables } from '../../src/shared/database'
import { Node } from '../../src/shared/types'

import network2 from './fixtures/cyclic-network.json'
import nullNodeNetwork from './fixtures/null-ip-three-node-crawl.json'
import network1 from './fixtures/three-node-crawl.json'

async function crawl(ip: string): Promise<void> {
  await new Crawler().crawl({
    id: 'main',
    entry: ip,
    unls: ['vl.fake.example.com'],
  })
}

describe('Runs test crawl', () => {
  beforeAll(async () => {
    nock.disableNetConnect()
    await setupTables()
  })

  afterAll(async () => {
    nock.cleanAll()
    nock.enableNetConnect()
    await destroy()
  })

  beforeEach(async () => {
    await query('connection_health').delete('*')
    await query('crawls').delete('*')
  })

  afterEach(() => {
    if (!nock.isDone()) {
      const pending = nock.pendingMocks()
      nock.cleanAll()
      throw new Error(
        `Pending nock mocks at end of test: ${pending.join(', ')}`,
      )
    }
  })

  test('successfully crawls 3 node network', async () => {
    // Sets up mocking at endpoints specified in network1
    Object.keys(network1.peers).forEach((peer: string) => {
      nock(`https://${peer}:51235`)
        .get('/crawl')
        .reply(
          200,
          (network1.peers as Record<string, Record<string, unknown>>)[peer],
        )
    })
    await crawl('1.1.1.1')

    const results: Node[] = await query('crawls').select([
      'ip',
      'port',
      'public_key',
    ])

    expect(results).toContainEqual(network1.result[0])
    expect(results).toContainEqual(network1.result[1])
    expect(results).toContainEqual(network1.result[2])
  })

  test('successfully updates an existing ip and port to null', async () => {
    // Phase 1: standard 3 node network
    Object.keys(network1.peers).forEach((peer: string) => {
      nock(`https://${peer}:51235`)
        .get('/crawl')
        .reply(
          200,
          (network1.peers as Record<string, Record<string, unknown>>)[peer],
        )
    })
    await crawl('1.1.1.1')

    const initResults: Node[] = await query('crawls').select([
      'ip',
      'port',
      'public_key',
    ])

    expect(initResults).toContainEqual(network1.result[0])
    expect(initResults).toContainEqual(network1.result[1])
    expect(initResults).toContainEqual(network1.result[2])

    // Phase 2: re-mock the peers the crawler will dial. The entry
    // (1.1.1.1) is always hit; 1.1.1.23 is hit because it's reported
    // in the entry response with a real ip/port. 1.1.1.13 is unreachable
    // in this network topology/starting-node config and is skipped by the
    // crawler, so no mock for it.
    nock.cleanAll()
    ;['1.1.1.1', '1.1.1.23'].forEach((peer) => {
      nock(`https://${peer}:51235`)
        .get('/crawl')
        .reply(
          200,
          (nullNodeNetwork.peers as Record<string, Record<string, unknown>>)[
            peer
          ],
        )
    })
    await crawl('1.1.1.1')

    const modifiedResults: Node[] = await query('crawls').select([
      'ip',
      'port',
      'public_key',
    ])

    expect(modifiedResults).toContainEqual(nullNodeNetwork.result[0])
    expect(modifiedResults).toContainEqual(nullNodeNetwork.result[1])
    expect(modifiedResults).toContainEqual(nullNodeNetwork.result[2])
  })

  test('successfully crawls cyclic node network', async () => {
    // Sets up mocking at endpoints specified in network2. The graph is
    // cyclic (2.2.2.2 -> 2.2.2.23 -> 3.3.3.3 -> 2.2.2.2), so the crawler
    // may dial each peer more than once before the cycle is detected.
    // Use .persist() so each mock can satisfy repeat hits.
    Object.keys(network2.peers).forEach((peer: string) => {
      nock(`https://${peer}:51235`)
        .persist()
        .get('/crawl')
        .reply(
          200,
          (network2.peers as Record<string, Record<string, unknown>>)[peer],
        )
    })
    await crawl('2.2.2.2')

    const results: Node[] = await query('crawls').select([
      'ip',
      'port',
      'public_key',
    ])

    expect(results).toContainEqual(network2.result[0])
    expect(results).toContainEqual(network2.result[1])
    expect(results).toContainEqual(network2.result[2])

    // Persisted mocks above never auto-clear; reset them so the
    // afterEach pendingMocks guard sees a clean slate.
    nock.cleanAll()
  })

  test('handles rejection', async () => {
    nock(`https://2.2.2.23:51235`)
      .get('/crawl')
      .reply(200, network2.peers['2.2.2.23'])

    nock(`https://2.2.2.2:51235`)
      .get('/crawl')
      .reply(200, network2.peers['2.2.2.2'])

    nock(`https://3.3.3.3:51235`).get('/crawl').reply(403)

    await crawl('2.2.2.2')

    const results: Node[] = await query('crawls').select([
      'ip',
      'port',
      'public_key',
    ])

    expect(results).toContainEqual({
      ip: '3.3.3.3',
      port: 51235,
      public_key: 'n9LgkNWaPfRnxLKAgnSCMHRCyHBZsSdGBdRmyaYEArL3SBoq1EqK',
    })

    expect(results).toContainEqual({
      ip: null,
      port: null,
      public_key: 'n9Mh83gUuY4hBXVD9geWHsyVwz5h32rjauLWQCZJVTEbCb5TYs21',
    })

    expect(results).toContainEqual({
      ip: '2.2.2.23',
      port: 51235,
      public_key: 'n9Kt2gdtxsYV6h4SAfHkRFUMU8gB6rDQ3MktiB3MMEDS9s9obu9b',
    })
  })
})
