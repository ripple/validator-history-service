/* eslint-disable n/no-process-env -- the setting under test */
import net from 'net'

import verifyValidatorDomain from '../../src/connection-manager/domain-verification'

import signedValidator from './signed-manifest'

// No nock in this file: nock replaces the connection, so it would hide
// whether the request went through the proxy.
describe('verifyValidatorDomain proxy', () => {
  const savedProxy = process.env.HTTPS_PROXY
  let proxy: net.Server
  let proxyConnections: number

  beforeAll(async () => {
    proxy = net.createServer((socket) => {
      proxyConnections += 1
      socket.destroy()
    })
    await new Promise<void>((resolve) => {
      proxy.listen(0, '127.0.0.1', resolve)
    })
  })

  beforeEach(() => {
    proxyConnections = 0
    const { port } = proxy.address() as net.AddressInfo
    process.env.HTTPS_PROXY = `http://127.0.0.1:${port}`
  })

  afterEach(() => {
    if (savedProxy === undefined) {
      delete process.env.HTTPS_PROXY
    } else {
      process.env.HTTPS_PROXY = savedProxy
    }
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      proxy.close(() => resolve())
    })
  })

  // A proxy resolves the domain itself, so guardedLookup would only check the
  // proxy's address and never the domain's.
  it('does not send the request through a proxy from the environment', async () => {
    const { manifest } = await signedValidator('localhost')

    await expect(verifyValidatorDomain(manifest)).rejects.toMatchObject({
      code: 'EBLOCKEDADDRESS',
    })
    expect(proxyConnections).toBe(0)
  })
})
