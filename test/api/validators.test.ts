import { Request, Response } from 'express'

import { CACHE_INTERVAL_MILLIS } from '../../src/api/routes/v1/utils'
import { handleValidators } from '../../src/api/routes/v1/validator'
import { db, destroy, query, setupTables } from '../../src/shared/database'

import expectedValidatorsResult from './fixtures/expected_validators_result.json'
import initialBallotSet from './fixtures/initial_ballot_table.json'
import initialValidatorsSet from './fixtures/initial_validators_db.json'

describe('tests for validators endpoint', () => {
  beforeAll(async () => {
    // This suite may run before any suite that creates the tables.
    if (await db().schema.hasTable('validators')) {
      await query('validators').delete('*')
      await query('ballot').delete('*')
    }
    await setupTables()
  })

  afterAll(async () => {
    await destroy()
  })

  test('This setup should return entries present in the ballot table and validators table', async () => {
    // Note: Amendments have been removed from the input/expected-output to reduce the scope of the test
    // the validators API endpoint returns entries with identical signing_key in the `ballot` and `validators` table
    await query('validators').insert(initialValidatorsSet)
    await query('ballot').insert(initialBallotSet)

    const req = {
      params: {},
    } as Request
    const res = {
      send: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as Response

    await handleValidators(req, res)

    const expectedResult = {
      result: 'success',
      count: expectedValidatorsResult.count,
      validators: expectedValidatorsResult.validators,
    }

    expect(res.send).toHaveBeenCalledWith(expectedResult)
  })

  test('excludes validators with no network assigned', async () => {
    // Fabricated validations arriving on dev never get a network, a chain or a
    // manifest; the list endpoint must not surface them.
    await query('validators').insert({
      signing_key: 'n9431BemLDaB4Tk13jKuxnU2PfThMPXrdD5dxRCEFeyWYFyDJ8WQ',
      master_key: null,
      networks: null,
      chain: null,
      revoked: false,
      current_index: 1000000,
      ledger_hash:
        '24F8BA5BFF1C09C445FE9FCFD2BE164BBB577AF352194E9847B330EB11CBEA1F',
      last_ledger_time: new Date(),
    })

    interface ValidatorsBody {
      count: number
      validators: Array<{ signing_key: string }>
    }
    const req = { params: {} } as Request
    const send = jest.fn<undefined, [ValidatorsBody]>()
    const res = {
      send,
      status: jest.fn().mockReturnThis(),
    } as unknown as Response

    // handleValidators serves a 60s in-memory cache, already primed by the test
    // above. Advance the clock past the interval so this request re-queries.
    const realNow = Date.now.bind(Date)
    const nowSpy = jest
      .spyOn(Date, 'now')
      .mockImplementation(() => realNow() + 10 * CACHE_INTERVAL_MILLIS)
    try {
      await handleValidators(req, res)
    } finally {
      nowSpy.mockRestore()
    }

    const body = send.mock.calls[0][0]
    const keys = body.validators.map((validator) => validator.signing_key)

    expect(keys).not.toContain(
      'n9431BemLDaB4Tk13jKuxnU2PfThMPXrdD5dxRCEFeyWYFyDJ8WQ',
    )
    expect(body.count).toBe(expectedValidatorsResult.count)
  })
})
