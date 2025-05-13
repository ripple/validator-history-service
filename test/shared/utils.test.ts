import { getIPv4Address } from '../../src/shared/utils'

test('should strip IPv6 prefix', () => {
  expect(getIPv4Address('::ffff:145.239.232.123')).toBe('145.239.232.123')
})

test('should return plain IPv4 unchanged', () => {
  expect(getIPv4Address('145.239.232.123')).toBe('145.239.232.123')
})

test('should return plain hostname unchanged', () => {
  expect(getIPv4Address('p2p.livenet.ripple.com')).toBe(
    'p2p.livenet.ripple.com',
  )
})
