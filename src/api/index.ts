/* eslint-disable import/no-unused-modules -- Disable for index file. */
import 'dotenv/config'

import express, { Request, Response } from 'express'

import config from '../shared/utils/config'
import logger from '../shared/utils/logger'

import routes from './routes/v1'
import handleInfo from './routes/v1/info'

const log = logger({ name: 'api' })
const PORT: number = config.port ? Number(config.port) : 3000
const ADDR: string = config.addr ?? '0.0.0.0'

const app = express()

app.use((_req, res, next) => {
  res.append('Access-Control-Allow-Origin', ['*'])
  res.append('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE')
  res.append('Access-Control-Allow-Headers', 'Content-Type')
  next()
})

app.use('/v1', routes)
app.use('/', handleInfo)

app.use('*', (_u: Request, res: Response) => {
  res.status(404).send({ error: 'route not found' })
})

app.listen(PORT, ADDR)
log.info(`Listening at ${ADDR}:${PORT}`)
