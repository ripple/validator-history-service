import 'dotenv/config'
import express, { Request, Response } from 'express'
import logger from '../shared/utils/logger'
import config from '../shared/utils/config'

import routes from './routes/v1'
import handleInfo from './routes/v1/info'

const log = logger({name:'api'})
const PORT: number = config.port ? Number(config.port) : 3000
const ADDR: string = config.addr ?? '0.0.0.0'

const app = express()
app.use('/v1', routes)
app.use('/', handleInfo)

app.use('*', (_u: Request, res: Response) => {
  res.status(404).send({ error: 'route not found' })
})

app.listen(PORT, ADDR)
log.info(`Listening at ${ADDR}:${PORT}`)
