import nock from 'nock'

import {
  handleManifest,
  updateUNLManifests,
  updateUnls,
} from '../../src/connection-manager/manifests'
import {
  destroy,
  query,
  setupTables,
  tearDown,
} from '../../src/shared/database'
import networks from '../../src/shared/database/networks'

import unl1 from './fixtures/unl-response1.json'
import unl2 from './fixtures/unl-response2.json'

const VALIDATOR_URL = networks[0].unls[0]

describe('manifest ingest', () => {
  beforeAll(async () => {
    await tearDown()
    await setupTables()
  })

  afterAll(async () => {
    await tearDown()
    await destroy()
  })

  beforeEach(async () => {
    await query('manifests').delete('*')
    await query('validators').delete('*')
  })

  afterEach(async () => {
    nock.cleanAll()
    await query('manifests').delete('*')
    await query('validators').delete('*')
  })

  test('handleManifest', async () => {
    const manifest = {
      master_key: 'nHDaeKJcfRzzmx3gGKnrFTQazYi95tdGrdoiCYLinoU9EkJsp4Ho',
      master_signature:
        '7CA31C480E2ED7DBD1C2A0CA950545C73C7EB9838D5A5C5D16D61DFDB47EBC23DAF2BD25B9AA4FE5B8E39D30C575501BC7EE4042E068D935D6D97391B3B46706',
      seq: 1,
      signature:
        '30440220711EC38538E10E01198086D85D4728E81993ADD0746E6D3CEF2E12DC3C3A3A92022046F698FD1B1B3222498049D6006E95EC1422C4E0CB2BFD0D210A4709BAF17A08',
      signing_key: 'n9KhXam7XB436XHhzo3aTzEW5NxkKwVDkuy9DwdDC1ja8j8mv3ot',
    }

    await handleManifest(manifest)

    const saved_manifest = await query('manifests').select('*').where({
      master_signature:
        '7CA31C480E2ED7DBD1C2A0CA950545C73C7EB9838D5A5C5D16D61DFDB47EBC23DAF2BD25B9AA4FE5B8E39D30C575501BC7EE4042E068D935D6D97391B3B46706',
    })
    expect(saved_manifest[0]).toEqual({
      master_key: 'nHDaeKJcfRzzmx3gGKnrFTQazYi95tdGrdoiCYLinoU9EkJsp4Ho',
      master_signature:
        '7CA31C480E2ED7DBD1C2A0CA950545C73C7EB9838D5A5C5D16D61DFDB47EBC23DAF2BD25B9AA4FE5B8E39D30C575501BC7EE4042E068D935D6D97391B3B46706',
      revoked: false,
      seq: '1',
      signature:
        '30440220711EC38538E10E01198086D85D4728E81993ADD0746E6D3CEF2E12DC3C3A3A92022046F698FD1B1B3222498049D6006E95EC1422C4E0CB2BFD0D210A4709BAF17A08',
      signing_key: 'n9KhXam7XB436XHhzo3aTzEW5NxkKwVDkuy9DwdDC1ja8j8mv3ot',
      domain: null,
      domain_verified: false,
    })
  })

  test('updateUnlManifests', async () => {
    nock(`http://${VALIDATOR_URL}`).get('/').reply(200, unl1)
    await updateUNLManifests()
    const saved_manifest = await query('manifests').select('*')

    expect(saved_manifest[0]).toEqual({
      master_key: 'nHBtDzdRDykxiuv7uSMPTcGexNm879RUUz5GW4h1qgjbtyvWZ1LE',
      signing_key: 'n9LCf7NtwcyXVc5fYB6UVByRoQZqJDhrMUoKnr3GQB6mFqpcmMzg',
      master_signature:
        'BF0EE69D3CDE683828A2FCB997CC694A9D833B89D06B5AD65C9458F72D4CF0B1635DF95F02BE9C901D16C21414D27D30F8E7A429928D857355AE8CE7F9C07002',
      signature:
        '3045022100B9558D709F8B2FE6B57056B0DB7BEEDE2329C344069455F33BFE4A953994287402205AF2FA3CC71A6F89895FE33746FA74210763A07E441964F3073ADEC2697CD781',
      revoked: false,
      domain: null,
      domain_verified: false,
      seq: '1',
    })
  })

  test('updates unls', async () => {
    // Mock validator list contains a single validator
    nock(`http://${VALIDATOR_URL}`).get('/').reply(200, unl1)
    await query('validators').insert({
      master_key: 'nHBtDzdRDykxiuv7uSMPTcGexNm879RUUz5GW4h1qgjbtyvWZ1LE',
      signing_key: 'n9LCf7NtwcyXVc5fYB6UVByRoQZqJDhrMUoKnr3GQB6mFqpcmMzg',
    })
    await query('manifests').insert({
      master_key: 'nHBtDzdRDykxiuv7uSMPTcGexNm879RUUz5GW4h1qgjbtyvWZ1LE',
      signing_key: 'n9LCf7NtwcyXVc5fYB6UVByRoQZqJDhrMUoKnr3GQB6mFqpcmMzg',
    })
    await updateUnls()
    let validator = await query('validators')
      .select('master_key', 'signing_key', 'unl')
      .where(
        'master_key',
        '=',
        'nHBtDzdRDykxiuv7uSMPTcGexNm879RUUz5GW4h1qgjbtyvWZ1LE',
      )
    expect(validator[0]).toEqual({
      master_key: 'nHBtDzdRDykxiuv7uSMPTcGexNm879RUUz5GW4h1qgjbtyvWZ1LE',
      signing_key: 'n9LCf7NtwcyXVc5fYB6UVByRoQZqJDhrMUoKnr3GQB6mFqpcmMzg',
      unl: 'vl.ripple.com',
    })

    // New unl replaces old validator with a new one
    nock(`http://${VALIDATOR_URL}`).get('/').reply(200, unl2)
    await updateUnls()
    validator = await query('validators')
      .select('master_key', 'signing_key', 'unl')
      .where(
        'master_key',
        '=',
        'nHBtDzdRDykxiuv7uSMPTcGexNm879RUUz5GW4h1qgjbtyvWZ1LE',
      )
    expect(validator[0]).toEqual({
      master_key: 'nHBtDzdRDykxiuv7uSMPTcGexNm879RUUz5GW4h1qgjbtyvWZ1LE',
      signing_key: 'n9LCf7NtwcyXVc5fYB6UVByRoQZqJDhrMUoKnr3GQB6mFqpcmMzg',
      unl: null,
    })
  })
})
