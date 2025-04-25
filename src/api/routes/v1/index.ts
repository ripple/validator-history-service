import { Router as createRouter } from 'express'

import {
  handleAmendmentsInfo,
  handleAmendmentsVote,
  handleAmendmentInfo,
  handleAmendmentVote,
} from './amendments'
import handleDailyScores from './daily-report'
import getNetworkOrAdd from './get-network'
import handleHealth from './health'
import handleValidatorManifest from './manifests'
import handleNetworks from './networks'
import { handleNode, handleNodes, handleTopology } from './nodes'
import { handleValidator, handleValidators } from './validator'
import handleValidatorReport from './validator-report'

const api = createRouter()

api.use('/health', handleHealth)
api.use('/network/validator_reports', handleDailyScores)
api.use('/network/amendment/info/:param', handleAmendmentInfo)
api.use('/network/amendments/info', handleAmendmentsInfo)
api.use('/network/amendments/vote/:network', handleAmendmentsVote)
api.use('/network/amendment/vote/:network/:identifier', handleAmendmentVote)

api.use('/network/get_network/:entryUrl', getNetworkOrAdd)

api.use('/network/topology/nodes/:network', handleNodes)
api.use('/network/topology/nodes', handleNodes)
api.use('/network/topology/node/:publicKey', handleNode)
api.use('/network/topology', handleTopology)

api.use('/network/validator/:publicKey/reports', handleValidatorReport)
api.use('/network/validator/:publicKey/manifests', handleValidatorManifest)
api.use('/network/validator/:publicKey', handleValidator)
api.use('/network/validators/:param', handleValidators)
api.use('/network/validators', handleValidators)

api.use('/network/networks', handleNetworks)

export default api
