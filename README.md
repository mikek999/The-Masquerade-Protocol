# The Masquerade Protocol

## Project Description
The Masquerade Protocol is a hardware-agnostic, AI-driven gaming platform designed to bridge the gap between 1980s retro-computing and modern Generative AI. It functions as a "Universal Thin Client" engine, allowing any device capable of opening a raw TCP socket—from an Atari 800XL to a modern web browser—to connect to a shared, high-fidelity narrative world. The platform features high-stakes, time-limited social deduction simulations and a unique "Understudy System" where AI agents seamlessly impersonate and replace disconnected human players.

## Recommended Server Requirements
To run the full stack (Node.js Game Server, SQL Server, and Ollama with Llama 3/Gemini), the following hardware is recommended:

- **OS**: Linux (Ubuntu 22.04+ recommended) with Docker and Docker Compose.
- **CPU**: 4+ Cores (Modern Intel i5/i7 or AMD Ryzen 5/7).
- **RAM**: 16GB minimum (32GB recommended for smooth LLM performance).
- **GPU**: NVIDIA GPU with 8GB+ VRAM (Optional, for local Ollama acceleration).
- **Storage**: 50GB+ SSD (NVMe preferred for SQL Server performance).
- **Network**: Stable broadband with port 80/443 exposed if hosting for remote players. Supports **Traefik** for automatic SSL.

## Prerequisites
- Docker and Docker Compose installed.
- Access to the internet for pulling images and Gemini/OpenRouter APIs.
- (Optional) SQL Server 2025 preview for vector features.

## Starting the System

To start the entire stack (SQL Server, Ollama, and Game Server), run:

```bash
docker-compose up -d
```

## Configuration

### Environment Variables
Configuration is handled via environment variables in `docker-compose.yml`:

| Variable | Description | Default |
| :--- | :--- | :--- |
| `DB_SERVER` | Hostname of the SQL Server | `sqlserver` |
| `DB_PASSWORD` | SA password for SQL Server | `YourStrong!Passw0rd` |
| `PORT` | Listening port for the game server | `443` |

> [!IMPORTANT]
> **AI Keys (Gemini, OpenRouter) are now configured via the Admin UI** (`/admin`) for security and flexibility. Environment variables are only used for the core infrastructure bootstrap.

### Home Lab & Traefik
This project includes pre-configured labels in `docker-compose.yml` for **Traefik**. To enable:
1. Ensure you have a Traefik network (e.g., `web`).
2. Update the labels in `docker-compose.yml` with your domain (e.g., `game.example.com`).

### Tiered AI Support
- **Ollama**: Used for local, zero-cost routine interactions. 
- **OpenRouter**: Set `OPENROUTER_API_KEY` to use cloud-hosted small models (e.g., Mistral, Llama 3) for NPC dialogue when local hardware is limited.
- **Gemini**: Reserved for high-level "Director" tasks and Scenario Generation.

### SQL Server 2025 Features
If running SQL Server 2025, the engine will automatically enable:
- **Vector Search**: Semantic lookup of `WorldFacts` using the `VECTOR` data type.
- **Native JSON**: High-performance querying of Story Packets.

---

### Adding New Scenarios
Use the Admin UI (accessible via `https://localhost/admin`) to prompt Gemini to generate new game scenarios directly into the SQL database.
