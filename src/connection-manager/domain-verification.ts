import https from 'https'

import axios from 'axios'
import { decodeNodePublic } from 'ripple-address-codec'
import toml from 'toml'
import { verifyKeypairSignature } from 'xrpl'
import {
  Manifest,
  StreamManifest,
  normalizeManifest,
  verifyManifestSignature,
} from 'xrpl-validator-domains'

import { guardedLookup, isAllowedHost } from '../shared/utils/blocked-address'
import logger from '../shared/utils/logger'

const log = logger({ name: 'domain-verification' })

const TOML_PATH = '/.well-known/xrp-ledger.toml'

interface TomlFetchLimits {
  deadlineMs: number
  maxBytes: number
}

// Real files are a few KB (the largest on mainnet is about 9 KB) and arrive
// in under 2 seconds. The deadline leaves room for distant or slow hosts,
// since a miss marks an honest validator unverified until the next check.
const TOML_LIMITS: TomlFetchLimits = { deadlineMs: 10000, maxBytes: 64 * 1024 }

// Validators seen on mainnet need at most one (from a domain to its www.).
const MAX_REDIRECTS = 1

// Certificates are checked (the default): the file only proves anything if it
// really came from the domain, and the spec requires a valid certificate.
const httpsAgent = new https.Agent({ lookup: guardedLookup })

interface TomlValidator {
  public_key?: string
  attestation?: string
}

interface TomlFile {
  VALIDATORS?: TomlValidator[]
}

interface DomainVerification {
  verified: boolean
  verified_manifest_signature: boolean
  message: string
  manifest: Manifest
}

/**
 * Requests a host's xrp-ledger.toml, following at most `redirectsLeft`
 * redirects.
 *
 * A redirect is treated as if the manifest had named the redirect's host:
 * only the host is taken from it, and the next request is built and checked
 * exactly like this one (https, port 443, the standard path, the host checks).
 * So a redirect cannot reach anything a manifest could not name. Redirects
 * are not left to axios, because it would take the protocol, port and path
 * from the redirect, and those would skip the checks.
 *
 * @param host - The host to request the file from.
 * @param limits - The size cap for each response.
 * @param signal - Aborts the request, and any redirect, at the deadline.
 * @param redirectsLeft - How many more redirects may be followed.
 * @returns The body of the file.
 * @throws If a host is blocked, a request fails or exceeds a limit, or a
 * redirect cannot be followed.
 */
async function requestToml(
  host: string,
  limits: TomlFetchLimits,
  signal: AbortSignal,
  redirectsLeft: number,
): Promise<string> {
  if (!isAllowedHost(host)) {
    log.warn(`Skipping domain verification of blocked host ${host}`)
    throw new Error(`${host} is not an allowed host`)
  }
  const response = await axios.get<string>(`https://${host}${TOML_PATH}`, {
    httpsAgent,
    // A proxy from the environment (HTTPS_PROXY) would resolve the host
    // itself, so guardedLookup would never see the host's address.
    proxy: false,
    maxRedirects: 0,
    validateStatus: (status) => status >= 200 && status < 400,
    maxContentLength: limits.maxBytes,
    signal,
    responseType: 'text',
  })
  if (response.status < 300) {
    return response.data
  }
  const location: unknown = response.headers.location
  if (redirectsLeft === 0 || typeof location !== 'string') {
    // An honest validator whose redirect chain is longer ends up unverified,
    // so say why.
    log.warn(
      `Not following redirect from ${host} (status ${response.status}, ${
        redirectsLeft === 0 ? 'too many redirects' : 'no Location header'
      })`,
    )
    throw new Error(`Not following redirect from ${host}`)
  }
  const nextHost = new URL(location, `https://${host}`).hostname
  return requestToml(nextHost, limits, signal, redirectsLeft - 1)
}

