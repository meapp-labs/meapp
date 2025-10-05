# MeApp - A Communicator

## 🚀 Getting Started

> Information about setting up the client and server can be found in their respective `README.md` files inside the `client/` and `server/` directories.

## Git hooks

Run `git config core.hooksPath .githooks` to add pre-commit hook

## CI/CD

This project uses a GitHub Actions workflow defined in `.github/workflows/cicd.yml` to automate the continuous integration and deployment process.

The pipeline is triggered on every push or pull request to the `main` branch and consists of the following jobs:

- **`detect-changes`**: Determines whether changes were made to the `client` or `server` directories.
- **`client`**: If changes are detected in the `client` directory, this job will:
  1.  Install dependencies.
  2.  Run linting and formatting checks.
  3.  Build the web application.
  4.  Deploy the build to the remote server using `rsync` on push to `main`.
- **`server`**: If changes are detected in the `server` directory, this job will:
  1.  Install dependencies.
  2.  Run linting, formatting, and tests.
  3.  Deploy the application to the remote server using `rsync` on push to `main`.
  4.  The server is managed by `pm2` on the remote machine.

The deployment process relies on GitHub secrets and variables to be set up in the repository for secure access to the remote server and for environment configuration.

---

_This project is currently under active development._
