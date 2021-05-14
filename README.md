# Validator History Service <!-- omit in toc -->

Service for ingesting, aggregating, storing, and disbursing validation related data.

- [Installation](#installation)
  - [Install VHS globally](#install-vhs-globally)
  - [Database](#database)
  - [Environment variables](#environment-variables)
- [Run](#run)
  - [API inspection](#api-inspection)
- [Contributing](#contributing)

## Installation

### Install VHS globally

To install the Validator History Service globally on your computer, run

```bash
npm i -g validator-history-service
```

### Database

The Validator History Service only supports Postgres. You'll need to create a database, but the Validator History Service will create the schema for you.

### Environment variables

Create a `.env` file with the same environment variable as [.env.example](.env.example) where you want to run the Validator History Service.

Alternatively, update your `.bashrc` or `.zshrc` to export the environment variables.

Here are some example values for some environment variables:

- `ENTRIES`: your rippled node(s) [FQDN](https://en.wikipedia.org/wiki/Fully_qualified_domain_name) separated by a comma, for example `ENTRIES=s1.ripple.com,s2.ripple.com`
- `VL_MAIN`: a mainnet validator domain, for example `VL_MAIN=vl.ripple.com`
- `VL_TEST`: a testnet validator domain, for example `VL_TEST=vl.altnet.rippletest.net`
- `VL_DEV`: a devnet validator domain, for example `VL_DEV=vl.devnet.rippletest.net`

## Run

The Validator History Service runs on HTTP on port 3000.

After installation, you have access to the `validatorhistoryservice` command globally.

Run `validatorhistoryservice` with `--api` to launch the API server:

```bash
validatorhistoryservice --api
```

Run `validatorhistoryservice` with `--connections` to launch the connection manager:

```bash
validatorhistoryservice --connections
```

Run `validatorhistoryservice` with `--crawler` to launch the network crawler:

```bash
validatorhistoryservice --crawler
```

### API inspection

Once the service and API are running, you may inspect the API by issuing any HTTP request to port 3000:

```bash
curl localhost:3000
```

## Contributing

Please follow [this link](CONTRIBUTING.md)
