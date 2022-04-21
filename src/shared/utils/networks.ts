import config from './config'

interface Network {
  network: string
  port?: number
  entry: string
  unls: string[]
}

const networks: Network[] = [
  {
    network: 'main',
    entry: config.mainnet_p2p_server,
    port: 51235,
    unls: ['vl.ripple.com', 'vl.xrplf.org', 'vl.coil.com'],
  },
  {
    network: 'test',
    entry: 's.altnet.rippletest.net',
    port: 51235,
    unls: ['vl.altnet.rippletest.net'],
  },
  {
    network: 'dev',
    entry: 's.devnet.ripple.test.net',
    port: 51235,
    unls: ['vl.devnet.rippletest.net'],
  },
]

export default networks

export { Network }
