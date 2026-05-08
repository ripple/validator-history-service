# GitHub Secrets Configuration for Antithesis

To use the GitHub Actions workflow for Antithesis testing, you need to configure the following secrets in your GitHub repository.

## Required Secrets

Navigate to: **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

### 1. ANTITHESIS_REGISTRY_KEY

**Description:** JSON key file for authenticating to the Antithesis container registry.

**Value:** The entire contents of your `<tenant_name>.key.json` file provided by Antithesis.

**Example format:**
```json
{
  "type": "service_account",
  "project_id": "molten-verve-216720",
  "private_key_id": "...",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "...",
  "client_id": "...",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "..."
}
```

### 2. ANTITHESIS_TENANT

**Description:** Your Antithesis tenant name.

**Value:** Your tenant name (e.g., `my-company`)

**Example:** `ripple-labs`

### 3. ANTITHESIS_USER

**Description:** Username for Antithesis webhook API authentication.

**Value:** The username provided by Antithesis for webhook access.

### 4. ANTITHESIS_PASSWORD

**Description:** Password for Antithesis webhook API authentication.

**Value:** The password provided by Antithesis for webhook access.

### 5. ANTITHESIS_REPORT_EMAIL

**Description:** Email address(es) to receive Antithesis test reports.

**Value:** One or more email addresses separated by semicolons.

**Example:** `dev-team@example.com;qa-team@example.com`

## Setting Up Secrets

### Via GitHub Web UI

1. Go to your repository on GitHub
2. Click **Settings** (top menu)
3. In the left sidebar, click **Secrets and variables** → **Actions**
4. Click **New repository secret**
5. Enter the secret name and value
6. Click **Add secret**
7. Repeat for all required secrets

### Via GitHub CLI

```bash
# Install GitHub CLI if not already installed
# https://cli.github.com/

# Authenticate
gh auth login

# Set secrets
gh secret set ANTITHESIS_REGISTRY_KEY < path/to/tenant.key.json
gh secret set ANTITHESIS_TENANT -b "your-tenant-name"
gh secret set ANTITHESIS_USER -b "your-username"
gh secret set ANTITHESIS_PASSWORD -b "your-password"
gh secret set ANTITHESIS_REPORT_EMAIL -b "your-email@example.com"
```

## Verifying Setup

After setting up the secrets, you can verify the workflow by:

1. Going to the **Actions** tab in your repository
2. Selecting the **Antithesis Testing** workflow
3. Clicking **Run workflow**
4. Selecting the branch and options
5. Clicking **Run workflow**

The workflow will build and push images to the Antithesis registry. If you selected "Run Antithesis test after build", it will also trigger a test run.

## Security Notes

- Never commit secrets to your repository
- Regularly rotate credentials
- Use repository secrets (not environment secrets) for sensitive data
- Limit access to repository settings to trusted team members
- Review the Actions logs to ensure secrets are not being exposed

## Troubleshooting

### Authentication Failed

If you see authentication errors:
- Verify the `ANTITHESIS_REGISTRY_KEY` is the complete JSON file
- Check that there are no extra spaces or newlines
- Ensure the key file is still valid (not expired)

### Image Push Failed

If image push fails:
- Verify the `ANTITHESIS_TENANT` name is correct
- Check that your Antithesis account has the necessary permissions
- Ensure the registry URL is correct

### Webhook Failed

If the Antithesis test trigger fails:
- Verify `ANTITHESIS_USER` and `ANTITHESIS_PASSWORD` are correct
- Check that the tenant name in the webhook URL is correct
- Ensure your Antithesis account has webhook access enabled

## Additional Resources

- [GitHub Encrypted Secrets Documentation](https://docs.github.com/en/actions/security-guides/encrypted-secrets)
- [Antithesis Documentation](https://antithesis.com/docs)
- [GitHub CLI Documentation](https://cli.github.com/manual/)

