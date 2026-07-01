import nock from 'nock'

import { destroy, query, setupTables } from '../../src/shared/database'
import {
  clearAmendmentCaches,
  fetchAmendmentInfo,
} from '../../src/shared/database/amendments'
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

// A minimal features.macro used to drive the retired/obsolete classification.
// Escrow and fix1201 are retired; SomeObsoleteFeature is obsolete. The other
// active entries are amendments referenced by the tests so they are recognized
// as registered (any amendment absent from this file is treated as obsolete).
const FEATURES_MACRO = `
// Add new amendments to the top of this list.
XRPL_FEATURE(ExpandedSignerList,     Supported::Yes, VoteBehavior::DefaultNo)
XRPL_FEATURE(NFTokenMintOffer,       Supported::Yes, VoteBehavior::DefaultNo)
XRPL_FEATURE(NewVotingAmendment,     Supported::Yes, VoteBehavior::DefaultNo)
XRPL_FEATURE(SomeObsoleteFeature,    Supported::Yes, VoteBehavior::Obsolete)

XRPL_RETIRE_FIX(1201)
XRPL_RETIRE_FEATURE(Escrow)
`

/**
 * Intercept the GitHub latest-release lookup used to detect the rippled tag.
 * Persisted so repeated fetches within a test work.
 *
 * @param tag - The tag to report as the latest release.
 */
function mockLatestReleaseTag(tag = '3.2.0'): void {
  nock('https://api.github.com')
    .get('/repos/XRPLF/rippled/releases/latest')
    .reply(200, { tag_name: tag })
    .persist()
}

/**
 * Intercept the features.macro fetch (any release tag) used by the amendment
 * classification. Persisted so repeated fetches within a test work.
 *
 * @param body - The features.macro contents to return.
 */
