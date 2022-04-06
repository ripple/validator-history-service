# Validator History Service Architecture

<!-- TODO: this page should probably be fleshed out into a documentation website of some sort -->

There are 3 folders in `src`:
* `api` manages the VHS API endpoints
* `connection-manager` manages the connections to rippled, and listens to validation and manifest streams
* `crawler` finds validators and overlay nodes


## API Endpoints

* `/`: 
* `v1`
  * `/health`: A health check for the VHS. Returns the number of nodes that it is connected to.
  * `/network/validator_reports`: Returns scores for the nodes that it has crawled in the last day.
  * `/network/topology`: Returns information about all the nodes that the crawler has crawled in the last hour.
  * `/network/topology/nodes`: Same as above.
  * `/network/topology/nodes/:publicKey`: Returns information about a specific node.
  * `/network/validators`: Returns information about all the validators that the VHS is paying attention to.
  * `/network/validators/:publicKey`: Returns information about a specific validator.
  * `/network/validators/:publicKey/manifests`: Returns the manifests of a specific validator.
  * `/network/validators/:publicKey/reports`: Returns more detailed information about the reliability of a specific validator.

## SQL Table Schemas

### `crawls`

This table keeps track of (TODO: finish)

| Key                  | Definition                                              |
|----------------------|---------------------------------------------------------|
| `public_key`         |The public key of the node.                              |
| `start`              |                                                         |
| `complete_ledgers`   |The range of ledgers for which the node has data.        |
| `compete_shards`     |                                                         |
| `ip`                 |The IP address of the node.                              |
| `port`               |The peer port of the node.                               |
| `ws_url`             |The WS URL of the node. Optional.                        |
| `connected`          |                                                         |
| `networks`           |                                                         |
| `type`               |                                                         |
| `uptime`             |                                                         |
| `inbound_count`      |                                                         |
| `outbound_count`     |                                                         |
| `server_state`       |The `server_state` of the server.                        |
| `io_latency_ms`      |The `io_latency_ms` of the server.                       |
| `load_factor_server` |The load factor of the server (used for fees).           |
| `version`            |The version of rippled software that the node is running.|


### `daily_agreement`

This table keeps track of (TODO: finish)

| Key                  | Definition                |
|----------------------|---------------------------|
| `master_key`         |The master key of the node.|
| `day`                |                           |
| `agreement`          |                           |


### `hourly_agreement`

This table keeps track of (TODO: finish)

| Key                  | Definition                |
|----------------------|---------------------------|
| `master_key`         |The master key of the node.|
| `start`              |                           |
| `agreement`          |                           |


### `ledgers`

This table keeps track of (TODO: finish)

| Key                  | Definition                                              |
|----------------------|---------------------------------------------------------|
| `ledger_hash`        |The hash of the ledger.                                  |
| `ledger_index`       |The index of the ledger.                                 |
| `full`               |                                                         |
| `main`               |                                                         |
| `altnet`             |                                                         |
| `partial`            |                                                         |
| `missing`            |                                                         |
| `avg_load_fee`       |                                                         |
| `avg_sign_time`      |                                                         |
| `updated`            |                                                         |

### `location`

This table keeps track of (TODO: finish)

| Key                  | Definition                                              |
|----------------------|---------------------------------------------------------|
| `public_key`         |The public key of the node.                              |
| `ip`                 |The IP address of the node.                              |
| `lat`                |The latitude of the node's location                      |
| `long`               |The longitude of the node's location                     |
| `continent`          |The continent where the node is located.                 |
| `country`            |The country where the node is located.                   |
| `region`             |The region where the node is located.                    |
| `city`               |The city where the node is located.                      |
| `postal_code`        |The postal code where the node is located.               |
| `region_code`        |The region code where the node is located.               |


### `manifests`

This table keeps track of (TODO: finish)

| Key                  | Definition                                              |
|----------------------|---------------------------------------------------------|
| `master_key`         |The master key of the node.                              |
| `signing_key`        |The signing key of the node.                             |
| `master_signature`   |                                                         |
| `signature`          |                                                         |
| `domain`             |                                                         |
| `domain_verified`    |                                                         |
| `revoked`            |                                                         |
| `seq`                |                                                         |


### `validators`

This table keeps track of (TODO: finish)

| Key                  | Definition                                              |
|----------------------|---------------------------------------------------------|
| `master_key`         |The master key of the node.                              |
| `signing_key`        |The signing key of the node.                             |
| `revoked`            |                                                         |
| `ledger_hash`        |                                                         |
| `current_index`      |                                                         |
| `load_fee`           |                                                         |
| `partial`            |                                                         |
| `chain`              |                                                         |
| `domain`             |                                                         |
| `domain_verified`    |                                                         |
| `agreement_1hour`    |                                                         |
| `agreement_24hour`   |                                                         |
| `agreement_30day`    |                                                         |
