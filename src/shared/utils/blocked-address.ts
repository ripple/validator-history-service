import dns from 'dns'
import net, { LookupFunction } from 'net'

import logger from './logger'

const log = logger({ name: 'blocked-address' })

/**
 * Addresses VHS must never connect to. Hosts come from peers' crawl responses
 * and from rows saved from them, so anyone can point VHS at an address (SSRF,
 * DGE-8762). None of these can be a real XRPL node.
 *
 * Private ranges (10/8, 172.16/12, 192.168/16, fc00::/7) are deliberately NOT
 * blocked: custom.xrpl.org users monitor private networks over tunnels.
 */
const BLOCKED = new net.BlockList()
// "This" network, including 0.0.0.0.
BLOCKED.addSubnet('0.0.0.0', 8, 'ipv4')
// Loopback.
BLOCKED.addSubnet('127.0.0.0', 8, 'ipv4')
// Link-local, including the AWS instance and container metadata services
// (169.254.169.254, 169.254.170.2) and the other AWS endpoints in the range.
BLOCKED.addSubnet('169.254.0.0', 16, 'ipv4')
// Unspecified and loopback.
BLOCKED.addSubnet('::', 127, 'ipv6')
// Link-local.
BLOCKED.addSubnet('fe80::', 10, 'ipv6')
// AWS instance metadata service over IPv6.
BLOCKED.addAddress('fd00:ec2::254', 'ipv6')

// A hostname: dot-separated labels of letters, digits and inner hyphens.
const HOSTNAME =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu
// Resolvers and URL parsers read a host whose last label is a number as an
// IPv4 address in integer, hex or octal form (2130706433, 0x7f.1, 127.1).
const NUMERIC_LAST_LABEL = /(?:^|\.)(?:0x[0-9a-f]*|\d+)$/iu

/**
 * Whether an IP address is one VHS must never connect to.
 *
 * @param ip - An IPv4 or IPv6 address. IPv4-mapped IPv6 addresses are checked
 * as IPv4.
 * @returns True if the address is blocked.
 */
export function isBlockedIp(ip: string): boolean {
  const family = net.isIPv6(ip) ? 'ipv6' : 'ipv4'
  return BLOCKED.check(ip, family)
}

/**
 * Whether a host is safe to connect to: a plain hostname, or an IP address
 * that is not blocked. Anything else (ports, paths, credentials, integer or
 * hex IPv4 forms) is rejected. A hostname can still resolve to a blocked
 * address, so connections must also use {@link guardedLookup}.
 *
 * @param host - The host to check, without scheme, port or path.
 * @returns True if the host may be connected to.
 */
export function isAllowedHost(host: string): boolean {
  if (net.isIP(host) !== 0) {
    return !isBlockedIp(host)
  }
  return HOSTNAME.test(host) && !NUMERIC_LAST_LABEL.test(host)
}

/**
 * Whether a saved WebSocket url points at an allowed host. Urls in
 * connection_health were saved before hosts were checked, and an IP literal
 * in one skips {@link guardedLookup}, so check its host here.
 *
 * @param url - A ws:// or wss:// url.
 * @returns True if the url parses and its host is allowed.
 */
export function isAllowedWsUrl(url: string): boolean {
  try {
    // URL keeps the brackets around an IPv6 host; isAllowedHost wants it bare.
    const host = new URL(url).hostname.replace(/^\[(.*)\]$/u, '$1')
    return isAllowedHost(host)
  } catch {
    return false
  }
}

/**
 * A drop-in for `dns.lookup` that fails when the name resolves to a blocked
 * address. Pass it as the `lookup` option of a request or socket so the check
 * runs on the address actually connected to, which catches names like
 * 169.254.169.254.sslip.io. Node skips `lookup` for IP literals, so check
 * those with {@link isAllowedHost} first.
 *
 * @param hostname - The name to resolve.
 * @param options - Options passed through to `dns.lookup`.
 * @param callback - Called with the result, or an error with code
 * EBLOCKEDADDRESS if any resolved address is blocked.
 */
export const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) {
      callback(error, '', 0)
      return
    }
    const blocked = addresses.find((entry) => isBlockedIp(entry.address))
    if (blocked) {
      log.warn(`Blocked connection to ${hostname} (${blocked.address})`)
      const blockedError: NodeJS.ErrnoException = new Error(
        `${hostname} resolves to a blocked address`,
      )
      blockedError.code = 'EBLOCKEDADDRESS'
      callback(blockedError, '', 0)
      return
    }
    if (options.all) {
      callback(null, addresses)
      return
    }
    callback(null, addresses[0].address, addresses[0].family)
  })
}
