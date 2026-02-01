# Antithesis Testing for Validator History Service

This document provides a comprehensive guide for setting up and running the Validator History Service on the Antithesis testing platform.

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [Files and Structure](#files-and-structure)
- [Local Testing](#local-testing)
- [Deploying to Antithesis](#deploying-to-antithesis)
- [CI/CD Integration](#cicd-integration)
- [Troubleshooting](#troubleshooting)

## Overview

Antithesis is an autonomous testing platform that continuously tests software by injecting faults and exploring different execution paths. This setup enables comprehensive testing of the Validator History Service in a controlled, reproducible environment.

### What Antithesis Tests

- **Fault Tolerance**: How the system behaves under network failures, crashes, and resource constraints
- **Concurrency Issues**: Race conditions, deadlocks, and other concurrency bugs
- **Edge Cases**: Rare scenarios that are difficult to reproduce manually
- **System Properties**: Invariants and assertions that should always hold true

## Quick Start

### Prerequisites

- Docker and Docker Compose installed
- Antithesis account with credentials
- Node.js 20+ (for local development)

### 1. Build Docker Images Locally

```bash
# Build the main application image
docker build -t validator-history-service:latest .

# Build the config image
docker build -f antithesis/Dockerfile.config -t vhs-config:latest .
```

### 2. Test Locally with Docker Compose

```bash
# Create environment file
cp .env.example .env
# Edit .env with your configuration

# Start all services
docker-compose up
```

### 3. Verify Services

```bash
# Check API health
curl http://localhost:3000/v1/health

# Check metrics
curl http://localhost:3000/v1/metrics
```

## Architecture

The Antithesis setup consists of the following components:

### Docker Services

1. **postgres** - PostgreSQL 17.2 database
2. **vhs-api** - API service (port 3000)
3. **vhs-connections** - Connection manager service
4. **vhs-crawler** - Network crawler service

All services communicate over a shared Docker network (`vhs-network`) and connect to the same PostgreSQL database.

### Test Flow

```
┌─────────────────────────────────────────────────────────┐
│                    Antithesis Platform                   │
│                                                          │
│  ┌────────────────────────────────────────────────────┐ │
│  │  1. Start Services (docker-compose.yaml)           │ │
│  │     - PostgreSQL                                   │ │
│  │     - VHS API                                      │ │
│  │     - VHS Connections                              │ │
│  │     - VHS Crawler                                  │ │
│  └────────────────────────────────────────────────────┘ │
│                          ↓                               │
│  ┌────────────────────────────────────────────────────┐ │
│  │  2. Run Test Template                              │ │
│  │     - Wait for services to be ready                │ │
│  │     - Execute API tests                            │ │
│  │     - Emit setup_complete signal                   │ │
│  └────────────────────────────────────────────────────┘ │
│                          ↓                               │
│  ┌────────────────────────────────────────────────────┐ │
│  │  3. Continuous Testing & Fault Injection           │ │
│  │     - Network failures                             │ │
│  │     - Process crashes                              │ │
│  │     - Resource constraints                         │ │
│  │     - Timing variations                            │ │
│  └────────────────────────────────────────────────────┘ │
│                          ↓                               │
│  ┌────────────────────────────────────────────────────┐ │
│  │  4. Generate Report                                │ │
│  │     - Bug findings                                 │ │
│  │     - Reproducible test cases                      │ │
│  │     - Coverage metrics                             │ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

## Files and Structure

```
validator-history-service/
├── Dockerfile                          # Main application Dockerfile
├── docker-compose.yaml                 # Docker Compose orchestration
├── .dockerignore                       # Docker build exclusions
├── ANTITHESIS.md                       # This file
├── antithesis/
│   ├── README.md                       # Detailed Antithesis setup guide
│   ├── GITHUB_SECRETS.md              # GitHub Actions secrets guide
│   ├── Dockerfile.config              # Config image for Antithesis
│   ├── test_template.sh               # Test template script
│   └── build-and-push.sh              # Build and push helper script
└── .github/
    └── workflows/
        └── antithesis.yml             # GitHub Actions workflow
```

## Local Testing

### Test Without Internet (Antithesis Requirement)

Antithesis runs tests in an isolated environment without internet access. Test this locally:

**On Linux:**
```bash
unshare -n docker-compose up
```

**On macOS/Windows:**
1. Start services: `docker-compose up -d`
2. Disconnect from the internet
3. Verify services still work: `curl http://localhost:3000/v1/health`

### Run Test Template Locally

```bash
# Start services
docker-compose up -d

# Run the test template
docker-compose exec vhs-api /opt/antithesis/test/v1/quickstart/singleton_driver_vhs_test.sh
```

## Deploying to Antithesis

### Manual Deployment

Use the provided build script:

```bash
cd antithesis
./build-and-push.sh <your-tenant-name> <version-tag>
```

Example:
```bash
./build-and-push.sh ripple-labs v1.0.0
```

### Trigger a Test Run

```bash
curl --fail -u 'username:password' \
  -X POST https://<tenant>.antithesis.com/api/v1/launch/basic_test \
  -d '{
    "params": {
      "antithesis.description": "VHS test v1.0.0",
      "antithesis.duration": "60",
      "antithesis.config_image": "us-central1-docker.pkg.dev/molten-verve-216720/<tenant>-repository/vhs-config:v1.0.0",
      "antithesis.images": "us-central1-docker.pkg.dev/molten-verve-216720/<tenant>-repository/validator-history-service:v1.0.0",
      "antithesis.report.recipients": "your-email@example.com"
    }
  }'
```

## CI/CD Integration

### GitHub Actions

The repository includes a GitHub Actions workflow (`.github/workflows/antithesis.yml`) that automatically builds and pushes images on every push to main.

#### Setup

1. Configure GitHub secrets (see `antithesis/GITHUB_SECRETS.md`)
2. Push to main branch or manually trigger the workflow
3. Optionally trigger an Antithesis test run

#### Required Secrets

- `ANTITHESIS_REGISTRY_KEY` - Registry authentication key
- `ANTITHESIS_TENANT` - Your tenant name
- `ANTITHESIS_USER` - Webhook API username
- `ANTITHESIS_PASSWORD` - Webhook API password
- `ANTITHESIS_REPORT_EMAIL` - Email for test reports

## Troubleshooting

### Common Issues

#### Services Not Starting

**Problem:** Services fail to start or crash immediately.

**Solution:**
```bash
# Check logs
docker-compose logs -f

# Check specific service
docker-compose logs vhs-api

# Restart services
docker-compose restart
```

#### Database Connection Errors

**Problem:** Services can't connect to PostgreSQL.

**Solution:**
- Ensure PostgreSQL is healthy: `docker-compose ps`
- Check environment variables in docker-compose.yaml
- Verify network connectivity: `docker-compose exec vhs-api ping postgres`

#### Test Template Not Found

**Problem:** Antithesis can't find the test template.

**Solution:**
- Verify the test script is in the image: `docker-compose exec vhs-api ls -la /opt/antithesis/test/v1/quickstart/`
- Ensure the script is executable: `docker-compose exec vhs-api test -x /opt/antithesis/test/v1/quickstart/singleton_driver_vhs_test.sh`

## Additional Resources

- [Antithesis Documentation](https://antithesis.com/docs)
- [Antithesis Docker Best Practices](https://antithesis.com/docs/best_practices/docker_best_practices)
- [Validator History Service Repository](https://github.com/ripple/validator-history-service)
- [Docker Compose Documentation](https://docs.docker.com/compose/)

