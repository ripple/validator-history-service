import net from 'net'

import WebSocket from 'ws'

import { handleWsMessageSubscribeTypes } from '../../src/connection-manager/wsHandling'
import { StreamLedger } from '../../src/shared/types'

// A flag ledger + 1 makes the connection manager open a second connection,
// to the url of the socket that reported it, to fetch EnableAmendment
// transactions. That connection resolves the name again, so it must use the
// guarded lookup too. No mocks: the check only runs on a real DNS lookup.
describe('EnableAmendment fetch DNS check', () => {
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

  it.each(['ws', 'wss'])(
    'does not connect over %s to a name that resolves to a blocked address',
    async (scheme) => {
      const ledger = {
        type: 'ledgerClosed',
        ledger_index: 257,
        ledger_hash: 'A'.repeat(64),
      } as unknown as StreamLedger
      // `localhost` resolves to 127.0.0.1, so it stands in for any name that
      // resolves to a blocked address.
      const ws = { url: `${scheme}://localhost:${port}` } as WebSocket

      await handleWsMessageSubscribeTypes(
        ledger,
        [],
        `test-${scheme}`,
        new Map(),
        ws,
        new Map(),
        new Map(),
      )
      // The fetch is fire-and-forget; give it time to reach the server.
      await new Promise((resolve) => {
        setTimeout(resolve, 1000)
      })

      expect(connections).toBe(0)
    },
  )
})