/**
 * Fetches and parses a domain's xrp-ledger.toml. The domain comes from a
 * validator's manifest, and anyone can run a validator and name any domain,
 * so the request is held to the same checks as the crawler's.
 *
 * @param domain - The domain from the manifest.
 * @param limits - The deadline and size cap for the request.
 * @returns The parsed toml file.
 * @throws If the host is blocked, the request fails or exceeds a limit, or
 * the file is not valid toml.
 */
async function fetchToml(
  domain: string,
  limits: TomlFetchLimits,
): Promise<TomlFile> {
  // axios `timeout` only fires when the connection goes idle, so a server
  // sending one byte at a time would never trip it. This bounds the whole
  // request, including a redirect.
  const deadline = new AbortController()
  const timer = setTimeout(() => deadline.abort(), limits.deadlineMs)
  try {
    const body = await requestToml(
      domain,
      limits,
      deadline.signal,
      MAX_REDIRECTS,
    )
    return toml.parse(body) as TomlFile
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Whether every toml entry for a validator has a valid attestation: the
 * validator's master key signing `[domain-attestation-blob:domain:key]`.
 *
 * @param domain - The domain from the manifest.
 * @param publicKey - The validator's master public key.
 * @param validators - The toml entries for that key.
 * @returns True if all of the attestations are valid.
 */
function hasValidAttestations(
  domain: string,
  publicKey: string,
  validators: TomlValidator[],
): boolean {
  const message = Buffer.from(
    `[domain-attestation-blob:${domain}:${publicKey}]`,
  ).toString('hex')
  const key = Buffer.from(decodeNodePublic(publicKey)).toString('hex')
  return validators.every((validator) => {
    // The toml comes from the domain, so the attestation can be any type.
    try {
      const attestation = Buffer.from(
        validator.attestation ?? '',
        'hex',
      ).toString('hex')
      return verifyKeypairSignature(message, attestation, key)
    } catch {
      return false
    }
  })
}

/**
 * Verifies the signature and domain of a manifest. This does what
 * `verifyValidatorDomain` from xrpl-validator-domains does, but fetches the
 * toml file itself, because the library's request has no deadline or size
 * cap, follows redirects, and connects to any host.
 *
 * @param manifest - The manifest to verify.
 * @param limits - The deadline and size cap for fetching the toml file.
 * @returns Whether the domain is verified, and the normalized manifest.
 * @throws If the manifest cannot be normalized or the toml file cannot be
 * fetched.
 */
export default async function verifyValidatorDomain(
  manifest: Manifest | StreamManifest | string,
  limits: TomlFetchLimits = TOML_LIMITS,
): Promise<DomainVerification> {
  const normalized = normalizeManifest(manifest)
  const { domain, master_key: publicKey } = normalized
  // The check throws, rather than returning false, when a key cannot be
  // decoded or there is no signature. That is still an invalid signature:
  // callers save a manifest when verification throws, and one with an
  // unchecked signature must not be saved.
  let signatureVerified: boolean
  try {
    signatureVerified = verifyManifestSignature(normalized)
  } catch {
    signatureVerified = false
  }
  let verified = false
  let message: string

  if (!signatureVerified) {
    message = 'Cannot verify manifest signature'
  } else if (domain === undefined) {
    message = 'Manifest does not contain a domain'
  } else {
    const { VALIDATORS } = await fetchToml(domain, limits)
    const validators = Array.isArray(VALIDATORS)
      ? VALIDATORS.filter((validator) => validator.public_key === publicKey)
      : undefined
    if (validators === undefined) {
      message = 'Invalid .toml file'
    } else if (validators.length === 0) {
      message = '.toml file does not have matching public key'
    } else if (hasValidAttestations(domain, publicKey, validators)) {
      verified = true
      message = `${domain} has been verified`
    } else {
      message = `Invalid attestation, cannot verify ${domain}`
    }
  }

  return {
    verified,
    verified_manifest_signature: signatureVerified,
    message,
    manifest: normalized,
  }
}
