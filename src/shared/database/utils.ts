import { knex, Knex } from 'knex'

import config from '../utils/config'

let knexDb: Knex | undefined

/**
 * Gets an instance of knex connection.
 *
 * @returns Knex instance.
 */
export function db(): Knex {
  if (knexDb) {
    return knexDb
  }

  knexDb = knex(config.db)

  return knexDb
}

/**
 * Deletes tables in Database.
 *
 * @returns Promise that resolves to void.
 */
export async function tearDown(): Promise<void> {
  await db()
    .schema.dropTableIfExists('location')
    .dropTableIfExists('connection_health')
    .dropTableIfExists('crawls')
    .dropTableIfExists('manifests')
}

/**
 * Query the database.
 *
 * @param tbName - Name of table to query.
 * @returns Knex query builder.
 */
export function query(tbName: string): Knex.QueryBuilder {
  return db()(tbName)
}

/**
 * Destroy database connection.
 *
 * @returns Promise that destroys database connection.
 */
export async function destroy(): Promise<void> {
  return db().destroy()
}
