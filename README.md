# PlayerTXT

## Project Description
**PlayerTXT** is a hardware-agnostic, AI-driven gaming platform designed to bridge the gap between 1980s retro-computing and modern Generative AI. It functions as a "Universal Thin Client" engine, allowing any device capable of opening a raw TCP socket—from an Atari 800XL to a modern web browser—to connect to a shared, high-fidelity narrative world. The platform features high-stakes, time-limited social deduction simulations and a unique "Understudy System" where AI agents seamlessly impersonate and replace disconnected human players.

Official website: [playertxt.org](https://playertxt.org)

## Recommended Server Requirements
To run the full stack (Node.js Game Server, SQL Server, and Ollama with Llama 3/Gemini), the following hardware is recommended:

- **OS**: Linux (Ubuntu 22.04+ recommended) with Docker and Docker Compose.
- **CPU**: 4+ Cores (Modern Intel i5/i7 or AMD Ryzen 5/7).
- **RAM**: 16GB minimum (32GB recommended for smooth LLM performance).
- **GPU**: NVIDIA GPU with 8GB+ VRAM (Optional, for local Ollama acceleration).
- **Storage**: 50GB+ SSD (NVMe preferred for SQL Server 2025 performance).
- **Network**: Stable broadband with port 80/443 exposed if hosting for remote players. Supports **Traefik** for automatic SSL.

## Prerequisites
- Docker and Docker Compose installed.
- Access to the internet for pulling images and Gemini/OpenRouter APIs.
- SQL Server 2025 installed (or via Docker).

## Starting the System

To start the entire stack (SQL Server 2025, Ollama, and Game Server), run:

```bash
docker-compose up -d
```

## Configuration

### Admin Access
The Admin UI is accessible via `http://localhost/admin`.

- **Default Password**: `PlayerTXT2026!`

### Environment Variables
Configuration is handled via environment variables in `docker-compose.yml`:

| Variable | Description | Default |
| :--- | :--- | :--- |
| `DB_SERVER` | Hostname of the SQL Server | `sqlserver` |
| `DB_PASSWORD` | SA password for SQL Server | `PlayerTXT2026!` |
| `PORT` | Listening port for the game server | `80` |
| `ADMIN_PASSWORD` | Access key for the admin UI | `PlayerTXT2026!` |

> [!IMPORTANT]
> **AI Keys (Gemini, OpenRouter) are now configured via the Admin UI** (`/admin`) for security and flexibility. Environment variables are only used for the core infrastructure bootstrap.

### Credits
Created by **Mike Kelley**.  
Built using **Google Gemini** and **Google Antigravity** with **Microsoft SQL Server 2025**.

---

### Open Source Licensing
&copy; 2026 PlayerTXT. Released under Open Source License.
