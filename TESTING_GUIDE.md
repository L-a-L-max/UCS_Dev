# UCS (Unmanned Control System) - Testing Guide

## Service Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Frontend    │────▶│  Backend    │────▶│  PostgreSQL  │
│  (Vite+React)│     │ (Spring Boot)│     │  Database    │
│  Port: 5173  │     │  Port: 8080  │     │  Port: 5432  │
└─────────────┘     └──────┬──────┘     └─────────────┘
                           │
                    ┌──────┴──────┐     ┌─────────────┐
                    │   Redis     │     │   Zenoh      │
                    │  Port: 6379 │     │  (DDS Bridge)│
                    └─────────────┘     └─────────────┘
```

## 1. Service Configuration

### 1.1 PostgreSQL Database (Production)

```bash
# Install PostgreSQL
sudo apt install postgresql postgresql-contrib

# Create database and user
sudo -u postgres psql
CREATE DATABASE ucs_db;
CREATE USER ucs_user WITH PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE ucs_db TO ucs_user;
\q
```

Environment variables for production:
```bash
export DB_HOST=localhost
export DB_PORT=5432
export DB_NAME=ucs_db
export DB_USERNAME=ucs_user
export DB_PASSWORD=your_secure_password
```

### 1.2 H2 Database (Development)

For development, the project uses H2 in-memory database by default (no configuration needed).
Access H2 Console at: `http://localhost:8080/h2-console`
- JDBC URL: `jdbc:h2:mem:ucs_dev`
- Username: `sa`
- Password: (empty)

### 1.3 Redis

```bash
# Install Redis
sudo apt install redis-server

# Start Redis
sudo systemctl start redis-server

# Verify
redis-cli ping  # Should return PONG
```

Environment variables:
```bash
export REDIS_HOST=localhost
export REDIS_PORT=6379
# export REDIS_PASSWORD=your_redis_password  # If password is set
```

### 1.4 JWT Configuration

```bash
export JWT_SECRET=your_jwt_secret_key_at_least_64_characters_long_for_HS512_algorithm
```

### 1.5 Zenoh (Optional - for real drone communication)

```bash
export ZENOH_ENABLED=true
# Zenoh router runs on default port 7447
```

## 2. Service Startup Process

### Startup Order

```
1. PostgreSQL (or use H2 for dev)
2. Redis
3. Backend (Spring Boot)
4. Frontend (Vite dev server)
5. Zenoh Router (optional, for drone communication)
```

### 2.1 Start Backend

```bash
cd backend/

# Development mode (H2 + embedded Redis)
./mvnw spring-boot:run

# Production mode (PostgreSQL + Redis)
./mvnw spring-boot:run -Dspring-boot.run.profiles=prod

# Or build and run JAR
./mvnw clean package -DskipTests
java -jar target/ucs-backend-1.0.0.jar --spring.profiles.active=prod
```

Backend will start on `http://localhost:8080`

### 2.2 Start Frontend

```bash
cd frontend/ucs-dashboard/

# Install dependencies
npm install

# Development mode
npm run dev
# Frontend available at http://localhost:5173

# Production build
npm run build
npm run preview
```

### 2.3 Start Zenoh Router (Optional)

```bash
# If Zenoh is installed
zenohd -c zenoh-config.json
```

## 3. Test Execution Scripts

### 3.1 Quick Smoke Test

```bash
#!/bin/bash
# smoke-test.sh - Quick verification of all services

echo "=== UCS Smoke Test ==="

# 1. Check backend health
echo "[1/4] Checking backend..."
curl -s http://localhost:8080/actuator/health | grep -q "UP" && echo "  Backend: OK" || echo "  Backend: FAILED"

# 2. Check frontend
echo "[2/4] Checking frontend..."
curl -s http://localhost:5173 | grep -q "UCS" && echo "  Frontend: OK" || echo "  Frontend: FAILED"

# 3. Check Redis
echo "[3/4] Checking Redis..."
redis-cli ping | grep -q "PONG" && echo "  Redis: OK" || echo "  Redis: FAILED"

# 4. Test login
echo "[4/4] Testing login..."
TOKEN=$(curl -s -X POST http://localhost:8080/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
[ -n "$TOKEN" ] && echo "  Login: OK (token received)" || echo "  Login: FAILED"

echo "=== Smoke Test Complete ==="
```

### 3.2 Backend Unit Tests

```bash
cd backend/
./mvnw test
```

### 3.3 Frontend Lint & Type Check

```bash
cd frontend/ucs-dashboard/
npm run lint      # ESLint check
npm run build     # TypeScript compilation + Vite build (includes tsc -b)
```

## 4. Testing Each Fix (Issues #1-#8)

### Issue #1: Observer Interface for All Roles

**Test Steps:**
1. Login as each role (Commander, Leader, Pilot)
2. Verify each role's view loads correctly
3. All views should display drone data in tables/cards

