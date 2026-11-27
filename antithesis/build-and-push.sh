#!/usr/bin/env bash
# Build and push Docker images to Antithesis registry
# Usage: ./build-and-push.sh <tenant_name> [version_tag]

set -e

# Check arguments
if [ -z "$1" ]; then
    echo "Usage: $0 <tenant_name> [version_tag]"
    echo "Example: $0 my-company v1.0.0"
    exit 1
fi

TENANT_NAME=$1
VERSION_TAG=${2:-latest}
REGISTRY="us-central1-docker.pkg.dev/molten-verve-216720"
REPOSITORY="$REGISTRY/$TENANT_NAME-repository"

echo "========================================="
echo "Building Antithesis Images"
echo "========================================="
echo "Tenant: $TENANT_NAME"
echo "Version: $VERSION_TAG"
echo "Repository: $REPOSITORY"
echo "========================================="

# Navigate to project root
cd "$(dirname "$0")/.."

# Build the main application image
echo ""
echo "Building validator-history-service image..."
docker build -t validator-history-service:$VERSION_TAG .
echo "✓ Application image built"

# Build the config image
echo ""
echo "Building config image..."
docker build -f antithesis/Dockerfile.config -t vhs-config:$VERSION_TAG .
echo "✓ Config image built"

# Tag images for Antithesis registry
echo ""
echo "Tagging images for Antithesis registry..."
docker tag validator-history-service:$VERSION_TAG \
    $REPOSITORY/validator-history-service:$VERSION_TAG

docker tag vhs-config:$VERSION_TAG \
    $REPOSITORY/vhs-config:$VERSION_TAG

echo "✓ Images tagged"

# Ask for confirmation before pushing
echo ""
read -p "Push images to Antithesis registry? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted. Images are built and tagged locally."
    exit 0
fi

# Push images
echo ""
echo "Pushing validator-history-service image..."
docker push $REPOSITORY/validator-history-service:$VERSION_TAG
echo "✓ Application image pushed"

echo ""
echo "Pushing config image..."
docker push $REPOSITORY/vhs-config:$VERSION_TAG
echo "✓ Config image pushed"

echo ""
echo "========================================="
echo "✓ All images built and pushed successfully!"
echo "========================================="
echo ""
echo "Application image: $REPOSITORY/validator-history-service:$VERSION_TAG"
echo "Config image: $REPOSITORY/vhs-config:$VERSION_TAG"
echo ""
echo "To run a test on Antithesis, use:"
echo ""
echo "curl --fail -u 'user:password' \\"
echo "  -X POST https://$TENANT_NAME.antithesis.com/api/v1/launch/basic_test \\"
echo "  -d '{"
echo "    \"params\": {"
echo "      \"antithesis.description\": \"VHS test $VERSION_TAG\","
echo "      \"antithesis.duration\": \"60\","
echo "      \"antithesis.config_image\": \"$REPOSITORY/vhs-config:$VERSION_TAG\","
echo "      \"antithesis.images\": \"$REPOSITORY/validator-history-service:$VERSION_TAG\","
echo "      \"antithesis.report.recipients\": \"your-email@example.com\""
echo "    }"
echo "  }'"
echo ""

