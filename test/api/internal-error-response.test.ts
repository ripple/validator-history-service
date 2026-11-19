// A failed API call must not echo the underlying error back to the caller.
// Database errors can carry SQL fragments and the database address; those
// belong in the logs only.
import { Request, Response } from 'express'

const SECRET_DETAIL =
  'select * from "validators" - connect ECONNREFUSED 10.0.0.5:5432'

const fail = (): never => {
  throw new Error(SECRET_DETAIL)
}

jest.mock('../../src/shared/database', () => ({
  query: fail,
  db: fail,
  getNetworks: fail,
}))

jest.mock('../../src/shared/utils/logger', () => (): object => ({
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
}))

/* eslint-disable import/first -- must be imported after the mocks above */
import {
  handleAmendmentsInfo,
  handleAmendmentInfo,
  handleAmendmentsVote,
  handleAmendmentVote,
} from '../../src/api/routes/v1/amendments'
import handleDailyScores from '../../src/api/routes/v1/daily-report'
import handleHealth, {
  handleMonitoringMetrics,
} from '../../src/api/routes/v1/health'
import handleValidatorManifest from '../../src/api/routes/v1/manifests'
import handleNetworks from '../../src/api/routes/v1/networks'
import {
  handleNode,
  handleNodes,
  handleTopology,
} from '../../src/api/routes/v1/nodes'
import {
  handleValidator,
  handleValidators,
} from '../../src/api/routes/v1/validator'
import handleValidatorReport from '../../src/api/routes/v1/validator-report'
/* eslint-enable import/first */

const handlers: Array<
  [string, (req: Request, res: Response) => Promise<void>]
> = [
  ['handleAmendmentsInfo', handleAmendmentsInfo],
  ['handleAmendmentInfo', handleAmendmentInfo],
  ['handleAmendmentsVote', handleAmendmentsVote],
  ['handleAmendmentVote', handleAmendmentVote],
  ['handleDailyScores', handleDailyScores],
  ['handleHealth', handleHealth],
  ['handleMonitoringMetrics', handleMonitoringMetrics],
  ['handleValidatorManifest', handleValidatorManifest],
  ['handleNetworks', handleNetworks],
  ['handleNode', handleNode],
  ['handleNodes', handleNodes],
  ['handleTopology', handleTopology],
  ['handleValidator', handleValidator],
  ['handleValidators', handleValidators],
  ['handleValidatorReport', handleValidatorReport],
]

describe('API 500 replies hide internal error details', () => {
  test.each(handlers)('%s', async (_name, handler) => {
    const req = {
      params: {
        param: 'x',
        network: 'main',
        identifier: 'x',
        publicKey: 'nHUFakeKey',
      },
      query: {},
    } as unknown as Request

    // Handlers that cache DB results swallow the DB error and carry on, so
    // also fail any non-500 reply. Every handler then lands in its catch.
    const send = jest.fn()
    const status = jest.fn()
    const res = { set: jest.fn(), send, status } as unknown as Response
    status.mockImplementation((code: number) => {
      if (code !== 500) {
        fail()
      }
      return res
    })

    await handler(req, res)

    expect(status).toHaveBeenLastCalledWith(500)
    expect(send).toHaveBeenLastCalledWith({
      result: 'error',
      message: 'internal error',
    })
    expect(JSON.stringify(send.mock.calls)).not.toContain('10.0.0.5')
  })
})
