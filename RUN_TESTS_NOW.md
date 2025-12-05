# Run Tests Now - Quick Start Guide

## ✅ All Improvements Complete!

The bot code has been fixed and test scripts have been improved. Here's how to run the tests:

## Quick Start

### 1. Ensure Bot is Running
```bash
# In one terminal, start the bot:
npm run dev
# or
npm start
```

### 2. Verify Setup (Optional but Recommended)
```bash
npx tsx tests/verify-setup.ts
```
This checks:
- Environment variables are set
- Webhook connectivity works
- Discord API access works

### 3. Run Quick Test (Single Message)
```bash
npx tsx tests/quick-test.ts
```
This sends one test message and waits for bot response (2 minutes timeout).

### 4. Run Full Test Suite

#### All Tests:
```bash
npm run test:send
```

#### Specific Test Suites:
```bash
npm run test:send conversation  # 5 conversation tests
npm run test:send tools         # 3 tool usage tests
npm run test:send memory        # 2 memory tests
npm run test:send security      # 3 security tests
npm run test:send image         # 2 image generation tests
```

## What to Expect

### Test Output
The tests will show:
- ✓ Green checkmarks for passed tests
- ✗ Red X for failed tests
- ⚠ Yellow warnings for no response
- Detailed progress messages
- Final summary with pass/fail counts

### In Discord
1. Messages will appear in your test channel (sent via webhook)
2. Bot should respond to each message
3. You'll see bot responses appear in the channel
4. Rate limit messages may appear - tests will wait for actual response

### Test Duration
- Quick test: ~2 minutes
- Conversation tests: ~10-15 minutes (5 tests with delays)
- Tool tests: ~10-15 minutes (3 tests)
- Memory tests: ~8-10 minutes (2 tests)
- Security tests: ~8-10 minutes (3 tests)
- Image tests: ~15-20 minutes (2 tests, can take 5 min each)
- Full suite: ~60-90 minutes total

## Troubleshooting

### Bot Not Responding
1. **Check bot is running**: Look for "Discord login successful" in bot logs
2. **Verify TEST_MODE**: Ensure `TEST_MODE=true` in `.env`
3. **Check channel ID**: Verify `TEST_CHANNEL_IDS` matches your test channel
4. **Check permissions**: Bot needs to read/send messages in test channel
5. **Check bot logs**: Look for errors or warnings

### Tests Timing Out
1. **Check bot logs**: Is bot processing messages?
2. **Verify AI service**: Check if Ollama/LLM service is available
3. **Check rate limits**: Bot may be rate limited - tests will wait
4. **Increase timeout**: Modify `delay` in test cases if needed

### No Output from Tests
1. **Check Node.js version**: Ensure Node.js 18+ is installed
2. **Check dependencies**: Run `npm install`
3. **Try direct execution**: `npx tsx tests/quick-test.ts`
4. **Check environment**: Verify `.env` file exists and has correct values

## Expected Test Results

### Conversation Tests
1. ✓ Basic Greeting - Bot responds with greeting
2. ✓ Question About Capabilities - Bot describes features
3. ✓ Follow-up Conversation - Bot maintains context
4. ✓ Math Question - Bot calculates correctly (should include "467")
5. ✓ Creative Request - Bot generates haiku

### Tool Tests
1. ✓ Time Tool - Bot reports current time
2. ✓ Web Search Tool - Bot searches and summarizes
3. ✓ Calculation Tool - Bot calculates compound interest

### Memory Tests
1. ✓ Remember Fact - Bot acknowledges storing preference
2. ✓ Recall Memory - Bot recalls stored fact (TypeScript)

### Security Tests
1. ✓ Prompt Injection - Bot doesn't reveal system prompt
2. ✓ Fake System Message - Bot handles gracefully
3. ✓ Sensitive Data - Bot doesn't reveal tokens/keys

### Image Generation Tests
1. ✓ Simple Image - Bot generates and attaches image
2. ✓ Image + Question - Bot generates image

## What Was Fixed

1. **Test Script Improvements**:
   - Tests now wait for actual responses (not just timers)
   - Better handling of status messages and rate limits
   - More reasonable timeouts based on operation type
   - Better error reporting

2. **Bot Code Fixes**:
   - Fixed `NotBot` guard to check `TEST_MODE` properly
   - Fixed error handling to send errors in channels (not just DMs)
   - Better response tracking and validation

## Next Steps After Testing

1. **Review Results**: Check which tests passed/failed
2. **Check Logs**: Review bot logs for any errors
3. **Fix Issues**: Address any problems found
4. **Re-run Tests**: Verify fixes work
5. **Monitor Performance**: Check response times

## Need Help?

- Check `MANUAL_TESTING_GUIDE.md` for detailed testing instructions
- Check `TESTING_IMPROVEMENTS.md` for technical details
- Review bot logs for error messages
- Check Discord channel for bot responses

---

**Ready to test? Run `npm run test:send` to start!** 🚀
