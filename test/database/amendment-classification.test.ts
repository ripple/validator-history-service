import amendmentInfoData from '../../src/shared/data/amendments_info.json'
import {
  manualClassification,
  parseFeaturesMacro,
} from '../../src/shared/database/amendment-classification'
import { AmendmentInfo } from '../../src/shared/types'

describe('parseFeaturesMacro', () => {
  test('classifies retired features and fixes (with fix prefix)', () => {
    const macro = `
XRPL_RETIRE_FEATURE(Escrow)
XRPL_RETIRE_FEATURE(PayChan)
XRPL_RETIRE_FIX(1201)
XRPL_RETIRE_FIX(TrustLinesToSelf)
`
    const { retired, obsolete } = parseFeaturesMacro(macro)

    expect(retired.has('Escrow')).toBe(true)
    expect(retired.has('PayChan')).toBe(true)
    expect(retired.has('fix1201')).toBe(true)
    expect(retired.has('fixTrustLinesToSelf')).toBe(true)
    expect(obsolete.size).toBe(0)
  })

  test('classifies obsolete features and fixes, not plain active ones', () => {
    const macro = `
XRPL_FEATURE(ActiveFeature,     Supported::Yes, VoteBehavior::DefaultNo)
XRPL_FEATURE(ObsoleteFeature,   Supported::Yes, VoteBehavior::Obsolete)
XRPL_FIX    (ObsoleteFix,       Supported::Yes, VoteBehavior::Obsolete)
`
    const { retired, obsolete } = parseFeaturesMacro(macro)

    expect(obsolete.has('ObsoleteFeature')).toBe(true)
    expect(obsolete.has('fixObsoleteFix')).toBe(true)
    expect(obsolete.has('ActiveFeature')).toBe(false)
    expect(retired.size).toBe(0)
  })

  test('collects Supported::No amendments as unsupported', () => {
    const macro = `
XRPL_FEATURE(SupportedFeature,   Supported::Yes, VoteBehavior::DefaultNo)
XRPL_FEATURE(PulledFeature,      Supported::No,  VoteBehavior::DefaultNo)
XRPL_FIX    (PulledFix,          Supported::No,  VoteBehavior::DefaultNo)
`
    const { unsupported } = parseFeaturesMacro(macro)

    expect(unsupported.has('PulledFeature')).toBe(true)
    expect(unsupported.has('fixPulledFix')).toBe(true)
    expect(unsupported.has('SupportedFeature')).toBe(false)
  })

  test('ignores comments and blank lines', () => {
    const macro = `
// XRPL_FEATURE(Example, Supported::yes, VoteBehavior::Obsolete)
// XRPL_RETIRE_FEATURE(Commented)

XRPL_RETIRE_FEATURE(Real)
`
    const { retired, obsolete } = parseFeaturesMacro(macro)

    expect(retired.has('Real')).toBe(true)
    expect(retired.has('Commented')).toBe(false)
    expect(obsolete.has('Example')).toBe(false)
  })

  test('collects every registered amendment name in `all`', () => {
    const macro = `
XRPL_FEATURE(ActiveFeature,     Supported::Yes, VoteBehavior::DefaultNo)
XRPL_FIX    (ActiveFix,         Supported::Yes, VoteBehavior::DefaultNo)
XRPL_FEATURE(ObsoleteFeature,   Supported::Yes, VoteBehavior::Obsolete)
XRPL_RETIRE_FEATURE(RetiredFeature)
XRPL_RETIRE_FIX(1201)
`
    const { all } = parseFeaturesMacro(macro)

    expect(all.has('ActiveFeature')).toBe(true)
    expect(all.has('fixActiveFix')).toBe(true)
    expect(all.has('ObsoleteFeature')).toBe(true)
    expect(all.has('RetiredFeature')).toBe(true)
    expect(all.has('fix1201')).toBe(true)
    // Amendments never mentioned in the file are absent from `all`, so callers
    // can treat them as obsolete/removed.
    expect(all.has('SomethingRemoved')).toBe(false)
  })
})

describe('manualClassification', () => {
  test('returns the override for an amendment listed in amendments_info.json', () => {
    for (const entry of amendmentInfoData as AmendmentInfo[]) {
      expect(manualClassification(entry.id)).toEqual({
        retired: entry.retired,
        obsolete: entry.obsolete,
      })
    }
  })

  test('returns null for an amendment that is not overridden', () => {
    expect(manualClassification('NOT_AN_OVERRIDDEN_AMENDMENT_ID')).toBeNull()
  })

  test('fixBatchV1_2 is overridden as votable', () => {
    // rippled 3.4.1 ships fixBatchV1_2 but is not tagged on GitHub and the
    // amendment has not landed in develop, so features.macro has no record of
    // it on either tracked ref and it would otherwise be flagged obsolete.
    const id =
      '14A2B45E48A4A124D1BBA657AC7B0DC3D5EA8C256C89E8F0D8142D32960A7944'
    const entry = (amendmentInfoData as AmendmentInfo[]).find(
      (amendment) => amendment.id === id,
    )

    expect(entry?.name).toBe('fixBatchV1_2')
    expect(manualClassification(id)).toEqual({
      retired: false,
      obsolete: false,
    })
  })
})
