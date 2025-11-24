// test/connections/heartbeat.test.ts
import type WebSocketType from 'ws'

// Helpers
const WS_HEARTBEAT_CHECK_INTERVAL = 10 * 60 * 1000 // matches src code
const WS_HEARTBEAT_TIMEOUT = 60 * 1000 // matches src code

const flushPromises = async (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0))

// Mock the WS module to a controllable EventEmitter-like class, and expose instances list
jest.mock('ws', () => {
  const instances: any[] = []
  class MockWebSocket {
    public static instances = instances
    public url: string
    private handlers: Record<string, Array<(...args: any[]) => void>> = {}

    public constructor(url: string) {
      this.url = url
      ;(MockWebSocket as any).instances.push(this)
    }

    public on(event: string, cb: (...args: any[]) => void): void {
      this.handlers[event] ??= []
      this.handlers[event].push(cb)
    }

    public emit(event: string, ...args: any[]): void {
      ;(this.handlers[event] ?? []).forEach((cb) => cb(...args))
    }

    public send(): void {
      // no-op
    }

    public terminate(): void {
      // no-op
    }
  }

  // default export
  return MockWebSocket
})

// Mock DB + connection health dependencies used by connections.ts
jest.mock('../../src/shared/database/connectionHealth', () => {
  return {
    clearConnectionHealthDb: jest.fn(async () => {}),
    getTotalConnectedNodes: jest.fn(async () => 0),
    isNodeConnectedByIp: jest.fn(async () => false),
    isNodeConnectedByPublicKey: jest.fn(async () => false),
    isNodeConnectedByWsUrl: jest.fn(async () => false),
    saveConnectionHealth: jest.fn(async () => {}),
    updateConnectionHealthStatus: jest.fn(async () => {}),
  }
})

jest.mock('../../src/shared/database/amendments', () => {
  return {
    fetchAmendmentInfo: jest.fn(async () => {}),
    deleteAmendmentStatus: jest.fn(async () => {}),
  }
})

jest.mock('../../src/shared/database', () => {
  return {
    // Unused in this test, but return a basic query fn to avoid accidental calls
    query: jest.fn(),
    // No extra networks to avoid creating extra sockets
    getNetworks: jest.fn(async () => []),
    // Return two nodes with ws_url so connections.ts uses those URLs directly
    getNodes: jest.fn(async () => [
      { ip: 'unused', ws_url: 'ws://fresh.example', networks: 'testnet' },
      { ip: 'unused', ws_url: 'ws://stale.example', networks: 'testnet' },
    ]),
  }
})

jest.mock('../../src/connection-manager/wsHandling', () => {
  return {
    subscribe: jest.fn(),
    handleWsMessageSubscribeTypes: jest.fn(),
    fetchAmendmentsFromLedgerEntry: jest.fn(async () => {}),
    backtrackAmendmentStatus: jest.fn(async () => {}),
    handleWsMessageLedgerEnableAmendments: jest.fn(async () => {}),
  }
})

describe('websocket heartbeat sweep', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  test('marks stale connection and keeps fresh connection', async () => {
    // Import after fake timers so setInterval is controlled by Jest timers
    const { default: startConnections } = await import(
      '../../src/connection-manager/connections'
    )
    const WebSocket = (await import('ws')).default as unknown as typeof WebSocketType
    const {
      updateConnectionHealthStatus,
    } = await import('../../src/shared/database/connectionHealth')

    // Start connection manager (this schedules intervals and creates 2 sockets via getNodes())
    const startPromise = startConnections()

    // Wait for sockets to be constructed
    // (connections.ts waits for 'open' to resolve setHandlers)
    await flushPromises()
    const instances = (WebSocket as any).instances as Array<{
      url: string
      emit: (event: string, ...args: any[]) => void
    }>
    expect(instances.length).toBe(2)

    // Simulate both sockets opening at t0 (sets heartbeat to t0)
    for (const ws of instances) {
      ws.emit('open')
    }

    await startPromise // initial startup completes after 'open' events

    // Advance time beyond heartbeat timeout so all would be stale...
    jest.setSystemTime(new Date(Date.now() + WS_HEARTBEAT_TIMEOUT + 1000))

    // ...but refresh the "fresh" socket right before sweep
    const fresh = instances.find((i) => i.url.includes('fresh'))!
    fresh.emit('message', JSON.stringify({ type: 'noop' }))

    // Trigger the heartbeat sweep interval once
    jest.advanceTimersByTime(WS_HEARTBEAT_CHECK_INTERVAL)
    await flushPromises()

    // Only the stale socket should be marked disconnected
    expect((updateConnectionHealthStatus as jest.Mock).mock.calls.length).toBe(1)
    expect((updateConnectionHealthStatus as jest.Mock).mock.calls[0][0]).toBe(
      'ws://stale.example',
    )
    expect((updateConnectionHealthStatus as jest.Mock).mock.calls[0][1]).toBe(false)
  })
})
