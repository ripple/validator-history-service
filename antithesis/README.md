# Antithesis Testing Setup for Validator History Service

This directory contains the necessary files and configuration for running the Validator History Service on the Antithesis testing platform.

## Overview

Antithesis is an autonomous testing platform that finds bugs in software through continuous fault injection and property-based testing. This setup enables comprehensive testing of the validator-history-service in a controlled, reproducible environment.

## Files

- `Dockerfile.config` - Config image for Antithesis (contains docker-compose.yaml)
- `test_template.sh` - Test template that Antithesis will execute
- `README.md` - This file

## Prerequisites

1. Docker installed locally
2. Antithesis account and credentials
3. Access to Antithesis container registry

## Local Testing

Before pushing to Antithesis, test your setup locally:

### 1. Build the Docker image

```bash
cd ..
docker build -t validator-history-service:latest .
```

### 2. Test with Docker Compose

```bash
# Create a .env file from Docker template
cp .env.docker .env

# Start the services
docker-compose up
```

### 3. Verify services are running

```bash
# Check API health
curl http://localhost:3000/v1/health

# Check metrics
curl http://localhost:3000/v1/metrics

# Check networks
curl http://localhost:3000/v1/networks
```

### 4. Test without internet access (Antithesis requirement)

On Linux:
```bash
unshare -n docker-compose up
```

On macOS/Windows, you can test by disconnecting from the network after images are pulled.

## Building Images for Antithesis

### 1. Build the main application image

```bash
cd ..
docker build -t validator-history-service:latest .
```

### 2. Build the config image

```bash
cd antithesis
docker build -f Dockerfile.config -t vhs-config:latest ..
```

## Pushing to Antithesis Registry

Replace `$TENANT_NAME` with your Antithesis tenant name.

### 1. Authenticate to Antithesis registry

```bash
cat $TENANT_NAME.key.json | docker login -u _json_key https://us-central1-docker.pkg.dev --password-stdin
```

### 2. Tag and push the application image

```bash
docker tag validator-history-service:latest \
  us-central1-docker.pkg.dev/molten-verve-216720/$TENANT_NAME-repository/validator-history-service:latest

docker push us-central1-docker.pkg.dev/molten-verve-216720/$TENANT_NAME-repository/validator-history-service:latest
```

### 3. Tag and push the config image

```bash
docker tag vhs-config:latest \
  us-central1-docker.pkg.dev/molten-verve-216720/$TENANT_NAME-repository/vhs-config:latest

docker push us-central1-docker.pkg.dev/molten-verve-216720/$TENANT_NAME-repository/vhs-config:latest
```

## Running Tests on Antithesis

Use the Antithesis webhook API to trigger a test run:

```bash
curl --fail -u 'user:password' \
  -X POST https://<tenant>.antithesis.com/api/v1/launch/basic_test \
  -d '{
    "params": {
      "antithesis.description": "VHS test on main",
      "antithesis.duration": "60",
      "antithesis.config_image": "us-central1-docker.pkg.dev/molten-verve-216720/$TENANT_NAME-repository/vhs-config:latest",
      "antithesis.images": "us-central1-docker.pkg.dev/molten-verve-216720/$TENANT_NAME-repository/validator-history-service:latest",
      "antithesis.report.recipients": "your-email@example.com"
    }
  }'
```

## Test Template

The test template (`test_template.sh`) performs the following:

1. Waits for the API service to become healthy
2. Runs basic API endpoint tests
3. Emits a `setup_complete` signal to Antithesis
4. Continues running tests in a loop for fault injection

## Environment Variables

Environment variables are configured in the `.env` file. Docker Compose automatically loads this file.

### Required Variables

- `DB_USER` - PostgreSQL username (default: vhs_user)
- `DB_PASSWORD` - PostgreSQL password (default: vhs_password)
- `DB_DATABASE` - PostgreSQL database name (default: validator_history)
- `RIPPLED_RPC_ADMIN` - Rippled RPC admin endpoint (e.g., https://xrpl.ws/)
- `MAINNET_P2P_ENTRY` - Mainnet P2P entry point (e.g., s1.ripple.com)
- `MAINNET_UNL` - Mainnet UNL domain (default: vl.ripple.com)

### Optional Variables

- `MAXMIND_USER` - MaxMind GeoIP user (for geolocation features)
- `MAXMIND_KEY` - MaxMind GeoIP key (for geolocation features)
- `NODE_ENV` - Node environment (default: production)
- `ACQUIRE_CONNECTION_TIMEOUT` - Database connection timeout in ms (default: 60000)

### Docker Compose Overrides

The following variables are automatically overridden in docker-compose.yaml for containerized environments:

- `DB_HOST` - Set to `postgres` (the service name)
- `RIPPLED_RPC_ADMIN` - Set to `http://rippled:5005` (local rippled instance)
- `PORT` - Set to `3000`
- `ADDR` - Set to `0.0.0.0`

**Note:** The Docker Compose setup includes a local rippled instance, eliminating the need for external XRPL network dependencies. This makes the setup self-contained and ideal for Antithesis testing.

### Environment File Templates

- `.env.docker` - Pre-configured for Docker Compose with sensible defaults
- `.env.example` - General template with detailed comments

## Architecture

The docker-compose setup includes:

1. **postgres** - PostgreSQL database (postgres:17.2)
2. **vhs-api** - API service (port 3000)
3. **vhs-connections** - Connection manager service
4. **vhs-crawler** - Network crawler service

All services connect to the same PostgreSQL database and communicate over a shared Docker network.

## Troubleshooting

### Services not starting

Check logs:
```bash
docker-compose logs -f
```

### Database connection issues

Ensure PostgreSQL is healthy:
```bash
docker-compose ps
```

### API not responding

Check if the service is listening:
```bash
docker-compose exec vhs-api netstat -tlnp
```

## Additional Resources

- [Antithesis Documentation](https://antithesis.com/docs)
- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [Validator History Service Repository](https://github.com/ripple/validator-history-service)
