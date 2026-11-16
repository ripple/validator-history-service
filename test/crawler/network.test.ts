// The crawler connects to whatever host a peer advertises. It must skip hosts
// on the block list before making a request, and must not follow a redirect,
// which would let a peer send it to a different host and port.

import nock from 'nock'

import crawlNode from '../../src/crawler/network'

const crawlBody = {
  overlay: { active: [] },
  server: { pubkey_node: 'n9KqGpQxS2Fk8ZbWm7wE3vT6yJ1rH4cU5dN8aL2sP0oI9eR' },
}

describe('crawlNode', () => {
  beforeAll(() => {
    nock.disableNetConnect()
  })

  afterEach(() => {
    nock.cleanAll()
  })

  afterAll(() => {
    nock.enableNetConnect()
  })

  it('crawls an allowed host', async () => {
    nock('https://1.1.1.1:51235').get('/crawl').reply(200, crawlBody)

    const crawl = await crawlNode('1.1.1.1', 51235)

    expect(crawl?.this_node.public_key).toBe(crawlBody.server.pubkey_node)
  })

  it.each(['169.254.169.254', '127.0.0.1', '0.0.0.13'])(
    'does not crawl the blocked address %s',
    async (host) => {
      const scope = nock(`https://${host}:51235`)
        .get('/crawl')
        .reply(200, crawlBody)

      const crawl = await crawlNode(host, 51235)

      expect(crawl).toBeUndefined()
      expect(scope.isDone()).toBe(false)
    },
  )

  // The port comes from the peer's crawl response and goes into the url, so
  // anything but a plain port number could change the host the request goes
  // to (`51235@169.254.169.254` makes the real host the url's username).
  it.each(['51235@169.254.169.254', '51235/x', 'abc', '', 0, 65536, 1.5, -1])(
    'does not crawl with the invalid port %p',
    async (port) => {
      const scope = nock(/.*/u).get(/.*/u).reply(200, crawlBody)

      const crawl = await crawlNode('1.1.1.1', port as unknown as number)

      expect(crawl).toBeUndefined()
      expect(scope.isDone()).toBe(false)
    },
  )

  it('crawls with a port sent as a numeric string', async () => {
    nock('https://1.1.1.1:51235').get('/crawl').reply(200, crawlBody)

    const crawl = await crawlNode('1.1.1.1', '51235' as unknown as number)

    expect(crawl?.this_node.public_key).toBe(crawlBody.server.pubkey_node)
  })

  it('does not follow a redirect', async () => {
    nock('https://1.1.1.1:51235')
      .get('/crawl')
      .reply(302, '', { Location: 'https://2.2.2.2:51235/crawl' })
    const target = nock('https://2.2.2.2:51235')
      .get('/crawl')
      .reply(200, crawlBody)

    const crawl = await crawlNode('1.1.1.1', 51235)

    expect(crawl).toBeUndefined()
    expect(target.isDone()).toBe(false)
  })
})
