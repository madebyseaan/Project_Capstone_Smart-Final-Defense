# GLOBAL CONTEXT: Real-time Subsystem Synchronization (Tailscale + Redis + SSE)

## 1. System Architecture
This is a distributed microservices environment where subsystems (EnrollPro, ATLAS, AIMS, SMART) reside on different developer laptops connected via a **Tailscale Tailnet**. 

*   **Central Event Hub:** A single Redis instance running on a "Hub Laptop" reachable via Tailscale IP (e.g., `100.x.y.z`).
*   **Subsystem Responsibility:**
    *   **Publishers:** Services that own a "Source of Truth" (e.g., EnrollPro for Auth, ATLAS for Scheduling) must publish events to Redis when data changes.
    *   **Subscribers:** Services that depend on other data (e.g., AIMS, SMART) must subscribe to Redis channels and forward events to the browser via SSE.

## 2. Event Protocol (Standardized Schema)
All events published to the Redis bus must follow this JSON structure:
```json
{
  "source": "enrollpro | atlas | aims | smart",
  "type": "USER_UPDATED | AUTH_EXPIRED | SCHEDULE_CHANGED | GRADE_POSTED",
  "payload": { ... },
  "timestamp": "2026-05-14T..."
}
```

## 3. Backend Implementation Mandate
### A. The Redis Connection
Every service must maintain a persistent connection to the Tailscale Redis instance using `ioredis`. 
*   Use environment variables for `REDIS_HOST` (Tailscale IP) and `REDIS_PASSWORD`.

### B. The SSE Endpoint (`/api/v1/events`)
Every service must expose a standard SSE route that:
1.  Sets `Content-Type: text/event-stream`.
2.  Subscribes to the relevant Redis channels.
3.  Writes data to the stream whenever a Redis message is received.
4.  Sends a "heartbeat" comment every 30 seconds to keep the Tailscale tunnel alive.

## 4. Hierarchy of Dependencies (The Waterfall)
AI Agents should respect this data flow:
1.  **EnrollPro (Top):** Publishes Auth/Identity events.
2.  **ATLAS (Middle):** Subscribes to EnrollPro; Publishes Scheduling events.
3.  **AIMS/SMART (Bottom):** Subscribes to both EnrollPro and ATLAS; Updates UI via SSE.

## 5. Panel Defense Context
The goal of this implementation is to demonstrate "Distributed Integrity." Even though databases are isolated on different laptops, the system must "feel" like a single unified platform where a change in one tab updates all other tabs instantly without manual polling.
