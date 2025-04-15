import { Request, Response } from 'express'

import { handleValidators } from '../../src/api/routes/v1/validator'
import { destroy, query, setupTables } from '../../src/shared/database'

import expectedValidatorsResult from './fixtures/expected_validators_result.json'
import initialBallotSet from './fixtures/initial_ballot_table.json'
import initialValidatorsSet from './fixtures/initial_validators_db.json'

describe('tests for validators endpoint', () => {
  beforeAll(async () => {
    await query('validators').delete('*')
    await query('ballot').delete('*')
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

    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- Disable for mock request.
    const req = {
      params: {},
    } as Request
    const res = {
      send: jest.fn(),
    } as unknown as Response

    await handleValidators(req, res)

    const expectedResult = {
      result: 'success',
      count: expectedValidatorsResult.count,
      validators: expectedValidatorsResult.validators,
    }

    expect(res.send).toHaveBeenCalledWith(expectedResult)
  })
})
