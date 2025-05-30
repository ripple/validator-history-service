import { Request, Response } from 'express'

const info = {
  name: 'Validator History Service',
  version: '0.0.1-beta.0',
  documentation: 'Put Docs HERE',
  release_notes: 'Release Notes HERE',
  endpoints: [
    {
      action: 'Get All Networks',
      route: '/v1/network/networks',
      example: 'https://data.xrpl.org/v1/network/networks',
    },
    {
      action: 'Get Topology Nodes',
      route: '/v1/network/topology/nodes',
      example: 'https://data.xrpl.org/v1/network/topology/nodes',
    },
    {
      action: 'Get Topology Nodes By Network',
      route: '/v1/network/topology/nodes/{network}',
      example: 'https://data.xrpl.org/v1/network/topology/nodes/{network}',
    },
    {
      action: 'Get Topology Node',
      route: '/v1/network/topology/node/{pubkey}',
      example: 'https://data.xrpl.org/v1/network/topology/node/{pubkey}',
    },
    {
      action: 'Get Validators',
      route: '/v1/network/validators',
      example: 'https://data.xrpl.org/v1/network/validators',
    },
    {
      action: 'Get Validators By UNL',
      route: '/v1/network/validators/{unl}',
      example: 'https://data.xrpl.org/v1/network/validators/{unl}',
    },
    {
      action: 'Get Validators By Networks',
      route: '/v1/network/validators/{networks}',
      example: 'https://data.xrpl.org/v1/network/validators/{networks}',
    },
    {
      action: 'Get Validator',
      route: '/v1/network/validator/{pubkey}',
      example: 'https://data.xrpl.org/v1/network/validator/{pubkey}',
    },
    {
      action: 'Get Validator Manifests',
      route: '/v1/network/validator/{pubkey}/manifests',
      example: 'https://data.xrpl.org/v1/network/validator/{pubkey}/manifests',
    },
    {
      action: 'Get Single Validator Report',
      route: '/v1/network/validator/{pubkey}/reports',
      example: 'https://data.xrpl.org/v1/network/validator/{pubkey}/reports',
    },
    {
      action: 'Get Daily Validator Report',
      route: '/v1/network/validator_reports',
      example: 'https://data.xrpl.org/v1/network/validator_reports',
    },
    {
      action: 'Get Amendments General Information',
      route: '/v1/network/amendments/info',
      example: 'https://data.xrpl.org/v1/network/amendments/info',
    },
    {
      action: 'Get Amendment General Information by Name or ID',
      route: '/v1/network/amendment/info/{amendment}',
      example: 'https://data.xrpl.org/v1/network/amendment/info/{amendment}',
    },
    {
      action: 'Get Amendments Voting Information',
      route: '/v1/network/amendments/vote/{network}',
      example: 'https://data.xrpl.org/v1/network/amendments/vote/{network}',
    },
    {
      action: 'Get Amendment Voting Information by Name or ID',
      route: '/v1/network/amendment/vote/{network}/{identfier}',
      example:
        'https://data.xrpl.org/v1/network/amendments/vote/{network}/{identifier}',
    },
    {
      action: 'Get total number of connected rippled nodes.',
      route: '/v1/health',
      example: 'https://data.xrpl.org/v1/health',
    },
    {
      action:
        'Get total number of connected rippled nodes for each network in prometheus exposition format.',
      route: '/v1/metrics',
      example: 'https://data.xrpl.org/v1/metrics',
    },
  ],
}

/**
 * Handles info requests.
 *
 * @param _u - Express request.
 * @param res - Express response.
 */
export default function handleInfo(_u: Request, res: Response): void {
  res.send(info)
}
