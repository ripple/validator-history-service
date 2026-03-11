import nock from 'nock'

import { destroy, query, setupTables } from '../../src/shared/database'
import { fetchAmendmentInfo } from '../../src/shared/database/amendments'
import { AmendmentInfo, AmendmentStatus } from '../../src/shared/types'

import featureResponses from './fixtures/feature_responses.json'

// Mock xrpl Client and utilities
const mockRequest = jest.fn()
const mockConnect = jest.fn().mockResolvedValue(undefined)
const mockDisconnect = jest.fn().mockResolvedValue(undefined)

jest.mock('xrpl', () => ({
  Client: jest.fn().mockImplementation(() => ({
    connect: mockConnect,
    disconnect: mockDisconnect,
    request: mockRequest,
  })),
  // Mock rippleTimeToUnixTime used by update-amendments-from-json.ts
  rippleTimeToUnixTime: jest.fn((rippleTime: number) => {
    // Ripple epoch starts on 2000-01-01T00:00:00Z (946684800 seconds after Unix epoch)
    const RIPPLE_EPOCH = 946684800
    return (rippleTime + RIPPLE_EPOCH) * 1000
  }),
}))

const flushPromises = async (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 100)
  })

describe('Amendments Fetch Functions', () => {
  beforeAll(async () => {
    await setupTables()
  })

  afterAll(async () => {
    await destroy()
  })

  beforeEach(async () => {
    await query('amendments_info').delete('*')
    await query('amendments_status').delete('*')
    await query('ballot').delete('*')
    jest.clearAllMocks()
    nock.cleanAll()
  })

  afterEach(async () => {
    await query('amendments_info').delete('*')
    await query('amendments_status').delete('*')
    await query('ballot').delete('*')
    nock.cleanAll()
  })

  describe('fetchAmendmentInfo', () => {
    test('should fetch amendments from all networks and save to database', async () => {
      // Mock XRPScan API for rippled versions
      nock('https://api.xrpscan.com')
        .get('/api/v1/amendments')
        .reply(200, featureResponses.xrpscanAmendments)

      // Mock xrpl Client feature RPC responses for all networks
      mockRequest.mockResolvedValue(featureResponses.featureAllResponse)

      await fetchAmendmentInfo()
      await flushPromises()

      // Verify amendments were saved to amendments_info
      const savedAmendments = (await query('amendments_info').select(
        '*',
      )) as AmendmentInfo[]

      expect(savedAmendments.length).toBeGreaterThan(0)

      // Check that ExpandedSignerList was saved (it's supported but not enabled)
      // Note: Escrow is in RETIRED_AMENDMENTS list so it gets marked as deprecated
      const expandedSignerList = savedAmendments.find(
        (am) => am.name === 'ExpandedSignerList',
      )
      expect(expandedSignerList).toBeDefined()
      expect(expandedSignerList?.rippled_version).toBe('1.9.0')
      expect(expandedSignerList?.deprecated).toBe(false)
    })

    test('should mark unsupported amendments as deprecated', async () => {
      // Mock XRPScan API
      nock('https://api.xrpscan.com')
        .get('/api/v1/amendments')
        .reply(200, featureResponses.xrpscanAmendments)

      // Return response with an unsupported amendment
      const responseWithUnsupported = {
        result: {
          features: {
            ...featureResponses.featureAllResponse.result.features,
            DEPRECATED123: {
              enabled: false,
              name: 'DeprecatedAmendment',
              supported: false,
            },
          },
          status: 'success',
        },
      }
      mockRequest.mockResolvedValue(responseWithUnsupported)

      await fetchAmendmentInfo()
      await flushPromises()

      const savedAmendments = (await query('amendments_info').select(
        '*',
      )) as AmendmentInfo[]

      const deprecated = savedAmendments.find(
        (am) => am.name === 'DeprecatedAmendment',
      )
      expect(deprecated).toBeDefined()
      expect(deprecated?.deprecated).toBe(true)
    })

    test('should track supported non-enabled amendments in amendments_status', async () => {
      // Mock XRPScan API
      nock('https://api.xrpscan.com')
        .get('/api/v1/amendments')
        .reply(200, featureResponses.xrpscanAmendments)

      mockRequest.mockResolvedValue(featureResponses.featureAllResponse)

      await fetchAmendmentInfo()
      await flushPromises()

      // Check amendments_status for supported but not enabled amendments
      const statusRecords = (await query('amendments_status').select(
        '*',
      )) as AmendmentStatus[]

      // ExpandedSignerList and NFTokenMintOffer are supported but not enabled
      const expandedSignerList = statusRecords.find(
        (st) =>
          st.amendment_id ===
          '532651B4FD58DF8922A49BA101AB3E996E5BFBF95A913B3E392504863E63B164',
      )
      expect(expandedSignerList).toBeDefined()
    })

    test('should fetch voting amendments from ballot table', async () => {
      // Insert some voting data in ballot table first
      await query('ballot').insert({
        signing_key: 'nHBtBkHGfL4NpB54H1AwBaaSJkSJLUSPvnUNAcuNpuffYB51VjH6',
        ledger_index: 12345,
        amendments:
          'NEWAMEND123,532651B4FD58DF8922A49BA101AB3E996E5BFBF95A913B3E392504863E63B164',
      })

      // Mock XRPScan API
      nock('https://api.xrpscan.com')
        .get('/api/v1/amendments')
        .reply(200, featureResponses.xrpscanAmendments)

      // Mock feature all response
      mockRequest.mockImplementation(
        async (params: { command: string; feature?: string }) => {
          if (params.command === 'feature' && params.feature) {
            // Single feature request for voting amendments
            if (params.feature === 'NEWAMEND123') {
              return Promise.resolve({
                result: {
                  NEWAMEND123: {
                    enabled: false,
                    name: 'NewVotingAmendment',
                    supported: true,
                  },
                },
              })
            }
            // Return feature one response for known amendments
            return Promise.resolve(featureResponses.featureOneResponse)
          }
          // Feature all response
          return Promise.resolve(featureResponses.featureAllResponse)
        },
      )

      await fetchAmendmentInfo()
      await flushPromises()

      const savedAmendments = (await query('amendments_info').select(
        '*',
      )) as AmendmentInfo[]

      // The voting amendment should be fetched and saved
      const newAmendment = savedAmendments.find(
        (am) => am.name === 'NewVotingAmendment',
      )
      expect(newAmendment).toBeDefined()
      expect(newAmendment?.deprecated).toBe(false)
    })

    test('should handle badFeature error and mark as deprecated', async () => {
      // Insert voting data with an amendment that will return badFeature
      await query('ballot').insert({
        signing_key: 'nHBtBkHGfL4NpB54H1AwBaaSJkSJLUSPvnUNAcuNpuffYB51VjH6',
        ledger_index: 12345,
        amendments: 'BADFEAT456',
      })

      // Pre-populate amendments_info so we have a name for the deprecated amendment
      await query('amendments_info').insert({
        id: 'BADFEAT456',
        name: 'ObsoleteAmendment',
        deprecated: false,
      })

      // Mock XRPScan API
      nock('https://api.xrpscan.com')
        .get('/api/v1/amendments')
        .reply(200, featureResponses.xrpscanAmendments)

      // Mock feature requests
      mockRequest.mockImplementation(
        async (params: { command: string; feature?: string }) => {
          if (params.command === 'feature' && params.feature === 'BADFEAT456') {
            // Simulate badFeature error (xrpl.js throws exception)
            return Promise.reject(new Error('badFeature'))
          }
          return Promise.resolve(featureResponses.featureAllResponse)
        },
      )

      await fetchAmendmentInfo()
      await flushPromises()

      const savedAmendments = (await query('amendments_info').select(
        '*',
      )) as AmendmentInfo[]

      const obsolete = savedAmendments.find(
        (am) => am.name === 'ObsoleteAmendment',
      )
      expect(obsolete).toBeDefined()
      expect(obsolete?.deprecated).toBe(true)
    })

    test('should handle XRPScan API failure gracefully', async () => {
      // Mock XRPScan API to fail
      nock('https://api.xrpscan.com')
        .get('/api/v1/amendments')
        .reply(500, { error: 'Internal Server Error' })

      mockRequest.mockResolvedValue(featureResponses.featureAllResponse)

      // Should not throw
      await expect(fetchAmendmentInfo()).resolves.not.toThrow()
      await flushPromises()

      // Amendments should still be saved (just without rippled versions)
      const savedAmendments = (await query('amendments_info').select(
        '*',
      )) as AmendmentInfo[]
      expect(savedAmendments.length).toBeGreaterThan(0)
    })

    test('should handle network connection failure gracefully', async () => {
      // Mock XRPScan API
      nock('https://api.xrpscan.com')
        .get('/api/v1/amendments')
        .reply(200, featureResponses.xrpscanAmendments)

      // Mock xrpl Client to fail on connect for first network
      mockConnect.mockRejectedValueOnce(new Error('Connection failed'))
      // Succeed for other networks
      mockConnect.mockResolvedValue(undefined)

      mockRequest.mockResolvedValue(featureResponses.featureAllResponse)

      // Should not throw even if one network fails
      await expect(fetchAmendmentInfo()).resolves.not.toThrow()
    })
  })

  describe('fetchNetworkAmendments behavior', () => {
    test('should insert supported amendments to amendments_status per network', async () => {
      // Mock XRPScan API
      nock('https://api.xrpscan.com')
        .get('/api/v1/amendments')
        .reply(200, featureResponses.xrpscanAmendments)

      mockRequest.mockResolvedValue(featureResponses.featureAllResponse)

      await fetchAmendmentInfo()
      await flushPromises()

      const statusRecords = (await query('amendments_status').select(
        '*',
      )) as AmendmentStatus[]

      // Should have records for each network (main, test, dev)
      // Each supported but not enabled amendment should have a record per network
      const networks = Array.from(
        new Set(statusRecords.map((st) => st.networks)),
      )
      expect(networks.length).toBeGreaterThanOrEqual(1)
    })

    test('should not overwrite existing eta/date in amendments_status', async () => {
      // Pre-insert an amendment_status with ETA
      const existingEta = new Date('2024-06-01')
      await query('amendments_status').insert({
        amendment_id:
          '532651B4FD58DF8922A49BA101AB3E996E5BFBF95A913B3E392504863E63B164',
        networks: 'main',
        eta: existingEta,
        date: null,
      })

      // Mock XRPScan API
      nock('https://api.xrpscan.com')
        .get('/api/v1/amendments')
        .reply(200, featureResponses.xrpscanAmendments)

      mockRequest.mockResolvedValue(featureResponses.featureAllResponse)

      await fetchAmendmentInfo()
      await flushPromises()

      const record = (await query('amendments_status')
        .select('*')
        .where(
          'amendment_id',
          '532651B4FD58DF8922A49BA101AB3E996E5BFBF95A913B3E392504863E63B164',
        )
        .andWhere('networks', 'main')
        .first()) as AmendmentStatus

      // ETA should be preserved, not overwritten
      expect(record.eta?.toISOString()).toBe('2024-06-01T00:00:00.000Z')
    })
  })
})
