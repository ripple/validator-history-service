import WebSocket from 'ws'

import { handleWsMessageLedgerEnableAmendments } from '../../src/connection-manager/wsHandling'
import { destroy, query, setupTables } from '../../src/shared/database'
import { LedgerResponseCorrected } from '../../src/shared/types'

import ledgerResponse from './fixtures/ledger.json'

const flushPromises = () => new Promise(setImmediate)

const WS_TIMEOUT = 10000

describe('Amendments', () => {
  beforeAll(async () => {
    await setupTables()
  })

  afterAll(async () => {
    await destroy()
  })

  beforeEach(async () => {
    await query('amendments_status').delete('*')
  })

  afterEach(async () => {
    await query('amendments_status').delete('*')
  })

  test('Correctly finds EnableAmendment tx from ledger response', async () => {
    const ws = new WebSocket('wss://xrplcluster.com', {
      handshakeTimeout: WS_TIMEOUT,
    })
    await handleWsMessageLedgerEnableAmendments(
      ws,
      ledgerResponse as LedgerResponseCorrected,
      'main',
    )

    await flushPromises()

    const amendmentStatus = await query('amendments_status').select('*')

    expect(amendmentStatus[0].amendment_id).toBe(
      '56B241D7A43D40354D02A9DC4C8DF5C7A1F930D92A9035C4E12291B3CA3E1C2B',
    )
    expect(amendmentStatus[0].networks).toBe('main')
    expect(amendmentStatus[0].eta.toISOString()).toBe(
      '2024-02-08T14:32:01.000Z',
    )
    console.log(amendmentStatus)
  })
})
