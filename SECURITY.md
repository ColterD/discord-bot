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

### Security Measures

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

## Acknowledgments

We appreciate responsible disclosure and will acknowledge security researchers who help improve our security.
