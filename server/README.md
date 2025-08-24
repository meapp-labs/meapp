# MeApp Server

This is the server for the MeApp application. It is built with Fastify and uses Redis for session management.

## Prerequisites

- [Bun](https://bun.sh/)
- [Redis](https://redis.io/)

## Available Scripts

- `bun dev`: Start the development server with hot reloading.
- `bun start`: Start the production server.
- `bun test`: Run tests with Vitest.
- `bun test:watch`: Run tests in watch mode.
- `bun format`: Check formatting the code with Prettier.
- `bun format:fix`: Format the code with Prettier.
- `bun lint`: Check linting errors with ESLint.
- `bun lint:fix`: Fix linting errors with ESLint.

## Setup

1.  **Install dependencies:**

    ```bash
    bun install
    ```

2.  **Set up environment variables:**

    Create a `.env.local` file by copying the `.env.example` file:

    ```bash
    cp .env.example .env.local
    ```

    Update the `.env.local` file with your own secret values for `SESSION_SECRET` and `SESSION_SALT`.

3.  **Start Redis:**

    Make sure your Redis server is running. You can start it with:

    ```bash
    redis-server
    ```

4.  **Start the server:**

    ```bash
    bun start
    ```

    The server will be running at `http://localhost:3000`.
