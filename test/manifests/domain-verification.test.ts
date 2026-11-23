// A validator's manifest names a domain, and VHS fetches that domain's
// xrp-ledger.toml to verify it. Anyone can run a validator and name any
// domain, so the fetch must skip blocked hosts, treat a redirect as if the
// manifest had named its host, and stop on a deadline and a size cap.

import { Readable } from 'stream'
import { promisify } from 'util'
import { gzip } from 'zlib'

import nock from 'nock'

import verifyValidatorDomain from '../../src/connection-manager/domain-verification'

import ripple from './fixtures/ripple-validator.json'
import signedValidator from './signed-manifest'

const TOML_PATH = '/.well-known/xrp-ledger.toml'
const DOMAIN = 'validator.example'
// Short, so the deadline tests run quickly. The real deadline is 10 seconds.
const LIMITS = { deadlineMs: 300, maxBytes: 64 * 1024 }

describe('verifyValidatorDomain', () => {
  let streams: Readable[] = []

  beforeAll(() => {
    nock.disableNetConnect()
  })

  afterEach(() => {
    nock.cleanAll()
    streams.forEach((stream) => stream.destroy())
    streams = []
  })

  afterAll(() => {
    nock.enableNetConnect()
  })

  it('verifies a real validator', async () => {
    nock(`https://${ripple.manifest.domain}`)
      .get(TOML_PATH)
      .reply(200, ripple.toml)

    const result = await verifyValidatorDomain(ripple.manifest, LIMITS)

    expect(result.verified).toBe(true)
    expect(result.verified_manifest_signature).toBe(true)
  })

  it('verifies a generated validator', async () => {
    const { manifest, toml } = await signedValidator(DOMAIN)
    nock(`https://${DOMAIN}`).get(TOML_PATH).reply(200, toml)

    const result = await verifyValidatorDomain(manifest, LIMITS)

    expect(result.verified).toBe(true)
  })

  // nock blocks the network, so a fetch in these two tests would throw.
  it('does not fetch the toml when the manifest signature is invalid', async () => {
    const { manifest } = await signedValidator(DOMAIN)
    const other = await signedValidator(DOMAIN)

    const result = await verifyValidatorDomain(
      { ...manifest, master_signature: other.manifest.master_signature },
      LIMITS,
    )

    expect(result.verified).toBe(false)
    expect(result.verified_manifest_signature).toBe(false)
    expect(result.message).toBe('Cannot verify manifest signature')
  })

  it('treats a manifest whose keys cannot be decoded as an invalid signature', async () => {
    const { manifest } = await signedValidator(DOMAIN)

    const result = await verifyValidatorDomain(
      { ...manifest, master_key: 'nHnotAValidKey' },
      LIMITS,
    )

    expect(result.verified_manifest_signature).toBe(false)
    expect(result.message).toBe('Cannot verify manifest signature')
  })

  it('does not fetch a toml when the manifest has no domain', async () => {
    const { manifest } = await signedValidator(undefined)

    const result = await verifyValidatorDomain(manifest, LIMITS)

    expect(result.verified).toBe(false)
    expect(result.verified_manifest_signature).toBe(true)
    expect(result.message).toBe('Manifest does not contain a domain')
  })

  it('does not verify when the toml does not list the validator', async () => {
    const { manifest } = await signedValidator(DOMAIN)
    const other = await signedValidator(DOMAIN)
    nock(`https://${DOMAIN}`).get(TOML_PATH).reply(200, other.toml)

    const result = await verifyValidatorDomain(manifest, LIMITS)

    expect(result.verified).toBe(false)
    expect(result.verified_manifest_signature).toBe(true)
  })

  it('does not verify when the attestation is for another domain', async () => {
    const { manifest } = await signedValidator(DOMAIN)
    const elsewhere = await signedValidator('other.example')
    // Same public key, but the attestation was signed for other.example.
    const toml = elsewhere.toml.replace(
      elsewhere.manifest.master_key,
      manifest.master_key,
    )
    nock(`https://${DOMAIN}`).get(TOML_PATH).reply(200, toml)

    const result = await verifyValidatorDomain(manifest, LIMITS)

    expect(result.verified).toBe(false)
  })

  it.each(['169.254.169.254', '127.0.0.1', '0x7f.1'])(
    'does not fetch from the blocked host %s',
    async (domain) => {
      const { manifest, toml } = await signedValidator(domain)
      const scope = nock(/.*/u).get(/.*/u).reply(200, toml)

      await expect(verifyValidatorDomain(manifest, LIMITS)).rejects.toThrow()
      expect(scope.isDone()).toBe(false)
    },
  )

  // A manifest's domain is not a url, so anything beyond a host is refused.
  it.each([`${DOMAIN}@169.254.169.254`, `${DOMAIN}:8080`, `${DOMAIN}/x`])(
    'does not fetch from the domain %s',
    async (domain) => {
      const { manifest, toml } = await signedValidator(domain)
      const scope = nock(/.*/u).get(/.*/u).reply(200, toml)

      await expect(verifyValidatorDomain(manifest, LIMITS)).rejects.toThrow()
      expect(scope.isDone()).toBe(false)
    },
  )

  it('does not verify when the toml is not valid', async () => {
    const { manifest } = await signedValidator(DOMAIN)
    nock(`https://${DOMAIN}`).get(TOML_PATH).reply(200, '<html>not toml')

    await expect(verifyValidatorDomain(manifest, LIMITS)).rejects.toThrow()
  })

  it('does not verify when VALIDATORS is not a list', async () => {
    const { manifest } = await signedValidator(DOMAIN)
    nock(`https://${DOMAIN}`).get(TOML_PATH).reply(200, 'VALIDATORS = "x"\n')

    const result = await verifyValidatorDomain(manifest, LIMITS)

    expect(result).toMatchObject({
      verified: false,
      message: 'Invalid .toml file',
    })
  })

  it('does not verify when the attestation is missing', async () => {
    const { manifest } = await signedValidator(DOMAIN)
    nock(`https://${DOMAIN}`)
      .get(TOML_PATH)
      .reply(200, `[[VALIDATORS]]\npublic_key = "${manifest.master_key}"\n`)

    const result = await verifyValidatorDomain(manifest, LIMITS)

    expect(result.verified).toBe(false)
  })

  it('does not verify when an attestation is not a string', async () => {
    const { manifest } = await signedValidator(DOMAIN)
    nock(`https://${DOMAIN}`)
      .get(TOML_PATH)
      .reply(
        200,
        `[[VALIDATORS]]\npublic_key = "${manifest.master_key}"\nattestation = 123\n`,
      )

    const result = await verifyValidatorDomain(manifest, LIMITS)

    expect(result.verified).toBe(false)
    expect(result.message).toBe(`Invalid attestation, cannot verify ${DOMAIN}`)
  })

  it.each([404, 500])(
    'does not verify when the site returns %d',
    async (status) => {
      const { manifest, toml } = await signedValidator(DOMAIN)
      nock(`https://${DOMAIN}`).get(TOML_PATH).reply(status, toml)

      await expect(verifyValidatorDomain(manifest, LIMITS)).rejects.toThrow()
    },
  )

  // A redirect is treated as if the manifest had named the redirect's host:
  // only the host is used, and the request is built and checked the same way.
  it.each([`www.${DOMAIN}`, 'other.example'])(
    'follows a redirect to %s',
    async (host) => {
      const { manifest, toml } = await signedValidator(DOMAIN)
      nock(`https://${DOMAIN}`)
        .get(TOML_PATH)
        .reply(308, '', { Location: `https://${host}${TOML_PATH}` })
      nock(`https://${host}`).get(TOML_PATH).reply(200, toml)

      const result = await verifyValidatorDomain(manifest, LIMITS)

      expect(result.verified).toBe(true)
    },
  )

  it('uses only the host from a redirect', async () => {
    const { manifest, toml } = await signedValidator(DOMAIN)
    nock(`https://${DOMAIN}`)
      .get(TOML_PATH)
      .reply(302, '', { Location: `http://www.${DOMAIN}:8443/admin?x=1` })
    const standard = nock(`https://www.${DOMAIN}`)
      .get(TOML_PATH)
      .reply(200, toml)
    const asRedirected = [
      nock(`http://www.${DOMAIN}:8443`).get(/.*/u).reply(200, toml),
      nock(`https://www.${DOMAIN}:8443`).get(/.*/u).reply(200, toml),
    ]

    const result = await verifyValidatorDomain(manifest, LIMITS)

    expect(result.verified).toBe(true)
    expect(standard.isDone()).toBe(true)
    asRedirected.forEach((scope) => expect(scope.isDone()).toBe(false))
  })

  it.each([
    `https://169.254.169.254${TOML_PATH}`,
    `https://${DOMAIN}@169.254.169.254${TOML_PATH}`,
    `https://0x7f.1${TOML_PATH}`,
    `https://[::1]${TOML_PATH}`,
    `https://[fe80::1]${TOML_PATH}`,
  ])('does not follow a redirect to %s', async (location) => {
    const { manifest, toml } = await signedValidator(DOMAIN)
    nock(`https://${DOMAIN}`)
      .get(TOML_PATH)
      .reply(302, '', { Location: location })
    const target = nock(/.*/u).get(/.*/u).reply(200, toml)

    await expect(verifyValidatorDomain(manifest, LIMITS)).rejects.toThrow()
    expect(target.isDone()).toBe(false)
  })

  it.each([
    ['no Location header', {}],
    ['an unparseable Location', { Location: 'https://[' }],
  ])('does not verify after a redirect with %s', async (_name, headers) => {
    const { manifest } = await signedValidator(DOMAIN)
    nock(`https://${DOMAIN}`).get(TOML_PATH).reply(302, '', headers)

    await expect(verifyValidatorDomain(manifest, LIMITS)).rejects.toThrow()
  })

  it('follows only one redirect', async () => {
    const { manifest, toml } = await signedValidator(DOMAIN)
    nock(`https://${DOMAIN}`)
      .get(TOML_PATH)
      .reply(302, '', { Location: `https://one.example${TOML_PATH}` })
    nock('https://one.example')
      .get(TOML_PATH)
      .reply(302, '', { Location: `https://two.example${TOML_PATH}` })
    const secondTarget = nock('https://two.example')
      .get(TOML_PATH)
      .reply(200, toml)

    await expect(verifyValidatorDomain(manifest, LIMITS)).rejects.toThrow()
    expect(secondTarget.isDone()).toBe(false)
  })

  // Each response is well within the deadline, but the two together are not,
  // so only a deadline shared by the request and its redirect stops this.
  it('applies one deadline to a request and its redirect', async () => {
    const { manifest, toml } = await signedValidator(DOMAIN)
    const limits = { ...LIMITS, deadlineMs: 1000 }
    const responseDelay = 600
    nock(`https://${DOMAIN}`)
      .get(TOML_PATH)
      .delay(responseDelay)
      .reply(302, '', { Location: `https://www.${DOMAIN}${TOML_PATH}` })
    const redirected = nock(`https://www.${DOMAIN}`)
      .get(TOML_PATH)
      .delay(responseDelay)
      .reply(200, toml)

    await expect(verifyValidatorDomain(manifest, limits)).rejects.toMatchObject(
      { code: 'ERR_CANCELED' },
    )
    // The redirect was requested, so the deadline ran out during it.
    expect(redirected.isDone()).toBe(true)
  })

  it('stops a response larger than the size cap', async () => {
    const { manifest, toml } = await signedValidator(DOMAIN)
    const padding = `# ${'x'.repeat(1024)}\n`.repeat(100)
    nock(`https://${DOMAIN}`)
      .get(TOML_PATH)
      .reply(200, toml + padding)

    await expect(verifyValidatorDomain(manifest, LIMITS)).rejects.toThrow(
      /maxContentLength/u,
    )
  })

  it('counts the size cap after decompression', async () => {
    const { manifest, toml } = await signedValidator(DOMAIN)
    // ~100 KB of toml compresses to a few hundred bytes.
    const body = await promisify(gzip)(
      toml + `# ${'x'.repeat(1024)}\n`.repeat(100),
    )
    nock(`https://${DOMAIN}`)
      .get(TOML_PATH)
      .reply(200, body, { 'Content-Encoding': 'gzip' })

    await expect(verifyValidatorDomain(manifest, LIMITS)).rejects.toThrow(
      /maxContentLength/u,
    )
  })

  it('gives up on a server that does not respond by the deadline', async () => {
    const { manifest, toml } = await signedValidator(DOMAIN)
    const responseDelay = LIMITS.deadlineMs * 3
    nock(`https://${DOMAIN}`)
      .get(TOML_PATH)
      .delay(responseDelay)
      .reply(200, toml)

    const started = Date.now()
    await expect(verifyValidatorDomain(manifest, LIMITS)).rejects.toMatchObject(
      { code: 'ERR_CANCELED' },
    )
    expect(Date.now() - started).toBeLessThan(responseDelay)
  })

  // An idle timeout (axios `timeout`) never fires here, because a byte keeps
  // arriving. Only a deadline on the whole request stops it.
  it('gives up on a server that sends one byte at a time', async () => {
    const { manifest } = await signedValidator(DOMAIN)
    const drip = new Readable({
      read(): void {
        // Data is pushed by the timer below.
      },
    })
    streams.push(drip)
    const timer = setInterval(() => drip.push('#'), 50)
    drip.on('close', () => clearInterval(timer))
    nock(`https://${DOMAIN}`)
      .get(TOML_PATH)
      .reply(200, () => drip)

    await expect(verifyValidatorDomain(manifest, LIMITS)).rejects.toMatchObject(
      { code: 'ERR_CANCELED' },
    )
  })
})
