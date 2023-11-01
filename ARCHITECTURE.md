# Validator History Service Architecture

<!-- TODO: this page should probably be fleshed out into a documentation website of some sort -->

There are 3 folders in `src`, corresponding to the 3 processes that the VHS runs:
* `api` manages the VHS API endpoints.
* `connection-manager` manages the connections to rippled, and listens to validation and manifest streams.
* `crawler` finds validators and overlay nodes.


## API Endpoints

* `/`: Information about the endpoints.
* `v1`
  * `/health`: A health check for the VHS. Returns the number of nodes that it is connected to.
  * `/network/validator_reports`: Returns scores for the nodes that it has crawled in the last day.
  * `/network/topology`: Returns information about all the nodes that the crawler has crawled in the last hour.
  * `/network/topology/nodes`: Same as above.
  * `/network/topology/nodes/:network`: Same as above, filtered to only return the nodes that are a part of `network`.
  * `/network/topology/node/:publicKey`: Returns information about a specific node.
  * `/network/validators`: Returns information about all the validators that the VHS is paying attention to.
  * `/network/validators/:network`: Same as above, filtered to only return the validators that are a part of `network`.
  * `/network/validator/:publicKey`: Returns information about a specific validator.
  * `/network/validator/:publicKey/manifests`: Returns the manifests of a specific validator.
  * `/network/validator/:publicKey/reports`: Returns more detailed information about the reliability of a specific validator.


## SQL Table Schemas

### `crawls`

This table keeps track of the nodes in the network, which it finds via crawling the network.

| Key                  | Definition                                                                          |
|----------------------|-------------------------------------------------------------------------------------|
| `public_key`         |The public key of the node.                                                          |
| `start`              |When the node was first crawled.                                                     |
| `complete_ledgers`   |The range of ledgers for which the node has data.                                    |
| `complete_shards`     |The [history shards](https://xrpl.org/history-sharding.html) the node keeps track of.|
| `ip`                 |The IP address of the node.                                                          |
| `port`               |The peer port of the node.                                                           |
| `ws_url`             |The WS URL of the node. Optional.                                                    |
| `connected`          |This appears to be false for every node.                                             |
| `networks`           |The network(s) that the node belongs to.                                             |
| `type`               |Whether the TCP connection to the peer is incoming or outgoing.                      |
| `uptime`             |The uptime of the node.                                                              |
| `inbound_count`      |How many inbound connections the node has.                                           |
| `outbound_count`     |How many outbound connections the node has.                                          |
| `server_state`       |The `server_state` of the server.                                                    |
| `io_latency_ms`      |The `io_latency_ms` of the server.                                                   |
| `load_factor_server` |The load factor of the server (used for fees).                                       |
| `version`            |The version of rippled software that the node is running.                            |


### `daily_agreement`

This table keeps track of how reliable validators have been, on a 24-hour level.

| Key                  | Definition                            |
|----------------------|---------------------------------------|
| `master_key`         |The master key of the node.            |
| `day`                |The day that the data is for.          |
| `agreement`          |Data about the reliability of the node.|


### `hourly_agreement`

This table keeps track of how reliable validators have been, on an hourly level.

| Key                  | Definition                            |
|----------------------|---------------------------------------|
| `master_key`         |The master key of the node.            |
| `start`              |The time that the data starts.         |
| `agreement`          |Data about the reliability of the node.|

### `location`

This table keeps track of the physical location of all of the nodes that the network is aware of.

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

This table keeps track of the manifests of the validators.

| Key                  | Definition                                                 |
|----------------------|------------------------------------------------------------|
| `master_key`         |The master key of the validator.                            |
| `signing_key`        |The signing key of the validator.                           |
| `master_signature`   |The master public key for this validator.                   |
| `signature`          |The signature on the manifest.                              |
| `domain`             |The domain name this validator claims to be associated with.|
| `domain_verified`    |Whether the domain has been verified.                       |
| `revoked`            |Whether the manifest has been revoked.                      |
| `seq`                |The sequence number of this manifest.                       |


### `ballot`

This table keeps track of the most current voting data for the validators.

| Key                  | Definition                                                        |
|----------------------|-------------------------------------------------------------------|
| `signing_key`        |The signing key of the validator.                                  |
| `ledger_index`       |The most recent ledger index where voting data was retrieved.      |
| `amendments`         |The amendments this validator wants to be added to the protocol.   |
| `base_fee`           |The unscaled transaction cost this validator wants to set.         |
| `reserve_base`       |The minimum reserve requirement this validator wants to set.       |
| `reserve_inc`        |The increment in the reserve requirement this validator wants to set.|


### `validators`

This table keeps track of the validators on the networks.

| Key                  | Definition                                                        |
|----------------------|-------------------------------------------------------------------|
| `master_key`         |The master key of the validator.                                   |
| `signing_key`        |The signing key of the validator.                                  |
| `revoked`            |Whether the signing key has been revoked.                          |
| `ledger_hash`        |The hash of the last ledger the validator validated.               |
| `current_index`      |The current ledger index of the validator.                         |
| `load_fee`           |The current transaction load fee on the validator.                 |
| `partial`            |Whether the validation is a partial validation*.                   |
| `chain`              |What chain** the validator is running on.                          |
| `domain`             |The domain associated with the validator.                          |
| `domain_verified`    |Whether the domain has been verified.                              |
| `last_ledger_time`   |The last time the validator validated a ledger.                    |
| `agreement_1hour`    |Data about the reliability of the validator over the last hour.    |
| `agreement_24hour`   |Data about the reliability of the validator over the last 24 hours.|
| `agreement_30day`    |Data about the reliability of the validator over the 30 days.      |

*Partial validations are not meant to vote for any particular ledger. A partial validation indicates that the validator is still online but not keeping up with consensus.
**A chain is a group of validators validating the same set of ledgers. `main`, `test`, and `dev` represent the validated versions of mainnet, testnet, and devnet respectively. Validators on a fork/validating an alternate version of the ledger will have a different value, usually of the form `chain.[num]`.