**Expected:** Each role sees their appropriate drone overview.

### Issue #2: Commander Team Management Shows Data

**Test Steps:**
1. Login as Commander (role: COMMANDER)
2. Navigate to "Team Management" tab (团队管理)
3. Verify teams are listed with team name, leader, member count

**API Test:**
```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/api/v1/commander/teams
```

**Expected:** Returns list of all teams (not "暂无团队数据").

### Issue #3: Fleet Overview Shows Detailed Info

**Test Steps:**
1. Login as Commander
2. Navigate to "Fleet Overview" tab (机队总览)
3. Verify table shows columns: UAV ID, Model, Status, Battery, Altitude, Position, Owner (归属人), Controller (控制员), Team (团队)

**API Test:**
```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/api/v1/commander/fleet
```

**Expected:** Each drone entry includes `teamName`, `ownerName`, `controllerName`.

### Issue #4: Permission Transfer to Teams

**Test Steps:**
1. Login as Commander
2. Go to "Permission Management" (权限管理) tab
3. Select drones, choose "Transfer to Team" (转移至队伍) mode
4. Select a team from dropdown
5. Confirm transfer

**API Test:**
```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"uavIds":["UAV-001"],"toTeamId":1}' \
  http://localhost:8080/api/v1/commander/permission/transfer-to-team
```

**Expected:** Drone control is assigned to the team leader. Operation log recorded.

### Issue #5: Human-Readable Operation Logs

**Test Steps:**
1. Perform any control command (ARM, TAKEOFF, GOTO, etc.)
2. Check operation logs tab
3. Verify "Detail" column shows Chinese descriptions

**Expected Log Formats:**
- ARM: `解锁电机 [UAV-001]`
- TAKEOFF: `起飞至 50.0米 [UAV-001]`
- GOTO: `飞往坐标 (39.9042, 116.4074) 高度50.0米 [UAV-001]`
- Permission Transfer: `控制权转移: 张三 → 李四`

**NOT Expected:** Raw JSON like `{"commandType":"ARM","params":{},"published":true}`

### Issue #6: PostgreSQL Database Support

**Test Steps:**
1. Start backend with production profile: `--spring.profiles.active=prod`
2. Verify it connects to PostgreSQL
3. Check data persists after restart

**Configuration File:** `backend/src/main/resources/application-prod.properties`

**Expected:** Backend uses PostgreSQL with HikariCP connection pool, Redis for caching.

### Issue #7: Team Leader Interface Improvements

**Test Steps:**
1. Login as Team Leader (role: LEADER)
2. Verify "Drones" tab shows only team-assigned drones
3. Verify "Members" tab shows team member list with IDs
4. Verify "Logs" tab shows only team members' operation logs
5. Test drone transfer within team: click "Transfer" button on a drone row

**API Tests:**
```bash
# Team drones
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/api/v1/leader/uav/list

# Team logs
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/api/v1/leader/team/logs

# Intra-team transfer
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"uavIds":["UAV-001"],"toUserId":5}' \
  http://localhost:8080/api/v1/leader/uav/transfer
```

**Expected:** All data is scoped to the leader's team only.

### Issue #8: Pilot Permission Isolation

**Test Steps:**
1. Login as Pilot (role: PILOT)
2. Verify left panel shows only authorized drones (not all 8)
3. Verify pilot can only control drones assigned to them

**API Test:**
```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/api/v1/pilot/uav/list
```

**Expected:** Returns only drones where the current pilot has ownership/control permission.

## 5. User Accounts for Testing

| Role       | Username    | Password   | Description         |
|-----------|------------|------------|---------------------|
| Commander | commander1 | password   | System commander    |
| Leader    | leader1    | password   | Team 1 leader       |
| Pilot     | pilot1     | password   | Team 1 pilot        |
| Pilot     | pilot2     | password   | Team 1 pilot        |
| Admin     | admin      | admin123   | System admin        |

> Note: Default accounts are initialized via `data.sql`. Adjust credentials as needed.

## 6. Troubleshooting

### Backend won't start
- Check Java 17+ is installed: `java -version`
- Check PostgreSQL is running: `sudo systemctl status postgresql`
- Check Redis is running: `redis-cli ping`
- Review logs: `./mvnw spring-boot:run 2>&1 | tail -50`

### Frontend build errors
- Clear node_modules: `rm -rf node_modules && npm install`
- Check Node.js version: `node -v` (requires 18+)

### Redis connection refused
- Start Redis: `sudo systemctl start redis-server`
- Check port: `redis-cli -h localhost -p 6379 ping`

### Database migration issues
- H2 auto-creates tables via JPA `ddl-auto=update`
- For PostgreSQL, tables are auto-generated on first run with `ddl-auto=update`
- Check `application-prod.properties` for connection settings
