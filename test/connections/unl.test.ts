import { unixTimeToRippleTime } from 'raj-xrpl'

import { getActiveBlobV2, parseBlob } from '../../src/shared/utils'

import unlV2 from './fixtures/unlV2.json'

const DATE_NOW_UNIX_TEST = 1739472965911
describe('UNL v2', () => {
  test('Correctly parse unlV2', () => {
    Date.now = (): number => DATE_NOW_UNIX_TEST
    const nowRippleTime = unixTimeToRippleTime(Date.now())
    const currentBlob = parseBlob(unlV2.blobs_v2[0].blob)
    const futureBlob = parseBlob(unlV2.blobs_v2[1].blob)
    const expiredBlob = parseBlob(unlV2.blobs_v2[2].blob)
    const outdatedBlob = parseBlob(unlV2.blobs_v2[3].blob)
    // Effective date is later than current time
    expect(futureBlob.effective).toBeGreaterThan(nowRippleTime)
    // Expiration date is in the past
    expect(expiredBlob.expiration).toBeLessThan(nowRippleTime)
    // Valid effective and expiration dates
    expect(currentBlob.effective).toBeLessThan(nowRippleTime)
    expect(currentBlob.expiration).toBeGreaterThan(nowRippleTime)
    // Valid effective and expiration dates, but effective date is not latest
    expect(outdatedBlob.effective).toBeLessThan(currentBlob.effective ?? 0)

    const activeBlob = getActiveBlobV2(unlV2)
    // correct blob are selected.
    expect(activeBlob.effective).toEqual(currentBlob.effective)
    expect(activeBlob.expiration).toEqual(currentBlob.expiration)
    expect(activeBlob.validators.length).toEqual(currentBlob.validators.length)
  })
})
