import nock from 'nock'

import { fetchValidatorList } from '../../src/shared/utils'

// A peer's crawl response sets the network's validator list url, so it can
// point VHS at the metadata service on port 80 with any path.
describe('fetchValidatorList', () => {
  beforeAll(() => {
    nock.disableNetConnect()
  })

  afterEach(() => {
    nock.cleanAll()
  })

  afterAll(() => {
    nock.enableNetConnect()
  })

  it('does not request a blocked host', async () => {
    const metadata = nock('http://169.254.169.254')
      .get('/latest/meta-data/')
      .reply(200, {})

    await expect(
      fetchValidatorList('169.254.169.254/latest/meta-data/'),
    ).rejects.toBeUndefined()
    expect(metadata.isDone()).toBe(false)
  })

  it('does not follow a redirect to a blocked host', async () => {
    nock('http://vl.example.com')
      .get('/')
      .reply(302, '', { Location: 'http://169.254.169.254/latest/meta-data/' })
    const metadata = nock('http://169.254.169.254')
      .get('/latest/meta-data/')
      .reply(200, {})

    await expect(fetchValidatorList('vl.example.com')).rejects.toBeUndefined()
    expect(metadata.isDone()).toBe(false)
  })
})
