# Testing Documentation

## Overview

Comprehensive test suite for the event-driven backend system, covering:
- Event schema validation
- Event processing and storage
- Leaderboard aggregation
- Prize calculation
- API endpoints
- Full integration flows

## Test Structure

```
railway-backend/
├── tests/
│   ├── setup.js                    # Jest configuration
│   ├── unit/                       # Unit tests
│   │   ├── event-schemas.test.js
│   │   ├── event-processor.test.js
│   │   ├── leaderboard-aggregator.test.js
│   │   ├── prize-calculator.test.js
│   └── integration/                # Integration tests
│       └── event-system.test.js
└── jest.config.json                # Jest configuration
```

## Running Tests

### All Tests
```bash
npm test
```

### Unit Tests Only
```bash
npm run test:unit
```

### Integration Tests Only
```bash
npm run test:integration
```

### Event System Tests
```bash
npm run test:events         # Event schemas + processor
npm run test:leaderboard    # Leaderboard aggregator
npm run test:prizes         # Prize calculator
```

### Coverage Report
```bash
npm run test:coverage
```

### Watch Mode (for development)
```bash
npm run test:watch
```

### CI/CD Mode
```bash
npm run test:ci
```

## Test Coverage

### Unit Tests (4 files, 60+ tests)

#### 1. Event Schemas (`event-schemas.test.js`)
Tests Joi validation for all 28 event types:
- ✅ `app_installed` - Installation tracking
- ✅ `app_launched` - Session start
- ✅ `game_started` - Game session start
- ✅ `game_ended` - Game completion with score
- ✅ `level_started` - Story mode level start
- ✅ `level_completed` - Story mode level completion
- ✅ `level_failed` - Story mode level failure
- ✅ `continue_used` - Continue purchase tracking
- ✅ `currency_earned` - Coins/gems earned tracking
- ✅ `currency_spent` - Coins/gems spending tracking
- ✅ `mission_completed` - Daily mission completion
- ✅ `achievement_unlocked` - Achievement unlock
- ✅ `tournament_entered` - Tournament participation
- ✅ And 15 more...

**Coverage:**
- Valid event validation
- Missing required fields rejection
- Invalid data type rejection
- Boundary testing (negative scores, invalid enums, etc.)

#### 2. Event Processor (`event-processor.test.js`)
Tests event processing logic:
- ✅ Valid event storage in database
- ✅ Invalid event rejection
- ✅ Unknown event type handling
- ✅ Database error handling
- ✅ Batch event processing
- ✅ Statistics tracking

#### 3. Leaderboard Aggregator (`leaderboard-aggregator.test.js`)
Tests leaderboard update logic:
- ✅ Process `game_ended` events
- ✅ Update global leaderboard (high score tracking)
- ✅ Update tournament leaderboard (best score per tournament)
- ✅ Cache invalidation
- ✅ Empty event queue handling
- ✅ Score comparison (only update if higher)
- ✅ Tournament mode filtering
- ✅ Error handling

#### 4. Prize Calculator (`prize-calculator.test.js`)
Tests prize distribution:
- ✅ Prize pool configuration (5 tiers, top 50)
- ✅ Rank-based prize calculation
  - Rank 1: 5000 coins + 250 gems
  - Rank 2: 3000 coins + 150 gems
  - Rank 3: 2000 coins + 100 gems
  - Rank 4-10: 1000 coins + 50 gems
  - Rank 11-50: 500 coins + 25 gems
- ✅ Tournament prize calculation (top 50 winners)
- ✅ Duplicate prize prevention
- ✅ No participants handling
- ✅ Database error handling
- ✅ Weekly prize processing

### Integration Tests (`event-system.test.js`)

Tests full API flows:

#### Event Ingestion
- ✅ `POST /api/events` - Batch event submission
- ✅ Invalid event handling
- ✅ Fire-and-forget pattern

#### Global Leaderboard
- ✅ `GET /api/v2/leaderboard/global` - Top 15 with nicknames
- ✅ `GET /api/v2/leaderboard/user/:userId` - User rank lookup
- ✅ `POST /api/v2/leaderboard/update-nickname` - Nickname update
- ✅ Nickname validation (3-20 chars, alphanumeric + spaces)

#### Tournament Leaderboard
- ✅ `GET /api/v2/tournaments/current` - Current tournament info
- ✅ `GET /api/v2/tournaments/:id/leaderboard` - Top 15 with prize tiers
- ✅ `GET /api/v2/tournaments/:id/prizes` - Prize pool info

#### Prize System
- ✅ `GET /api/v2/prizes/pending` - Poll for unclaimed prizes
- ✅ `POST /api/v2/prizes/claim` - Fire-and-forget claim
- ✅ `GET /api/v2/prizes/history` - Prize history
- ✅ `GET /api/v2/prizes/stats` - Prize statistics

#### Full Flow Test
- ✅ Game → Event → Leaderboard → Prize (end-to-end)

## Test Environment

### Prerequisites
```bash
# Install dependencies
npm install

# Set up test database (optional, uses mocks by default)
export TEST_DATABASE_URL="postgresql://test:test@localhost:5432/flappyjet_test"
```

### Environment Variables
```env
NODE_ENV=test
TEST_DATABASE_URL=postgresql://test:test@localhost:5432/flappyjet_test
```

## Mocking Strategy

### Database Mocking
All unit tests use Jest mocks for database operations:
```javascript
const mockDb = {
  query: jest.fn()
};
```

### Logger Mocking
Logger is globally mocked to reduce test noise:
```javascript
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));
```

### Integration Tests
Integration tests use `supertest` to test actual API endpoints without mocking.

## Coverage Goals

- **Unit Tests:** 90%+ coverage
- **Integration Tests:** All critical paths
- **Edge Cases:** Comprehensive error handling

## Running Tests in CI/CD

GitHub Actions / Railway:
```yaml
- name: Run tests
  run: npm run test:ci
  
- name: Upload coverage
  uses: codecov/codecov-action@v3
```

## Debugging Tests

### Run specific test file
```bash
npx jest tests/unit/event-schemas.test.js
```

### Run specific test
```bash
npx jest -t "should validate correct app_installed event"
```

### Verbose output
```bash
npm test -- --verbose
```

### Watch mode for TDD
```bash
npm run test:watch
```

## Test Maintenance

### Adding New Events
1. Add schema to `services/event-schemas.js`
2. Add tests to `tests/unit/event-schemas.test.js`
3. Update processor tests if needed

### Adding New API Endpoints
1. Implement endpoint in `routes/`
2. Add integration tests to `tests/integration/event-system.test.js`

### Updating Prize Pool
1. Update `PrizeCalculator.getPrizePool()`
2. Update tests in `tests/unit/prize-calculator.test.js`
3. Update integration tests to match new prizes

## Success Criteria

✅ All tests pass
✅ 90%+ code coverage
✅ No console errors or warnings
✅ All API endpoints tested
✅ All event types validated
✅ Full flow integration tested

## Test Results

Run `npm run test:coverage` to generate:
- Console summary
- HTML report in `coverage/` directory
- Coverage badge data

## Next Steps

After tests pass:
1. ✅ Deploy to Railway staging
2. ✅ Run smoke tests
3. ✅ Monitor logs for errors
4. ✅ Deploy to production
5. ✅ Monitor analytics dashboards

---

**Last Updated:** Phase 6 complete
**Test Coverage:** 60+ tests across 5 files
**Status:** ✅ Ready for deployment

