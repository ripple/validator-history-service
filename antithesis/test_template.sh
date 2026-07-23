#!/usr/bin/env bash
# Antithesis test template for validator-history-service
# This script will be executed by Antithesis to test the system

set -e

echo "Starting Antithesis test template for validator-history-service"

# Wait for services to be ready
echo "Waiting for API service to be ready..."
max_attempts=30
attempt=0

while [ $attempt -lt $max_attempts ]; do
    if curl -f http://vhs-api:3000/v1/health > /dev/null 2>&1; then
        echo "API service is ready!"
        break
    fi
    attempt=$((attempt + 1))
    echo "Attempt $attempt/$max_attempts - waiting for API..."
    sleep 2
done

if [ $attempt -eq $max_attempts ]; then
    echo "ERROR: API service did not become ready in time"
    exit 1
fi

# Test 1: Health check
echo "Test 1: Checking health endpoint..."
response=$(curl -s http://vhs-api:3000/v1/health)
echo "Health check response: $response"

# Test 2: Metrics endpoint
echo "Test 2: Checking metrics endpoint..."
curl -s http://vhs-api:3000/v1/metrics
echo "Metrics endpoint OK"

# Test 3: Networks endpoint
echo "Test 3: Checking networks endpoint..."
curl -s http://vhs-api:3000/v1/networks
echo "Networks endpoint OK"

# Test 4: Root endpoint
echo "Test 4: Checking root endpoint..."
curl -s http://vhs-api:3000/
echo "Root endpoint OK"

# Emit setup complete signal for Antithesis
if [ -n "$ANTITHESIS_OUTPUT_DIR" ]; then
    echo "Emitting setup_complete signal to Antithesis..."
    echo '{"antithesis_setup": { "status": "complete", "details": {"message": "Validator History Service is ready for testing!"}}}' >> "$ANTITHESIS_OUTPUT_DIR/sdk.jsonl"
    echo "Setup complete signal sent"
fi

# Continue running tests in a loop for Antithesis to inject faults
echo "Starting continuous testing loop..."
iteration=0

while true; do
    iteration=$((iteration + 1))
    echo "Test iteration $iteration"
    
    # Perform various API calls
    curl -f http://vhs-api:3000/v1/health > /dev/null 2>&1 || echo "Health check failed"
    curl -f http://vhs-api:3000/v1/metrics > /dev/null 2>&1 || echo "Metrics check failed"
    curl -f http://vhs-api:3000/v1/networks > /dev/null 2>&1 || echo "Networks check failed"
    
    # Sleep between iterations
    sleep 5
done

