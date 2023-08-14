import { Manifest, StreamManifest } from 'xrpl-validator-domains'

interface Chain {
  id: string
  current: number
  first: number
  validators: Set<string>
  updated: number
  ledgers: Set<string>
  incomplete: boolean
}

interface Ledger {
  ledger_hash: string
  ledger_index: number
  validations: Set<string>
  first_seen: number
}

interface StreamLedger {
  fee_base: number
  fee_ref: number
  ledger_hash: string
  ledger_index: number
  ledger_time: number
  reserve_base: number
  reserve_inc: number
  txn_id: number
  type: string
}

interface LedgerEntryWarning {
  id: number
  message: string
}

interface LedgerEntryMajority {
  Majority: {
    Amendment: string
    CloseTime: number
  }
}

interface LedgerEntryAmendments {
  result: {
    index: string
    ledger_hash: string
    ledger_index: number
    node: {
      Amendments: string[]
      Flags: number
      LedgerEntryType: string
      Majorities: LedgerEntryMajority[]
      index: string
    }
    validated: boolean
    warnings: LedgerEntryWarning[]
  }
  status: string
  type: string
}

interface Node {
  public_key: string
  complete_ledgers?: string
  complete_shards?: string
  start?: string
  ip?: string
  port?: number
  type?: string
  uptime: number
  version: string
  server_state?: string
  io_latency_ms?: string
  load_factor_server?: string
}

interface Location {
  public_key: string
  ip: string
  lat?: number
  long?: number
  continent?: string
  country?: string
  region?: string
  city?: string
  country_code?: string
  region_code?: string
  postal_code?: string
  timezone?: string
  isp?: string
  org?: string
  domain?: string
  location_source: string
  updated: string
}

interface Crawl {
  this_node: Node
  active_nodes: Node[]
  node_unl: string | null
}

// This is the raw validation message format you can expect to see from the validations stream
interface ValidationRaw {
  flags: number
  full: boolean
  ledger_hash: string
  ledger_index: string
  master_key: string
  signature: string
  signing_time: number
  type: string
  validation_public_key: string
  server_version?: string
  networks?: string
  amendments?: string[]
  base_fee?: number
  reserve_base?: number
  reserve_inc?: number
  ledger_fee?: Fee

  // The validation_public_key is the same as the signing_key in StreamManifest
}

interface Agreement {
  score: number
  missed: number
  incomplete: boolean
}

interface Ballot {
  signing_key: string
  ledger_index: number
  amendments?: string
  base_fee?: number
  reserve_base?: number
  reserve_inc?: number
}

interface Fee {
  fee_base: number
  reserve_base: number
  reserve_inc: number
}

interface Validator {
  master_key?: string
  signing_key: string
  ledger_hash: string
  current_index: number
  partial: boolean
  last_ledger_time: Date
  server_version?: string
  networks?: string
}

interface DatabaseValidator extends Validator {
  current_ledger: string
  ledger_index: number
  load_fee: number
  partial: boolean
  chain: string
  unl: string
  domain: string
  domain_verified: boolean
  agreement_1hour: Agreement
  agreement_24hour: Agreement
  agreement_30day: Agreement
  updated: string
}

interface DatabaseNetwork {
  id: string
  entry: string
  port?: number
  unls: string
}

// This is the shape returned by vl.ripple.com
interface UNL {
  public_key: string
  manifest: string
  blob: string
}

interface UNLValidator {
  // this public key is the validator's master key unlike the validation_public_key in ValidationRaw
  validation_public_key: string
  manifest: string
}

// This is the shape you can expect from parsing the blob in the UNL
interface UNLBlob {
  sequence: number
  expiration: number
  validators: UNLValidator[]
}

interface DatabaseManifest extends Manifest {
  domain_verified: boolean
  revoked?: boolean
}

interface AgreementScore {
  validated: number
  missed: number
  incomplete: boolean
}

interface ValidatorKeys {
  master_key?: string
  signing_key: string
}

interface HourlyAgreement {
  main_key: string
  start: Date
  agreement: AgreementScore
}

interface DailyAgreement {
  main_key: string
  day: Date
  agreement: AgreementScore
}

interface AmendmentsInfo {
  id: string
  name: string
  rippled_version?: string
}

export {
  Node,
  Crawl,
  ValidationRaw,
  Manifest,
  StreamManifest,
  UNL,
  UNLBlob,
  UNLValidator,
  DatabaseManifest,
  DatabaseNetwork,
  HourlyAgreement,
  Ballot,
  Fee,
  DatabaseValidator,
  Validator,
  DailyAgreement,
  AgreementScore,
  Location,
  Ledger,
  StreamLedger,
  Chain,
  ValidatorKeys,
  AmendmentsInfo,
  LedgerEntryAmendments,
}