function mockFeaturesMacro(body: string = FEATURES_MACRO): void {
  nock('https://raw.githubusercontent.com')
    .get(/features\.macro$/u)
    .reply(200, body)
    .persist()
}

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
    clearAmendmentCaches()
    jest.clearAllMocks()
    nock.cleanAll()
    mockLatestReleaseTag()
    mockFeaturesMacro()
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
      const expandedSignerList = savedAmendments.find(
        (am) => am.name === 'ExpandedSignerList',
      )
      expect(expandedSignerList).toBeDefined()
      expect(expandedSignerList?.rippled_version).toBe('1.9.0')
      expect(expandedSignerList?.retired).toBe(false)
      expect(expandedSignerList?.obsolete).toBe(false)

      // Escrow is in the features.macro retired list, so it is flagged retired.
      const escrow = savedAmendments.find((am) => am.name === 'Escrow')
      expect(escrow).toBeDefined()
      expect(escrow?.retired).toBe(true)
      expect(escrow?.obsolete).toBe(false)
    })

    test('should mark amendments absent from features.macro as obsolete', async () => {
      // Mock XRPScan API
      nock('https://api.xrpscan.com')
        .get('/api/v1/amendments')
        .reply(200, featureResponses.xrpscanAmendments)

      // An amendment that is not registered in features.macro (e.g. superseded
      // and removed) should be classified obsolete, even if a node still reports
      // it as supported.
      const responseWithUnknown = {
        result: {
          features: {
            ...featureResponses.featureAllResponse.result.features,
            UNKNOWN123: {
              enabled: false,
              name: 'AmendmentNotInMacro',
              supported: true,
            },
          },
          status: 'success',
        },
      }
      mockRequest.mockResolvedValue(responseWithUnknown)

      await fetchAmendmentInfo()
      await flushPromises()

      const savedAmendments = (await query('amendments_info').select(
        '*',
      )) as AmendmentInfo[]

      const unknown = savedAmendments.find(
        (am) => am.name === 'AmendmentNotInMacro',
      )
      expect(unknown).toBeDefined()
      expect(unknown?.retired).toBe(false)
      expect(unknown?.obsolete).toBe(true)
    })

    test('should mark obsolete amendments from features.macro', async () => {
      // Mock XRPScan API
      nock('https://api.xrpscan.com')
        .get('/api/v1/amendments')
        .reply(200, featureResponses.xrpscanAmendments)

      // SomeObsoleteFeature is marked VoteBehavior::Obsolete in the macro.
      const responseWithObsolete = {
        result: {
          features: {
            ...featureResponses.featureAllResponse.result.features,
            OBSOLETE123: {
              enabled: false,
              name: 'SomeObsoleteFeature',
              supported: true,
            },
          },
          status: 'success',
        },
      }
      mockRequest.mockResolvedValue(responseWithObsolete)

      await fetchAmendmentInfo()
      await flushPromises()

      const savedAmendments = (await query('amendments_info').select(
        '*',
      )) as AmendmentInfo[]

      const obsolete = savedAmendments.find(
        (am) => am.name === 'SomeObsoleteFeature',
      )
      expect(obsolete).toBeDefined()
      expect(obsolete?.obsolete).toBe(true)
      expect(obsolete?.retired).toBe(false)
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
      expect(newAmendment?.retired).toBe(false)
      expect(newAmendment?.obsolete).toBe(false)
    })

    test('should mark a badFeature amendment absent from features.macro as obsolete', async () => {
      // Insert voting data with an amendment that will return badFeature
      await query('ballot').insert({
        signing_key: 'nHBtBkHGfL4NpB54H1AwBaaSJkSJLUSPvnUNAcuNpuffYB51VjH6',
        ledger_index: 12345,
        amendments: 'BADFEAT456',
      })

      // Pre-populate amendments_info so we have a name for the amendment
      await query('amendments_info').insert({
        id: 'BADFEAT456',
        name: 'UnknownAmendment',
        retired: false,
        obsolete: false,
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

      const unknown = savedAmendments.find(
        (am) => am.name === 'UnknownAmendment',
      )
      expect(unknown).toBeDefined()
      expect(unknown?.retired).toBe(false)
      // UnknownAmendment is not registered in features.macro, so it is obsolete.
      expect(unknown?.obsolete).toBe(true)
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

      // Sample an amendment and verify it has id, name, flags but no rippled_version
      const sampleAmendment = savedAmendments.find(
        (am) => am.name === 'ExpandedSignerList',
      )
      expect(sampleAmendment).toBeDefined()
      expect(sampleAmendment?.id).toBeDefined()
      expect(sampleAmendment?.name).toBe('ExpandedSignerList')
      expect(sampleAmendment?.retired).toBe(false)
      expect(sampleAmendment?.obsolete).toBe(false)
      // Database returns null for undefined values
      expect(sampleAmendment?.rippled_version).toBeNull()
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

    test('should skip the DB update when the latest release cannot be detected', async () => {
      // Simulate the GitHub releases API being unavailable. Without a tag we
      // cannot locate features.macro, so no amendment info should be written.
      nock.cleanAll()
      nock('https://api.github.com')
        .get('/repos/XRPLF/rippled/releases/latest')
        .reply(500)
        .persist()
      mockFeaturesMacro()
      nock('https://api.xrpscan.com')
        .get('/api/v1/amendments')
        .reply(200, featureResponses.xrpscanAmendments)
      mockRequest.mockResolvedValue(featureResponses.featureAllResponse)

      await fetchAmendmentInfo()
      await flushPromises()

      const saved = (await query('amendments_info').select(
        '*',
      )) as AmendmentInfo[]
      expect(saved).toHaveLength(0)
      expect(mockRequest).not.toHaveBeenCalled()
    })

    test('should skip the DB update when features.macro path is invalid', async () => {
      // Simulate the features.macro path no longer being valid (e.g. a rippled
      // restructure). No amendment info should be written at all.
      nock.cleanAll()
      mockLatestReleaseTag()
      nock('https://raw.githubusercontent.com')
        .get(/features\.macro$/u)
        .reply(404)
        .persist()
      nock('https://api.xrpscan.com')
        .get('/api/v1/amendments')
        .reply(200, featureResponses.xrpscanAmendments)
      mockRequest.mockResolvedValue(featureResponses.featureAllResponse)

      await fetchAmendmentInfo()
      await flushPromises()

      const saved = (await query('amendments_info').select(
        '*',
      )) as AmendmentInfo[]
      expect(saved).toHaveLength(0)
      // We bail out before ever querying the feature RPC.
      expect(mockRequest).not.toHaveBeenCalled()
    })

    test('should skip the DB update when features.macro format is unrecognized', async () => {
      // The file is reachable but no longer contains recognizable macros, so the
      // classification parses to nothing - treat it as unknown and skip.
      nock.cleanAll()
      mockLatestReleaseTag()
      mockFeaturesMacro('// restructured file\nSOMETHING_ELSE(Foo)\n')
      nock('https://api.xrpscan.com')
        .get('/api/v1/amendments')
        .reply(200, featureResponses.xrpscanAmendments)
      mockRequest.mockResolvedValue(featureResponses.featureAllResponse)

      await fetchAmendmentInfo()
      await flushPromises()

      const saved = (await query('amendments_info').select(
        '*',
      )) as AmendmentInfo[]
      expect(saved).toHaveLength(0)
      expect(mockRequest).not.toHaveBeenCalled()
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
      expect(networks.length).toEqual(3)
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
