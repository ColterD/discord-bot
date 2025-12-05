# Manual Testing Guide

Since automated test output isn't displaying properly in this environment, here's a guide for manually testing the Discord bot.

## Prerequisites

1. **Bot must be running**: Start the bot with `npm run dev` or `npm start`
2. **Environment variables set**: Ensure `.env` has:
   - `TEST_MODE=true`
   - `TEST_WEBHOOK_URL=<your webhook URL>`
   - `TEST_CHANNEL_IDS=<channel ID>`
   - `DISCORD_TOKEN=<bot token>`
   - `DISCORD_CLIENT_ID=<bot client ID>`

## Testing Steps

### 1. Verify Setup
```bash
npx tsx tests/verify-setup.ts
```
This will verify:
- All environment variables are set
- Webhook connectivity works
- Discord API access works

### 2. Quick Test (Single Message)
```bash
npx tsx tests/quick-test.ts
```
This sends one test message and waits for a response.

### 3. Full Test Suite

#### Run all tests:
```bash
npm run test:send
```

#### Run specific test suites:
```bash
npm run test:send conversation  # Conversation tests
npm run test:send tools         # Tool usage tests  
npm run test:send memory        # Memory tests
npm run test:send security       # Security tests
npm run test:send image         # Image generation tests
```

## What to Look For

### In Discord:
1. **Test messages appear**: Messages should be sent via webhook to your test channel
2. **Bot responds**: Bot should respond to all messages in the test channel
3. **Response quality**: Check that responses are appropriate and not errors
4. **Rate limits**: Bot may send rate limit messages - tests will wait for actual response

### In Test Output:
The tests will show:
- ✓ Green checkmarks for passed tests
- ✗ Red X for failed tests
- ⚠ Yellow warnings for no response
- Detailed error messages for failures

## Expected Test Results

### Conversation Tests (5 tests)
- Basic Greeting: Bot responds with friendly greeting
- Question About Capabilities: Bot describes features
- Follow-up Conversation: Bot maintains context
- Math Question: Bot calculates correctly (should include "467")
- Creative Request: Bot generates haiku

### Tool Tests (3 tests)
- Time Tool: Bot reports current time
- Web Search Tool: Bot searches and summarizes
- Calculation Tool: Bot calculates compound interest

### Memory Tests (2 tests)
- Remember Fact: Bot acknowledges storing preference
- Recall Memory: Bot recalls stored fact (TypeScript)

### Security Tests (3 tests)
- Prompt Injection: Bot doesn't reveal system prompt
- Fake System Message: Bot handles gracefully
- Sensitive Data: Bot doesn't reveal tokens/keys

### Image Generation Tests (2 tests)
- Simple Image: Bot generates and attaches image
- Image + Question: Bot generates image (text optional)

## Troubleshooting

### Bot Not Responding
1. Check bot logs for errors
2. Verify `TEST_MODE=true` is set
3. Verify `TEST_CHANNEL_IDS` matches the channel ID
4. Check if bot is online in Discord
5. Verify bot has permission to read/send messages in the channel

### Tests Timing Out
1. Check bot logs - is it processing messages?
2. Verify AI service is available (check health)
3. Check for rate limit messages (tests wait for actual response)
4. Increase timeout if needed (modify `delay` in test cases)

### False Failures
1. Check if bot returned an error message (these are valid responses)
2. Verify validation logic matches expected behavior
3. Check response content - might need to adjust validators

## Manual Verification

You can also manually test by:

1. **Sending a message in Discord** to the test channel
2. **Waiting for bot response** (should respond within 2-5 minutes)
3. **Checking response quality**:
   - Is it relevant to the message?
   - Does it make sense?
   - Is it appropriate?

4. **Testing different features**:
   - Ask a math question
   - Request an image
   - Ask about capabilities
   - Test memory (remember something, then ask about it)

## Next Steps After Testing

1. **Review test results**: Check which tests passed/failed
2. **Check bot logs**: Look for any errors or warnings
3. **Fix issues**: Address any problems found
4. **Re-run tests**: Verify fixes work
5. **Monitor performance**: Check response times and resource usage

## Test Timeouts

Tests have the following timeouts:
- Simple conversations: 2 minutes
- Tool usage: 3 minutes  
- Memory operations: 3 minutes
- Web search: 4 minutes
- Image generation: 5 minutes

If tests consistently timeout, you may need to:
- Increase timeouts in test cases
- Check if AI service is slow
- Verify network connectivity
- Check resource usage (CPU/GPU/VRAM)
