# Contributing

:tada: First off, thanks for taking the time to contribute! :tada:

## Architecture

Go to [ARCHITECTURE.md](ARCHITECTURE.md)

## Setting up repo

Install the dependencies.

```bash
npm install
```

### Database

The Validator History Service only supports Postgres. You'll need to create a database, but the Validator History Service will create the schema for you.

Here are some helpful commands to set up the Postgres SQL data base on MacOS.
```
brew install postgresql # installs utility tools to interact with the data base
```

If you would like to only view/inspect some records of an existing database, you can install the essential tools with `brew install psql` (You need to add the binary file to the PATH variable)

Homebrew sets the machine username as the super user of the Postgres data base. You can find your user name through `whoami` command on the terminal.
```
psql -U <username> -c '\l' # lists all the databases managed by psql
psql -U <username> -c 'create database <data_base_name>;' # This step is required by the VHS. The database_name must match the environment variable in .env file
```

These step should suffice to run VHS on your local machine.

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
