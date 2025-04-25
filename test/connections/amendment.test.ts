import { LedgerResponseExpanded } from 'xrpl/dist/npm/models/methods/ledger'

import { handleWsMessageLedgerEnableAmendments } from '../../src/connection-manager/wsHandling'
import {
  destroy,
  query,
  setupTables,
  saveAmendmentsStatus,
} from '../../src/shared/database'
import { AmendmentStatus } from '../../src/shared/types'

import amendmentsLedgerEntry from './fixtures/amendments_ledger_entry.json'
import ledgerResponseNoFlag from './fixtures/ledgerWithNoFlag.json'
import ledgerResponseGotMajority from './fixtures/ledgerWithTfMajority.json'

const flushPromises = async (): Promise<void> =>
  new Promise((resolve) => {
    setImmediate(resolve)
  })

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

  test('Correctly finds EnableAmendment tx with tfGotMajority Flag (eta available) from ledger response', async () => {
    await handleWsMessageLedgerEnableAmendments(
      ledgerResponseGotMajority as LedgerResponseExpanded,
      'main',
    )

    await flushPromises()

    const amendmentStatus = (await query('amendments_status').select(
      '*',
    )) as AmendmentStatus[]

    await flushPromises()

    expect(amendmentStatus[0].amendment_id).toBe(
      '56B241D7A43D40354D02A9DC4C8DF5C7A1F930D92A9035C4E12291B3CA3E1C2B',
    )
    expect(amendmentStatus[0].networks).toBe('main')
    expect(amendmentStatus[0].eta!.toISOString()).toBe(
      '2024-02-08T14:32:01.000Z',
    )
  })

  test('Correctly finds EnableAmendment tx with No Flag (amendment has been enabled) from ledger response', async () => {
    await handleWsMessageLedgerEnableAmendments(
      ledgerResponseNoFlag as LedgerResponseExpanded,
      'main',
    )

    await flushPromises()

    const amendmentStatus = (await query('amendments_status').select(
      '*',
    )) as AmendmentStatus[]

    expect(amendmentStatus[0].amendment_id).toBe(
      'AE35ABDEFBDE520372B31C957020B34A7A4A9DC3115A69803A44016477C84D6E',
    )
    expect(amendmentStatus[0].networks).toBe('main')
    expect(amendmentStatus[0].ledger_index).toBe(84206081)
    expect(amendmentStatus[0].tx_hash).toBe(
      'CA4562711E4679FE9317DD767871E90A404C7A8B84FAFD35EC2CF0231F1F6DAF',
    )
    expect(amendmentStatus[0].date!.toISOString()).toBe(
      '2023-11-27T14:44:30.000Z',
    )
    expect(amendmentStatus[0].eta).toBe(null)
  })

  test('save Amendments ledger_entry', async () => {
    await saveAmendmentsStatus(
      amendmentsLedgerEntry.result.node.Amendments,
      'main',
    )

    await flushPromises()

    const amendments = (await query('amendments_status').select(
      '*',
    )) as AmendmentStatus[]

    await flushPromises()

    expect(amendments[0].networks).toBe('main')
    expect(amendments.map((amendment) => amendment.amendment_id)).toContain(
      '42426C4D4F1009EE67080A9B7965B44656D7714D104A72F9B4369F97ABF044EE',
    )
    expect(amendments[0].date).toBe(null)
    expect(amendments.length).toBe(73)
  })
})
