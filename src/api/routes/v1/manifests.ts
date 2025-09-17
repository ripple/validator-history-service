import { Request, Response } from 'express'

import { query } from '../../../shared/database'
import logger from '../../../shared/utils/logger'

const log = logger({ name: 'api-validator-manifest' })

interface ManifestResponse {
  master_key: string
  signing_key: string
  master_signature: string
  signature: string
  domain: string
  domain_verified: string
  seq: string
}

/**
 * Reads nodes from database.
 *
 * @param master_key - Master_key of validator.
 * @returns Locations of nodes crawled in the last 10 minutes.
 */
async function getReports(master_key: string): Promise<ManifestResponse[]> {
  return query('manifests')
    .select('*')
    .where('master_key', '=', master_key) as Promise<ManifestResponse[]>
}

/**
 * Handles manifest request.
 *
 * @param req - Express request.
 * @param res - Express response.
 * @returns Void.
 */
export default async function handleValidatorManifest(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const master_key = req.params.publicKey

    const manifests: ManifestResponse[] = await getReports(master_key)

    const response = {
      result: 'success',
      count: manifests.length,
      reports: manifests,
    }

    res.status(200).send(response)
  } catch (err: unknown) {
    log.error('Error handleValidatorManifest: ', err)
    res.status(500).send({
      result: 'error',
      message: `internal error: ${(err as Error).message}`,
    })
  }
}
