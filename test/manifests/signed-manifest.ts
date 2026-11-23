import { generateKeyPair, KeyObject, sign } from 'crypto'
import { promisify } from 'util'

import { encodeNodePublic } from 'ripple-address-codec'
import { encode } from 'xrpl'
import { Manifest } from 'xrpl-validator-domains'

interface Key {
  privateKey: KeyObject
  // Hex public key as XRPL encodes ed25519 keys: 'ED' + 32 bytes.
  hex: string
  nodePublic: string
}

async function newKey(): Promise<Key> {
  const { publicKey, privateKey } = await promisify(generateKeyPair)('ed25519')
  const raw = Buffer.from(
    publicKey.export({ format: 'jwk' }).x ?? '',
    'base64url',
  )
  const hex = `ED${raw.toString('hex').toUpperCase()}`
  return {
    privateKey,
    hex,
    nodePublic: encodeNodePublic(Buffer.from(hex, 'hex')),
  }
}

function signHex(key: Key, messageHex: string): string {
  return sign(null, Buffer.from(messageHex, 'hex'), key.privateKey)
    .toString('hex')
    .toUpperCase()
}

/**
 * A validator with a correctly signed manifest for `domain`, and the
 * xrp-ledger.toml its domain would serve to prove it runs the validator.
 *
 * @param domain - The domain the manifest claims, or undefined for none.
 * @returns The manifest and a toml file with a valid attestation.
 */
export default async function signedValidator(
  domain: string | undefined,
): Promise<{
  manifest: Manifest
  toml: string
}> {
  const master = await newKey()
  const signing = await newKey()
  // A manifest is not a transaction, but it is serialized the same way.
  const signed = encode({
    ...(domain === undefined
      ? {}
      : { Domain: Buffer.from(domain).toString('hex') }),
    PublicKey: master.hex,
    SigningPubKey: signing.hex,
    Sequence: 1,
  } as unknown as Parameters<typeof encode>[0])
  const data = Buffer.concat([
    Buffer.from('MAN\0'),
    Buffer.from(signed, 'hex'),
  ]).toString('hex')
  const attestation = signHex(
    master,
    Buffer.from(
      `[domain-attestation-blob:${domain ?? ''}:${master.nodePublic}]`,
    ).toString('hex'),
  )

  return {
    manifest: {
      master_key: master.nodePublic,
      signing_key: signing.nodePublic,
      master_signature: signHex(master, data),
      signature: signHex(signing, data),
      domain,
      seq: 1,
    },
    toml: `[[VALIDATORS]]\npublic_key = "${master.nodePublic}"\nattestation = "${attestation}"\n`,
  }
}
