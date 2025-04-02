import nock from 'nock'

import Crawler from '../../src/crawler/crawl'
import { destroy, query, setupTables } from '../../src/shared/database'
import { Node } from '../../src/shared/types'

import network2 from './fixtures/cyclic-network.json'
import nullNodeNetwork from './fixtures/null-ip-three-node-crawl.json'
import network1 from './fixtures/three-node-crawl.json'

function mock(): void {
  // Sets up mocking at endpoints specified in network1
  Object.keys(network1.peers).forEach((peer: string) => {
    nock(`https://${peer}:51235`)
      .get('/crawl')
      .reply(
        200,
        (network1.peers as Record<string, Record<string, unknown>>)[peer],
      )
  })

  // Sets up mocking at endpoints specified in network2
  Object.keys(network2.peers).forEach((peer: string) => {
    nock(`https://${peer}:51235`)
      .get('/crawl')
      .reply(
        200,
        (network2.peers as Record<string, Record<string, unknown>>)[peer],
      )
  })
}

async function crawl(ip: string): Promise<void> {
  await new Crawler().crawl({
    id: 'main',
    entry: ip,
    unls: ['vl.fake.example.com'],
  })
}

describe('Runs test crawl', () => {
  beforeAll(async () => {
    await setupTables()
    mock()
  })

  afterAll(async () => {
    await destroy()
  })

  beforeEach(async () => {
    await query('crawls').delete('*')
  })

  test('successfully crawls 3 node network', async () => {
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

  test('successfully updates ip and port to null', async () => {
    // Manually set endpoints to standard 3 node network
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

    // Ensure DB has registered standard nodes with IP addresses
    expect(initResults).toContainEqual(network1.result[0])
    expect(initResults).toContainEqual(network1.result[1])
    expect(initResults).toContainEqual(network1.result[2])

    // Manually set same node endpoints to new network with a null ip/port
    Object.keys(nullNodeNetwork.peers).forEach((peer: string) => {
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

    // Ensure DB has registered new nodes with a null ip/port
    expect(modifiedResults).toContainEqual(nullNodeNetwork.result[0])
    expect(modifiedResults).toContainEqual(nullNodeNetwork.result[1])
    expect(modifiedResults).toContainEqual(nullNodeNetwork.result[2])
  })

  test('successfully crawls cyclic node network', async () => {
    await crawl('2.2.2.2')

    const results: Node[] = await query('crawls').select([
      'ip',
      'port',
      'public_key',
    ])

    expect(results).toContainEqual(network2.result[0])
    expect(results).toContainEqual(network2.result[1])
    expect(results).toContainEqual(network2.result[2])
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
