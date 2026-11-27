# Antithesis Quick Start Guide

Get started with Antithesis testing for the Validator History Service in 5 minutes.

## Prerequisites

- Docker and Docker Compose installed
- Antithesis account credentials
- 10 minutes of your time

## Step 1: Validate Setup (30 seconds)

```bash
./antithesis/validate-setup.sh
```

You should see: `✓ All checks passed! Setup is ready for Antithesis.`

## Step 2: Test Locally (2 minutes)

```bash
# Create environment file
cp .env.example .env

# Edit .env with minimal required values:
# - DB_USER=vhs_user
# - DB_PASSWORD=vhs_password
# - DB_DATABASE=validator_history
# - RIPPLED_RPC_ADMIN=https://xrpl.ws/
# - MAINNET_P2P_ENTRY=s1.ripple.com

# Start services
docker-compose up -d

# Wait for services to be ready (about 30 seconds)
sleep 30

# Test the API
curl http://localhost:3000/v1/health

# You should see a JSON response with connection counts
```

## Step 3: Build Images (3 minutes)

```bash
# Build application image
docker build -t validator-history-service:latest .

# Build config image
docker build -f antithesis/Dockerfile.config -t vhs-config:latest .
```

## Step 4: Push to Antithesis (2 minutes)

### Option A: Using the build script (recommended)

```bash
cd antithesis
./build-and-push.sh <your-tenant-name> v1.0.0
```

### Option B: Manual push

```bash
# Authenticate
cat <tenant-name>.key.json | docker login -u _json_key https://us-central1-docker.pkg.dev --password-stdin

# Tag images
docker tag validator-history-service:latest \
  us-central1-docker.pkg.dev/molten-verve-216720/<tenant>-repository/validator-history-service:v1.0.0

docker tag vhs-config:latest \
  us-central1-docker.pkg.dev/molten-verve-216720/<tenant>-repository/vhs-config:v1.0.0

# Push images
docker push us-central1-docker.pkg.dev/molten-verve-216720/<tenant>-repository/validator-history-service:v1.0.0
docker push us-central1-docker.pkg.dev/molten-verve-216720/<tenant>-repository/vhs-config:v1.0.0
```

## Step 5: Run Test on Antithesis (1 minute)

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

## Step 6: Wait for Results

You'll receive an email with a triage report within an hour. The report will include:

- Any bugs found
- Reproducible test cases
- Coverage metrics
- System behavior analysis

## Next Steps

### Improve Testing

1. **Add Assertions**: Use the Antithesis SDK to add property assertions
2. **Enhance Test Template**: Add more comprehensive test scenarios
3. **Increase Duration**: Run longer tests for deeper exploration

### Automate with CI/CD

1. Set up GitHub secrets (see `GITHUB_SECRETS.md`)
2. Push to main branch to trigger automatic builds
3. Use workflow dispatch to trigger Antithesis tests

### Monitor and Iterate

1. Review triage reports regularly
2. Fix bugs found by Antithesis
3. Add regression tests for fixed bugs
4. Continuously improve test coverage

## Common Issues

### "Services not starting"

**Solution:** Check logs with `docker-compose logs -f`

### "Can't connect to database"

**Solution:** Ensure PostgreSQL is healthy with `docker-compose ps`

### "Authentication failed"

**Solution:** Verify your Antithesis credentials and registry key

### "Test template not found"

**Solution:** Rebuild the Docker image to include the test template

## Getting Help

- **Documentation**: See `ANTITHESIS.md` for comprehensive guide
- **Detailed Setup**: See `README.md` in the antithesis directory
- **GitHub Secrets**: See `GITHUB_SECRETS.md` for CI/CD setup
- **Antithesis Support**: support@antithesis.com
- **VHS Issues**: https://github.com/ripple/validator-history-service/issues

## Useful Commands

```bash
# Validate setup
./antithesis/validate-setup.sh

# Build and push (interactive)
./antithesis/build-and-push.sh <tenant> <version>

# View logs
docker-compose logs -f

# Stop services
docker-compose down

# Clean up
docker-compose down -v  # Also removes volumes

# Rebuild images
docker-compose build --no-cache
```

## Success Checklist

- [ ] Validation script passes
- [ ] Services start locally with docker-compose
- [ ] API responds to health checks
- [ ] Images build successfully
- [ ] Images push to Antithesis registry
- [ ] Test run triggers successfully
- [ ] Triage report received via email

Once all items are checked, you're successfully running Antithesis testing! 🎉

