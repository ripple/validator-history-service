# Contributing

:tada: First off, thanks for taking the time to contribute! :tada:

## Setting up repo

Install the dependencies.

```bash
npm install
```

### Database

The Validator History Service only supports Postgres. You'll need to create a database, but the Validator History Service will create the schema for you.

## Linting and testing

### Linting

```bash
npm run lint
```

Linting setup as described [here](https://github.com/xpring-eng/eslint-config-base).

### Testing

```bash
npm test
```

## Run

The Validator History Service runs on port 3000.

### Non-production

Environment variables are read from the `.env` file. Copy the variables from [.env.example](.env.example).

You may run the processes like this:

```bash
npm run startConnectionsDev & npm run startApiDev
```

You can start the three processes separately with:

```bash
npm run startConnectionsDev
```

```bash
npm run startApiDev
```

```bash
npm run startCrawlerDev
```
