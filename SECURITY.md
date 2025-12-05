# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| latest  | :white_check_mark: |

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability, please report it responsibly.

### How to Report

1. **Do NOT** open a public GitHub issue for security vulnerabilities
2. Use GitHub's [Private Vulnerability Reporting](https://github.com/ColterD/discord-bot/security/advisories/new) feature
3. Alternatively, contact the maintainers directly

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response Timeline

- **Initial Response**: Within 48 hours
- **Status Update**: Within 7 days
- **Resolution Target**: Within 30 days for critical issues

## Security Architecture

### Four-Tier Tool Permission System

| Tier       | Access Level           | Examples                                     |
| ---------- | ---------------------- | -------------------------------------------- |
| Owner-only | Bot owner exclusively  | `filesystem_*`, `execute_command`, `shell`   |
| Restricted | Hidden from non-owners | `code_interpreter`, `admin_*`, `mcp_restart` |
| Elevated   | Visible but may deny   | `database_*`, `memory_edit`                  |
| Public     | Available to all users | `web_search`, `calculate`, `get_time`        |

### Multi-Layer Security

1. **Impersonation Detection**
   - Pattern matching for common attack phrases
   - Name similarity analysis
   - Semantic analysis of intent

2. **Prompt Injection Protection**
   - Multi-layer detection for jailbreak attempts
   - Input sanitization and validation
   - PII detection and filtering

3. **Tool Abuse Prevention**
   - Validates tool requests for malicious patterns
   - Path traversal protection
   - Command injection blocking
   - SQL injection prevention

4. **LLM Output Validation**
   - Filters responses for security leaks
   - Token leak detection
   - Webhook URL blocking
   - Private information filtering

### Docker Security Hardening

- Read-only root filesystem
- Non-root user execution (UID 1000)
- All Linux capabilities dropped
- `no-new-privileges` security option
- Resource limits (1 CPU, 1GB RAM)
- Isolated Docker network
- Volume mounts limited to logs only

## Security Measures

This project implements the following security measures:

- **Static Analysis**: CodeQL, Semgrep, and Snyk for code scanning
- **Dependency Scanning**: Dependabot, npm audit, and dependency review
- **Secret Scanning**: Gitleaks and GitHub secret scanning
- **Container Security**: Trivy scanning with SBOM generation
- **Supply Chain Security**: SLSA provenance and container signing

## Security Best Practices for Contributors

1. Never commit secrets, tokens, or credentials
2. Keep dependencies up to date
3. Follow secure coding guidelines
4. Review security alerts promptly
5. Use signed commits when possible
6. Run `npm audit` before pushing changes
7. Test security features with `npm run test:security`

## Environment Variables Security

- Store all secrets in `.env` (never commit this file)
- Use `.env.example` as a template without real values
- Rotate `DISCORD_TOKEN` if compromised
- Use separate tokens for development and production

## Acknowledgments

We appreciate responsible disclosure and will acknowledge security researchers who help improve our security.
