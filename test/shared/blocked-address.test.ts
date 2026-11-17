// Hosts reach VHS through peers' crawl responses and rows saved from them, so
// none of them can be trusted. These checks decide which addresses VHS will
// connect to: anything a real XRPL node cannot have is refused, including
// alternate spellings of those addresses and names that resolve to them,
// while private ranges stay allowed for custom networks.

import net from 'net'

import WebSocket from 'ws'

import {
  guardedLookup,
  isAllowedHost,
  isAllowedWsUrl,
  isBlockedIp,
} from '../../src/shared/utils/blocked-address'

describe('isBlockedIp', () => {
  it.each([
    '0.0.0.0',
    '0.0.0.13',
    '127.0.0.1',
    '127.1.2.3',
    '169.254.169.254',
    '169.254.170.2',
    '169.254.0.1',
    '::',
    '::1',
    'fe80::1',
    'fd00:ec2::254',
    'fd00:ec2::253',
    'fd00:ec2::23',
    '::127.0.0.1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:169.254.169.254',
  ])('blocks %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(true)
  })

  // Private ranges stay allowed: custom.xrpl.org users monitor private
  // networks over tunnels.
  it.each([
    '8.8.8.8',
    '10.0.0.1',
    '172.16.0.1',
    '192.168.1.1',
    '2001:4860:4860::8888',
    'fd00::1',
    '::ffff:8.8.8.8',
  ])('allows %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(false)
  })
})

describe('isAllowedHost', () => {
  it.each([
    's1.ripple.com',
    'xahau.network',
    'S.Altnet.RippleTest.net',
    '8.8.8.8',
    '10.0.0.1',
    '2001:4860:4860::8888',
  ])('allows %s', (host) => {
    expect(isAllowedHost(host)).toBe(true)
  })

  it.each([
    // blocked addresses
    '127.0.0.1',
    '169.254.169.254',
    '::ffff:127.0.0.1',
    // integer, hex and octal forms that resolvers and URL parsers turn into
    // an IPv4 address
    '2130706433',
    '0x7f000001',
    '0x7f.1',
    '017700000001',
    '010.0.0.1',
    '127.1',
    // not a bare host
    '',
    'a b',
    'host:51235',
    'user@host',
    'host/path',
    'http://host',
    's1.ripple.com.',
  ])('rejects %p', (host) => {
    expect(isAllowedHost(host)).toBe(false)
  })
})

describe('guardedLookup', () => {
  async function lookup(
    hostname: string,
    all: boolean,
  ): Promise<{ error: NodeJS.ErrnoException | null; address: unknown }> {
    return new Promise((resolve) => {
      guardedLookup(hostname, { all }, (error, address) => {
        resolve({ error, address })
      })
    })
  }

  it.each([false, true])(
    'fails a name that resolves to a blocked address (all: %p)',
    async (all) => {
      // `localhost` resolves to 127.0.0.1 or ::1, so it stands in for any
      // name that resolves to a blocked address.
      const { error } = await lookup('localhost', all)

      expect(error?.code).toBe('EBLOCKEDADDRESS')
    },
  )

  it('passes an allowed address through', async () => {
    const { error, address } = await lookup('8.8.8.8', false)

    expect(error).toBeNull()
    expect(address).toBe('8.8.8.8')
  })

  it('stops a WebSocket from connecting to a name that resolves to a blocked address', async () => {
    let connections = 0
    const server = net.createServer((socket) => {
      connections += 1
      socket.destroy()
    })
    await new Promise<void>((resolve) => {
      // No host: listen on both IPv4 and IPv6, whichever `localhost` resolves to.
      server.listen(0, resolve)
    })
    const { port } = server.address() as net.AddressInfo

    const ws = new WebSocket(`ws://localhost:${port}`, {
      lookup: guardedLookup,
      handshakeTimeout: 2000,
    })
    const error = await new Promise<Error>((resolve) => {
      ws.on('error', resolve)
    })
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
    })

    expect((error as NodeJS.ErrnoException).code).toBe('EBLOCKEDADDRESS')
    expect(connections).toBe(0)
  })
})

describe('isAllowedWsUrl', () => {
  // Saved urls predate the host check, and an IP literal skips guardedLookup.
  it.each([
    'ws://169.254.169.254:6006',
    'wss://127.0.0.1:51233',
    'ws://0.0.0.0:6005',
    'ws://[::1]:6006',
    'ws://2130706433:6006',
    'not a url',
  ])('rejects %s', (url) => {
    expect(isAllowedWsUrl(url)).toBe(false)
  })

  it.each([
    'wss://s1.ripple.com:51233',
    'ws://10.0.0.5:6006',
    'ws://8.8.8.8:6005',
  ])('allows %s', (url) => {
    expect(isAllowedWsUrl(url)).toBe(true)
  })
})
