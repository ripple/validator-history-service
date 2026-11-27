#!/usr/bin/env bash
# Validate Antithesis setup for validator-history-service
# This script checks that all required files are in place and properly configured

set -e

echo "========================================="
echo "Antithesis Setup Validation"
echo "========================================="
echo ""

ERRORS=0
WARNINGS=0

# Function to check if file exists
check_file() {
    if [ -f "$1" ]; then
        echo "✓ Found: $1"
    else
        echo "✗ Missing: $1"
        ERRORS=$((ERRORS + 1))
    fi
}

# Function to check if file is executable
check_executable() {
    if [ -x "$1" ]; then
        echo "✓ Executable: $1"
    else
        echo "⚠ Not executable: $1"
        WARNINGS=$((WARNINGS + 1))
    fi
}

# Navigate to project root
cd "$(dirname "$0")/.."

echo "Checking required files..."
echo ""

# Check Dockerfiles
check_file "Dockerfile"
check_file "antithesis/Dockerfile.config"
check_file ".dockerignore"

echo ""

# Check Docker Compose
check_file "docker-compose.yaml"

echo ""

# Check scripts
check_file "antithesis/test_template.sh"
check_file "antithesis/build-and-push.sh"
check_executable "antithesis/test_template.sh"
check_executable "antithesis/build-and-push.sh"

echo ""

# Check documentation
check_file "ANTITHESIS.md"
check_file "antithesis/README.md"
check_file "antithesis/GITHUB_SECRETS.md"

echo ""

# Check GitHub workflow
check_file ".github/workflows/antithesis.yml"

echo ""
echo "Checking Dockerfile content..."

# Check if test template is copied in Dockerfile
if grep -q "singleton_driver_vhs_test.sh" Dockerfile; then
    echo "✓ Test template is included in Dockerfile"
else
    echo "✗ Test template not found in Dockerfile"
    ERRORS=$((ERRORS + 1))
fi

# Check if Antithesis directory is created
if grep -q "/opt/antithesis/test/v1/quickstart" Dockerfile; then
    echo "✓ Antithesis test directory is created in Dockerfile"
else
    echo "✗ Antithesis test directory not found in Dockerfile"
    ERRORS=$((ERRORS + 1))
fi

echo ""
echo "Checking docker-compose.yaml content..."

# Check if postgres service exists
if grep -q "postgres:" docker-compose.yaml; then
    echo "✓ PostgreSQL service defined"
else
    echo "✗ PostgreSQL service not found"
    ERRORS=$((ERRORS + 1))
fi

# Check if vhs-api service exists
if grep -q "vhs-api:" docker-compose.yaml; then
    echo "✓ VHS API service defined"
else
    echo "✗ VHS API service not found"
    ERRORS=$((ERRORS + 1))
fi

# Check if vhs-connections service exists
if grep -q "vhs-connections:" docker-compose.yaml; then
    echo "✓ VHS Connections service defined"
else
    echo "✗ VHS Connections service not found"
    ERRORS=$((ERRORS + 1))
fi

# Check if vhs-crawler service exists
if grep -q "vhs-crawler:" docker-compose.yaml; then
    echo "✓ VHS Crawler service defined"
else
    echo "✗ VHS Crawler service not found"
    ERRORS=$((ERRORS + 1))
fi

echo ""
echo "Checking test template content..."

# Check if test template has shebang
if head -n 1 antithesis/test_template.sh | grep -q "#!/usr/bin/env bash"; then
    echo "✓ Test template has proper shebang"
else
    echo "✗ Test template missing shebang"
    ERRORS=$((ERRORS + 1))
fi

# Check if test template emits setup_complete
if grep -q "antithesis_setup" antithesis/test_template.sh; then
    echo "✓ Test template emits setup_complete signal"
else
    echo "✗ Test template doesn't emit setup_complete signal"
    ERRORS=$((ERRORS + 1))
fi

echo ""
echo "========================================="
echo "Validation Summary"
echo "========================================="
echo "Errors: $ERRORS"
echo "Warnings: $WARNINGS"
echo ""

if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    echo "✓ All checks passed! Setup is ready for Antithesis."
    exit 0
elif [ $ERRORS -eq 0 ]; then
    echo "⚠ Setup is mostly ready, but there are some warnings."
    echo "  Review the warnings above and fix if necessary."
    exit 0
else
    echo "✗ Setup has errors that need to be fixed."
    echo "  Review the errors above and fix them before proceeding."
    exit 1
fi

