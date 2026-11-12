import net from 'net'

import crawlNode from '../../src/crawler/network'

// No nock in this file: the request has to go through a real DNS lookup and
// TCP connect for the check to be exercised.
describe('crawlNode DNS check', () => {
  let server: net.Server
  let port: number
  let connections: number

  beforeAll(async () => {
    server = net.createServer((socket) => {
      connections += 1
      socket.destroy()
    })
    await new Promise<void>((resolve) => {
      // No host: listen on both IPv4 and IPv6, whichever `localhost` resolves to.
      server.listen(0, resolve)
    })
    port = (server.address() as net.AddressInfo).port
  })

  beforeEach(() => {
    connections = 0
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
    })
  })

  it('does not connect to a name that resolves to a blocked address', async () => {
    // `localhost` resolves to 127.0.0.1, so it stands in for any name that
    // resolves to a blocked address.
    const crawl = await crawlNode('localhost', port)

    expect(crawl).toBeUndefined()
    expect(connections).toBe(0)
  })
})
