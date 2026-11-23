import nock from 'nock'

import verifyValidatorDomain from '../../src/connection-manager/domain-verification'

import signedValidator from './signed-manifest'

const TOML_PATH = '/.well-known/xrp-ledger.toml'

// The checked request has to go through a real DNS lookup for the check to be
// exercised, so nock only fakes the first response of a redirect.
describe('verifyValidatorDomain DNS check', () => {
  afterEach(() => {
    nock.cleanAll()
  })

  it('does not connect to a domain that resolves to a blocked address', async () => {
    // `localhost` resolves to 127.0.0.1, so it stands in for any domain that
    // resolves to a blocked address.
    const { manifest } = await signedValidator('localhost')

    await expect(verifyValidatorDomain(manifest)).rejects.toMatchObject({
      code: 'EBLOCKEDADDRESS',
    })
  })

  it('does not connect to a redirect target that resolves to a blocked address', async () => {
    const { manifest } = await signedValidator('validator.example')
    nock('https://validator.example')
      .get(TOML_PATH)
      .reply(302, '', { Location: `https://localhost${TOML_PATH}` })

    await expect(verifyValidatorDomain(manifest)).rejects.toMatchObject({
      code: 'EBLOCKEDADDRESS',
    })
  })
})
